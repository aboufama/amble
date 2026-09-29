import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AiError } from '../../src/ai/errors';
import { s } from '../../src/ai/json/schema';
import { chatJson, chatText, DEFAULT_TIMEOUT_MS } from '../../src/ai/transport';
import { CODEX_BASE_URL } from '../../src/ai/wire/codex';
import { forgetLearnedCaps } from '../../src/ai/wire/learned';
import type { ChatStatus } from '../../src/ai/wire/types';
import { fakeEndpoint, hangingStream, never, sse, transport, type SentRequest } from './fakeEndpoint';

const Small = s.object({ ok: s.boolean() });
const req = { model: 'm', system: 'SYSTEM', user: 'USER', schema: Small, schemaName: 'amble_small' };

async function failure(p: Promise<unknown>): Promise<AiError> {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(AiError);
  return err as AiError;
}

beforeEach(() => forgetLearnedCaps());
afterEach(() => vi.useRealTimers());

describe('time limits', () => {
  it('allows a slow district model plenty of time by default', () => {
    expect(DEFAULT_TIMEOUT_MS).toBeGreaterThanOrEqual(8 * 60_000);
  });

  it('never cuts off a reply that is slow to start unless asked to', async () => {
    vi.useFakeTimers();
    const slow = (r: SentRequest) => new Promise<Response>((resolve) => setTimeout(() => resolve(sse(['{"ok": true}'])), 5 * 60_000)).then((res) => (r.init.signal?.aborted ? Promise.reject(new DOMException('aborted', 'AbortError')) : res));
    const p = chatJson(transport(fakeEndpoint([slow]).fetch), req);
    await vi.advanceTimersByTimeAsync(5 * 60_000 + 10);
    expect((await p).value.ok).toBe(true);
  });

  it('honors an optional limit on waiting for the reply to start', async () => {
    const ep = fakeEndpoint([never]);
    const started = Date.now();
    const err = await failure(chatJson(transport(ep.fetch), { ...req, firstByteMs: 50 }));
    expect(err.kind).toBe('timeout');
    expect(err.detail).toMatch(/never started/);
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it('ends a stream that goes quiet while writing', async () => {
    const ep = fakeEndpoint([(r) => hangingStream(['{"ok":'], r.init.signal)]);
    const err = await failure(chatJson(transport(ep.fetch), { ...req, stallMs: 60 }));
    expect(err.kind).toBe('timeout');
    expect(err.detail).toMatch(/stopped arriving/);
    expect(ep.sent).toHaveLength(1);
  });

  it('keeps what a stalled text stream sent', async () => {
    const ep = fakeEndpoint([(r) => hangingStream(['@@amble-patch 1\n', '@@summary A boss fight\n'], r.init.signal)]);
    const r = await chatText(transport(ep.fetch), { model: 'm', system: 's', user: 'u', stallMs: 60 });
    expect(r).toMatchObject({ truncated: true, finishReason: 'interrupted', text: '@@amble-patch 1\n@@summary A boss fight\n' });
  });

  it('stops at the total deadline, retries included', async () => {
    const ep = fakeEndpoint([never]);
    const started = Date.now();
    const err = await failure(chatJson(transport(ep.fetch), { ...req, timeoutMs: 80 }));
    expect(err.kind).toBe('timeout');
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it('cancels at once through the AbortSignal, mid-stream or while waiting to retry', async () => {
    const ctl = new AbortController();
    const ep = fakeEndpoint([(r) => hangingStream(['{"ok":'], r.init.signal)]);
    const p = chatJson(transport(ep.fetch), { ...req, signal: ctl.signal, onStatus: (st) => st.phase === 'writing' && ctl.abort() });
    expect((await failure(p)).kind).toBe('cancelled');

    const ctl2 = new AbortController();
    const ep2 = fakeEndpoint([() => Promise.reject(new TypeError('Failed to fetch'))]);
    const p2 = chatJson(transport(ep2.fetch), { ...req, signal: ctl2.signal, onStatus: (st) => st.phase === 'retrying' && ctl2.abort() });
    expect((await failure(p2)).kind).toBe('cancelled');

    const aborted = new AbortController();
    aborted.abort();
    const ep3 = fakeEndpoint([]);
    expect((await failure(chatJson(transport(ep3.fetch), { ...req, signal: aborted.signal }))).kind).toBe('cancelled');
    expect(ep3.sent).toHaveLength(0);
  });
});

describe('the dev-only Codex route', () => {
  const ndjson = (events: object[]) => new Response(events.map((e) => `${JSON.stringify(e)}\n`).join(''), { headers: { 'content-type': 'application/x-ndjson' } });
  const codex = (fetch: typeof globalThis.fetch) => transport(fetch, { baseUrl: CODEX_BASE_URL, headers: {}, via: 'codex', auth: 'dev', host: 'this computer', caps: { images: true } });

  it('sends the request, pictures and schema to the bridge and reads its events', async () => {
    const ep = fakeEndpoint([ndjson([{ type: 'progress', phase: 'thinking' }, { type: 'usage', usage: { inputTokens: 40, cachedInputTokens: 0, outputTokens: 4 } }, { type: 'result', text: '{"ok":true}' }])]);
    const statuses: ChatStatus[] = [];
    const png = 'data:image/png;base64,iVBORw0KGgo=';
    const r = await chatJson(codex(ep.fetch), {
      ...req,
      reasoningEffort: 'medium',
      user: [
        { type: 'text', text: 'Look' },
        { type: 'image_url', image_url: { url: png } },
      ],
      onStatus: (st) => statuses.push(st),
    });
    expect(r.value.ok).toBe(true);
    expect(r.usage?.inputTokens).toBe(40);
    expect(ep.sent[0].url).toMatch(/\/api\/codex\/run$/);
    expect(ep.sent[0].body).toMatchObject({ system: 'SYSTEM', user: 'Look', images: [png], model: 'm', reasoningEffort: 'medium' });
    expect((ep.sent[0].body.schema as { properties: object }).properties).toHaveProperty('ok');
    expect(statuses).toContainEqual({ phase: 'thinking' });
  });

  it('wraps free text in a one-field schema and unwraps the answer', async () => {
    const ep = fakeEndpoint([ndjson([{ type: 'result', text: JSON.stringify({ text: '@@amble-patch 1\n@@end\n' }) }])]);
    const r = await chatText(codex(ep.fetch), { model: 'm', system: 'SYSTEM', user: 'u' });
    expect(r.text).toBe('@@amble-patch 1\n@@end\n');
    expect(String(ep.sent[0].body.system)).toContain('"text" field');
  });

  it('maps a sign-in problem to auth and does not retry the bridge', async () => {
    const ep = fakeEndpoint([ndjson([{ type: 'error', message: "Codex isn't signed in (401). Sign in with ChatGPT again." }])]);
    const err = await failure(chatJson(codex(ep.fetch), req));
    expect(err.kind).toBe('auth');
    expect(ep.sent).toHaveLength(1);
  });
});
