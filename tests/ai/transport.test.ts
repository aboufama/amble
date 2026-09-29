import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AiError } from '../../src/ai/errors';
import { s } from '../../src/ai/json/schema';
import { chatJson, chatText, listModels, pingModel } from '../../src/ai/transport';
import { forgetLearnedCaps } from '../../src/ai/wire/learned';
import type { ChatStatus, ContentPart } from '../../src/ai/wire/types';
import { fakeEndpoint, httpError, plain, sse, systemContent, transport, userContent } from './fakeEndpoint';

const Plan = s.object({
  title: s.string({ max: 28 }),
  pitch: s.string(),
  cast: s.array(s.object({ key: s.string(), ask: s.string({ max: 60 }) }), { max: 8 }),
  safety: s.object({ changed: s.boolean(), note: s.string() }),
});
const plan = { title: 'Moon King', pitch: 'Pop moon rocks.', cast: [{ key: 'hero', ask: 'Draw your hero' }], safety: { changed: false, note: '' } };
const req = { model: 'gpt-5-mini', system: 'SYSTEM', user: 'a space kid', schema: Plan, schemaName: 'amble_plan' };

async function failure(p: Promise<unknown>): Promise<AiError> {
  try {
    await p;
  } catch (err) {
    expect(err).toBeInstanceOf(AiError);
    return err as AiError;
  }
  throw new Error('expected the call to fail');
}

beforeEach(() => forgetLearnedCaps());

describe('chatJson on the wire', () => {
  it('asks for a strict schema, streams, never stores, and returns the typed reply with usage', async () => {
    const json = JSON.stringify(plan);
    const ep = fakeEndpoint([sse([json.slice(0, 15), json.slice(15)], { usage: { prompt_tokens: 900, completion_tokens: 60, total_tokens: 960, prompt_tokens_details: { cached_tokens: 512 } } })]);
    const statuses: ChatStatus[] = [];
    const deltas: string[] = [];
    const r = await chatJson(transport(ep.fetch), { ...req, maxTokens: 2000, reasoningEffort: 'low', onStatus: (st) => statuses.push(st), onDelta: (d) => deltas.push(d) });
    expect(r.value.cast[0].ask).toBe('Draw your hero');
    expect(r.format).toBe('json_schema');
    expect(r.repaired).toBe(false);
    expect(r.usage).toEqual({ inputTokens: 900, outputTokens: 60, totalTokens: 960, reasoningTokens: 0, cachedTokens: 512, requests: 1 });
    const [sent] = ep.sent;
    expect(sent.url).toBe('https://ai.example.org/v1/chat/completions');
    expect(sent.headers['x-amble-class']).toBe('MAPLE-7Q2K');
    expect(sent.headers.authorization).toBeUndefined();
    expect(sent.init.credentials).toBe('omit');
    expect(sent.body).toMatchObject({ model: 'gpt-5-mini', stream: true, stream_options: { include_usage: true }, store: false, max_completion_tokens: 2000, reasoning_effort: 'low' });
    const format = sent.body.response_format as { type: string; json_schema: { name: string; strict: boolean; schema: Record<string, unknown> } };
    expect(format.type).toBe('json_schema');
    expect(format.json_schema).toMatchObject({ name: 'amble_plan', strict: true });
    // Length limits are checked locally and never sent.
    expect(JSON.stringify(format.json_schema.schema)).not.toMatch(/maxLength|maxItems/);
    expect(deltas.join('')).toBe(json);
    expect(statuses[0]).toEqual({ phase: 'waiting' });
    expect(statuses.at(-1)).toEqual({ phase: 'writing', chars: json.length });
  });

  it('reads a plain JSON answer from a proxy that ignores stream: true', async () => {
    const ep = fakeEndpoint([plain(JSON.stringify(plan), { usage: { prompt_tokens: 10, completion_tokens: 5 } })]);
    const r = await chatJson(transport(ep.fetch), req);
    expect(r.value.title).toBe('Moon King');
    expect(r.usage?.totalTokens).toBe(15);
  });

  it('decides the format from the bytes when the content type is missing or wrong', async () => {
    const streamed = sse([JSON.stringify(plan)], { headers: { 'content-type': 'application/octet-stream' }, noNewlineAtEnd: true });
    const whole = plain(JSON.stringify(plan), { contentType: 'text/plain' });
    const ep = fakeEndpoint([streamed, whole]);
    expect((await chatJson(transport(ep.fetch), req)).value.title).toBe('Moon King');
    expect((await chatJson(transport(ep.fetch), req)).value.title).toBe('Moon King');
  });

  it('accepts content given as an array of text parts', async () => {
    const body = { choices: [{ message: { content: [{ type: 'text', text: JSON.stringify(plan) }] }, finish_reason: 'stop' }] };
    const ep = fakeEndpoint([new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } })]);
    expect((await chatJson(transport(ep.fetch), req)).value.pitch).toBe('Pop moon rocks.');
  });

  it('falls back from a strict schema to json_object to the schema in the prompt', async () => {
    const ep = fakeEndpoint([
      httpError(400, "Invalid parameter: 'response_format' of type 'json_schema' is not supported with this model.", { param: 'response_format' }),
      httpError(400, 'json_object response format is not supported'),
      plain(`Sure! Here it is:\n\`\`\`json\n${JSON.stringify(plan)}\n\`\`\``),
    ]);
    const dropped: string[] = [];
    const r = await chatJson(transport(ep.fetch), { ...req, onStatus: (st) => st.phase === 'fallback' && dropped.push(st.dropped) });
    expect(r.value.title).toBe('Moon King');
    expect(r.format).toBe('prompt');
    expect(dropped).toEqual(['json_schema', 'json_object']);
    expect((ep.sent[1].body.response_format as { type: string }).type).toBe('json_object');
    expect(ep.sent[2].body.response_format).toBeUndefined();
    expect(systemContent(ep.sent[1])).toContain('JSON schema');
    expect(systemContent(ep.sent[2])).toContain('"additionalProperties":false');
  });

  it('starts at json_object when the endpoint is known not to do strict schemas', async () => {
    const ep = fakeEndpoint([plain(JSON.stringify(plan))]);
    const r = await chatJson(transport(ep.fetch, { caps: { jsonSchema: false, stream: false } }), req);
    expect(r.format).toBe('json_object');
    expect(ep.sent[0].body).toMatchObject({ stream: false, response_format: { type: 'json_object' } });
    expect(ep.sent[0].body.stream_options).toBeUndefined();
  });

  it('drops only the feature a rejection names', async () => {
    const ep = fakeEndpoint([
      httpError(400, 'Unrecognized request argument supplied: stream_options'),
      httpError(400, "Unsupported parameter: 'max_completion_tokens'", { param: 'max_completion_tokens' }),
      httpError(400, "Unsupported parameter: 'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead.", { param: 'max_tokens' }),
      new Response(JSON.stringify({ detail: [{ loc: ['body', 'store'], msg: 'Extra inputs are not permitted', type: 'extra_forbidden' }] }), { status: 422, headers: { 'content-type': 'application/json' } }),
      httpError(400, 'Streaming is not supported for this deployment.'),
      plain(JSON.stringify(plan)),
    ]);
    const r = await chatJson(transport(ep.fetch), { ...req, maxTokens: 500 });
    expect(r.value.title).toBe('Moon King');
    const b = ep.sent.map((x) => x.body);
    expect(b[0]).toMatchObject({ stream_options: { include_usage: true }, max_completion_tokens: 500 });
    expect(b[1].stream_options).toBeUndefined();
    expect(b[1].max_completion_tokens).toBe(500);
    expect(b[2]).toMatchObject({ max_tokens: 500 });
    expect(b[3].max_tokens).toBeUndefined();
    expect(b[3].store).toBe(false);
    expect(b[4].store).toBeUndefined();
    expect(b[4].stream).toBe(true);
    expect(b[5].stream).toBe(false);
  });

  it('sends reasoning effort only to reasoning models, and drops it when rejected', async () => {
    const ep = fakeEndpoint([plain(JSON.stringify(plan)), httpError(400, 'reasoning_effort is not supported by this model'), plain(JSON.stringify(plan))]);
    await chatJson(transport(ep.fetch), { ...req, model: 'gpt-4.1-mini', reasoningEffort: 'low' });
    expect(ep.sent[0].body.reasoning_effort).toBeUndefined();
    await chatJson(transport(ep.fetch, { caps: { reasoning: true } }), { ...req, model: 'amble-default', reasoningEffort: 'medium' });
    expect(ep.sent[1].body.reasoning_effort).toBe('medium');
    expect(ep.sent[2].body.reasoning_effort).toBeUndefined();
  });

  it('sends the safety identifier the config provides, and drops it when rejected', async () => {
    const ep = fakeEndpoint([httpError(400, "Unknown parameter: 'safety_identifier'."), plain(JSON.stringify(plan))]);
    await chatJson(transport(ep.fetch, { safetyIdentifier: async () => 'amble-0123abcd' }), req);
    expect(ep.sent[0].body.safety_identifier).toBe('amble-0123abcd');
    expect(ep.sent[1].body.safety_identifier).toBeUndefined();
  });

  it('adds later turns after the user message', async () => {
    const ep = fakeEndpoint([plain(JSON.stringify(plan))]);
    await chatJson(transport(ep.fetch), { ...req, messages: [{ role: 'assistant', content: 'earlier' }, { role: 'user', content: 'again' }] });
    expect((ep.sent[0].body.messages as unknown[]).length).toBe(4);
  });
});

describe('pictures', () => {
  const picture: ContentPart[] = [
    { type: 'text', text: 'Find the joints.' },
    { type: 'image_url', image_url: { url: 'data:image/png;base64,iVBORw0KGgo=', detail: 'low' } },
  ];

  it('sends image parts, and leaves them out (and remembers) when the model rejects them', async () => {
    const ep = fakeEndpoint([
      httpError(400, 'Invalid content type. image_url is only supported by certain models.', { param: 'messages' }),
      plain(JSON.stringify(plan)),
      plain(JSON.stringify(plan)),
    ]);
    const dropped: string[] = [];
    const r = await chatJson(transport(ep.fetch), { ...req, model: 'text-only', user: picture, onStatus: (st) => st.phase === 'fallback' && dropped.push(st.dropped) });
    expect(Array.isArray(userContent(ep.sent[0]))).toBe(true);
    expect(userContent(ep.sent[1])).toBe('Find the joints.');
    expect(r.imagesDropped).toBe(true);
    expect(dropped).toEqual(['images']);
    // The next request to the same model doesn't try pictures again.
    const again = await chatJson(transport(ep.fetch), { ...req, model: 'text-only', user: picture });
    expect(userContent(ep.sent[2])).toBe('Find the joints.');
    expect(again.imagesDropped).toBe(true);
  });

  it('never sends pictures when the config says the endpoint has no vision', async () => {
    const ep = fakeEndpoint([plain(JSON.stringify(plan))]);
    await chatJson(transport(ep.fetch, { caps: { images: false } }), { ...req, user: picture });
    expect(userContent(ep.sent[0])).toBe('Find the joints.');
  });
});

describe('replies that need a second look', () => {
  it('sends the problems back once and accepts the repaired reply', async () => {
    const ep = fakeEndpoint([plain(JSON.stringify({ ...plan, cast: 'hero' }), { usage: { prompt_tokens: 5, completion_tokens: 5 } }), plain(JSON.stringify(plan), { usage: { prompt_tokens: 7, completion_tokens: 3 } })]);
    const problems: string[][] = [];
    const r = await chatJson(transport(ep.fetch), { ...req, onStatus: (st) => st.phase === 'repairing' && problems.push(st.problems) });
    expect(r.repaired).toBe(true);
    expect(problems[0]).toEqual(['$.cast: expected an array, got a string']);
    const msgs = ep.sent[1].body.messages as Array<{ role: string; content: string }>;
    expect(msgs.map((m) => m.role)).toEqual(['system', 'user', 'assistant', 'user']);
    expect(msgs[3].content).toContain('$.cast: expected an array');
    expect(r.usage?.totalTokens).toBe(20);
    expect(r.usage?.requests).toBe(2);
  });

  it('fails as bad-reply when the repair is still wrong', async () => {
    const ep = fakeEndpoint([plain('not json at all'), plain('{"title": 5}')]);
    const err = await failure(chatJson(transport(ep.fetch), req));
    expect(err.kind).toBe('bad-reply');
    expect(err.detail).toContain('$.title: expected a string');
  });

  it('clamps over-long strings and lists instead of failing', async () => {
    const long = { ...plan, title: 'The Incredibly Long Moon King Adventure', cast: Array.from({ length: 10 }, (_, i) => ({ key: `k${i}`, ask: 'Draw it' })) };
    const ep = fakeEndpoint([plain(JSON.stringify(long))]);
    const r = await chatJson(transport(ep.fetch), req);
    expect(r.value.title.length).toBeLessThanOrEqual(28);
    expect(r.value.cast).toHaveLength(8);
  });

  it('turns refusals and content filters into refused', async () => {
    const ep = fakeEndpoint([
      sse([], { refusal: "I can't help with that." }),
      plain('', { finish: 'content_filter' }),
      httpError(400, "The response was filtered due to the prompt triggering Azure OpenAI's content management policy.", { code: 'content_filter' }),
      new Response(`data: ${JSON.stringify({ error: { message: 'Output blocked by content filter', code: 'content_filter' } })}\n\n`, { headers: { 'content-type': 'text/event-stream' } }),
    ]);
    for (let i = 0; i < 4; i++) expect((await failure(chatJson(transport(ep.fetch), req))).kind).toBe('refused');
  });

  it('reports a reply cut off by the token limit as too-long', async () => {
    const ep = fakeEndpoint([sse(['{"title": "Moo'], { finish: 'length' })]);
    expect((await failure(chatJson(transport(ep.fetch), req))).kind).toBe('too-long');
  });
});

describe('chatText', () => {
  it('streams text with onDelta and onDone', async () => {
    const ep = fakeEndpoint([sse(['@@amble-patch 1\n', '@@summary Hi\n', '@@end\n'])]);
    const deltas: string[] = [];
    let done: string | null = null;
    const r = await chatText(transport(ep.fetch), { model: 'm', system: 's', user: 'u', onDelta: (d) => deltas.push(d), onDone: (res) => (done = res.text) });
    expect(r).toMatchObject({ text: '@@amble-patch 1\n@@summary Hi\n@@end\n', truncated: false, finishReason: 'stop' });
    expect(deltas).toHaveLength(3);
    expect(done).toBe(r.text);
    expect(ep.sent[0].body.response_format).toBeUndefined();
  });

  it('keeps the partial text when the token limit cuts it off', async () => {
    const ep = fakeEndpoint([sse(['@@amble-patch 1\n@@file game.js create\nclass Game'], { finish: 'length' })]);
    const r = await chatText(transport(ep.fetch), { model: 'm', system: 's', user: 'u' });
    expect(r).toMatchObject({ truncated: true, finishReason: 'length' });
    expect(r.text).toContain('class Game');
  });

  it('keeps the partial text when the connection drops mid-reply', async () => {
    const enc = new TextEncoder();
    let pulls = 0;
    const broken = new Response(
      new ReadableStream({
        pull(c) {
          if (pulls++ === 0) c.enqueue(enc.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: '@@amble-patch 1\n' } }] })}\n\n`));
          else c.error(new TypeError('network error'));
        },
      }),
      { headers: { 'content-type': 'text/event-stream' } },
    );
    const r = await chatText(transport(fakeEndpoint([broken]).fetch), { model: 'm', system: 's', user: 'u' });
    expect(r).toMatchObject({ text: '@@amble-patch 1\n', truncated: true, finishReason: 'interrupted' });
  });

  it('fails when nothing at all came back', async () => {
    expect((await failure(chatText(transport(fakeEndpoint([sse([])]).fetch), { model: 'm', system: 's', user: 'u' }))).kind).toBe('bad-reply');
    expect((await failure(chatText(transport(fakeEndpoint([sse([], { finish: 'length' })]).fetch), { model: 'm', system: 's', user: 'u' }))).kind).toBe('too-long');
  });
});

describe('errors a student can read', () => {
  it('maps statuses to kinds with the right words', async () => {
    const cases: Array<[Response, string, RegExp]> = [
      [httpError(401, 'Invalid class code'), 'auth', /class link has expired/],
      [httpError(403, 'Class code not allowed'), 'auth', /class link/],
      [httpError(403, 'Daily token quota exceeded for this class', { code: 'quota_exceeded' }), 'quota', /today's AI time/],
      [httpError(429, 'You exceeded your current quota', { code: 'insufficient_quota' }), 'quota', /today's AI time/],
      [httpError(404, 'The model `gpt-9` does not exist'), 'setup', /isn't set up right/],
      [httpError(400, "This model's maximum context length is 128000 tokens.", { code: 'context_length_exceeded' }), 'too-long', /too big/],
      [httpError(413, 'Payload Too Large'), 'too-long', /too big/],
      [new Response('<html><body>Blocked by GoGuardian</body></html>', { status: 200, headers: { 'content-type': 'text/html' } }), 'blocked-by-filter', /ai\.example\.org.*web filter/],
      [new Response('<!doctype html><title>Access denied</title>', { status: 403 }), 'blocked-by-filter', /web filter/],
    ];
    for (const [res, kind, words] of cases) {
      const err = await failure(chatJson(transport(fakeEndpoint([res]).fetch), req));
      expect(err.kind, kind).toBe(kind);
      expect(err.message).toMatch(words);
      expect(err.detail).not.toContain('MAPLE-7Q2K');
    }
  });

  it('uses key words for a rejected key', async () => {
    const err = await failure(chatJson(transport(fakeEndpoint([httpError(401, 'Incorrect API key provided')]).fetch, { auth: 'key', headers: { Authorization: 'Bearer sk-test' } }), req));
    expect(err.message).toMatch(/didn't accept the key/);
    expect(err.detail).not.toContain('sk-test');
  });

  it('fails fast when the device is offline, without sending anything', async () => {
    const ep = fakeEndpoint([]);
    const err = await failure(chatJson(transport(ep.fetch, { isOnline: () => false }), req));
    expect(err.kind).toBe('offline');
    expect(ep.sent).toHaveLength(0);
  });

  it('sends nothing when the base URL is not a URL', async () => {
    const ep = fakeEndpoint([plain('{}')]);
    const err = await failure(chatJson(transport(ep.fetch, { baseUrl: 'http://[::1' }), req));
    expect(err.kind).toBe('setup');
    expect(err.detail).toMatch(/Refusing to send AI data/);
    expect(ep.sent).toHaveLength(0);
  });
});

describe('retries', () => {
  afterEach(() => vi.useRealTimers());

  it('waits out Retry-After on a 429 and tries again', async () => {
    const ep = fakeEndpoint([httpError(429, 'Rate limit reached', { headers: { 'retry-after-ms': '20' } }), plain(JSON.stringify(plan))]);
    const statuses: ChatStatus[] = [];
    const r = await chatJson(transport(ep.fetch), { ...req, onStatus: (st) => statuses.push(st) });
    expect(r.value.title).toBe('Moon King');
    const retrying = statuses.find((st) => st.phase === 'retrying');
    expect(retrying).toMatchObject({ phase: 'retrying', attempt: 1, reason: 'rate-limited' });
    expect(retrying && 'delayMs' in retrying && retrying.delayMs).toBeGreaterThanOrEqual(250);
  });

  it('backs off with jitter on 5xx and network errors, then gives up with a typed error', async () => {
    vi.useFakeTimers();
    const ep = fakeEndpoint([httpError(503, 'overloaded'), () => Promise.reject(new TypeError('Failed to fetch')), httpError(502, 'bad gateway'), httpError(500, 'boom')]);
    const delays: number[] = [];
    const p = chatJson(transport(ep.fetch), { ...req, onStatus: (st) => st.phase === 'retrying' && delays.push(st.delayMs) }).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(20_000);
    const err = (await p) as AiError;
    expect(err.kind).toBe('server');
    expect(ep.sent).toHaveLength(4);
    expect(delays).toHaveLength(3);
    expect(delays[0]).toBeGreaterThanOrEqual(1050);
    expect(delays[0]).toBeLessThanOrEqual(1950);
    expect(delays[2]).toBeGreaterThanOrEqual(6300);
  });

  it('calls a persistent network failure a blocked host while online', async () => {
    vi.useFakeTimers();
    const fail = () => Promise.reject(new TypeError('Failed to fetch'));
    const ep = fakeEndpoint([fail, fail, fail, fail]);
    const p = chatJson(transport(ep.fetch), req).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(20_000);
    const err = (await p) as AiError;
    expect(err.kind).toBe('blocked-by-filter');
    expect(err.message).toContain('ai.example.org');
  });

  it("doesn't wait out a Retry-After longer than a minute", async () => {
    const ep = fakeEndpoint([httpError(429, 'slow down', { headers: { 'retry-after': '120' } })]);
    const err = await failure(chatJson(transport(ep.fetch), req));
    expect(err.kind).toBe('rate-limited');
    expect(err.retryAfterMs).toBe(120_000);
  });
});

describe('utility calls', () => {
  it('pings a model with a tiny non-streamed request', async () => {
    const ep = fakeEndpoint([plain('', { finish: 'length' })]);
    expect(await pingModel(transport(ep.fetch), 'amble-default')).toBeGreaterThanOrEqual(0);
    expect(ep.sent[0].body).toMatchObject({ model: 'amble-default', stream: false, max_completion_tokens: 16 });
  });

  it('lists models when the endpoint offers them', async () => {
    const ep = fakeEndpoint([new Response(JSON.stringify({ data: [{ id: 'b' }, { id: 'a' }] }), { headers: { 'content-type': 'application/json' } }), httpError(404, 'Not found')]);
    expect(await listModels(transport(ep.fetch))).toEqual(['a', 'b']);
    expect((await failure(listModels(transport(ep.fetch)))).kind).toBe('setup');
  });
});
