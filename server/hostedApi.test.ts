import { beforeEach, describe, expect, it, vi } from 'vitest';
import { devOptions, handleAmbleApi, hostedOptions, isOwnPage, resetRateLimit, routeOf, type AmbleApiOptions } from '../api/amble.ts';

const HOST = 'amble.example.app';

function hosted(overrides: Partial<AmbleApiOptions> = {}) {
  const upstream = vi.fn(async (url: string, init: RequestInit) => {
    void url;
    void init;
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json', 'openai-organization': 'org-secret', 'set-cookie': 'a=b' } });
  });
  const opts: AmbleApiOptions = { ...hostedOptions({ OPENAI_API_KEY: 'sk-server' }), fetch: upstream as unknown as typeof fetch, ...overrides };
  return { opts, upstream };
}

/** A request from Amble's own page in a browser. */
function own(path: string, body?: unknown, headers: Record<string, string> = {}, method = body === undefined ? 'GET' : 'POST'): Request {
  return new Request(`https://${HOST}${path}`, {
    method,
    headers: { host: HOST, 'sec-fetch-site': 'same-origin', ...(method === 'POST' ? { origin: `https://${HOST}`, 'content-type': 'application/json' } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const chat = (model = 'gpt-6.1-terra', extra: Record<string, unknown> = {}) => ({ model, messages: [{ role: 'user', content: 'hi' }], stream: true, ...extra });

beforeEach(() => resetRateLimit());

describe('routes', () => {
  it('reads the route from the rewrite query or from the path', () => {
    expect(routeOf(new Request('https://x/api/amble?route=config'))).toEqual({ kind: 'config' });
    expect(routeOf(new Request('https://x/api/config'))).toEqual({ kind: 'config' });
    expect(routeOf(new Request('https://x/api/amble?route=openai&path=chat/completions'))).toEqual({ kind: 'openai', path: 'chat/completions' });
    expect(routeOf(new Request('https://x/api/amble?route=openai&path=chat%2Fcompletions'))).toEqual({ kind: 'openai', path: 'chat/completions' });
    expect(routeOf(new Request('https://x/api/openai/images/generations'))).toEqual({ kind: 'openai', path: 'images/generations' });
    expect(routeOf(new Request('https://x/api/amble?route=openai&path=../../v2/secrets'))).toEqual({ kind: 'openai', path: '' });
    expect(routeOf(new Request('https://x/api/somewhere'))).toBeNull();
  });

  it('says whether the server has a key, without saying the key', async () => {
    const res = await handleAmbleApi(new Request(`https://${HOST}/api/amble?route=config`), hosted().opts);
    const body = await res.json();
    expect(body).toEqual({ serverKey: true, codex: false, hosted: true, models: ['gpt-6.1-terra', 'gpt-6-luna'] });
    expect(JSON.stringify(body)).not.toContain('sk-server');
    const none = await handleAmbleApi(new Request(`https://${HOST}/api/config`), hostedOptions({}));
    expect((await none.json()).serverKey).toBe(false);
  });
});

describe('hosted proxy', () => {
  it('forwards a compile request with the server key and streams the reply back', async () => {
    const { opts, upstream } = hosted();
    const res = await handleAmbleApi(own('/api/amble?route=openai&path=chat/completions', chat()), opts);
    expect(res.status).toBe(200);
    expect(upstream).toHaveBeenCalledTimes(1);
    const [url, init] = upstream.mock.calls[0];
    expect(url).toBe('https://api.openai.com/v1/chat/completions');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer sk-server');
    // OpenAI's account headers and cookies stay on the server.
    expect(res.headers.get('openai-organization')).toBeNull();
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  it('only runs the models Amble builds with (dated snapshots too)', async () => {
    const { opts, upstream } = hosted();
    const denied = await handleAmbleApi(own('/api/openai/chat/completions', chat('gpt-6-astra')), opts);
    expect(denied.status).toBe(403);
    expect((await denied.json()).error.code).toBe('amble_model_not_allowed');
    expect(upstream).not.toHaveBeenCalled();
    expect((await handleAmbleApi(own('/api/openai/chat/completions', chat('gpt-6-luna-2026-09-30')), opts)).status).toBe(200);
    expect((await handleAmbleApi(own('/api/openai/chat/completions', chat('gpt-6-luna-evil')), opts)).status).toBe(403);
    const custom = hosted({ allowedModels: ['my-model'] });
    expect((await handleAmbleApi(own('/api/openai/chat/completions', chat('my-model')), custom.opts)).status).toBe(200);
  });

  it('keeps only what Amble sends, and caps the output', async () => {
    const { opts, upstream } = hosted({ maxOutputTokens: 1000 });
    await handleAmbleApi(own('/api/openai/chat/completions', chat('gpt-6.1-terra', { n: 8, service_tier: 'priority', tools: [{ type: 'function' }], max_completion_tokens: 50_000, reasoning_effort: 'high' })), opts);
    const sent = JSON.parse(String(upstream.mock.calls[0][1].body));
    expect(sent).toEqual({ ...chat('gpt-6.1-terra'), reasoning_effort: 'high', max_completion_tokens: 1000 });
  });

  it('draws one image at a time, at a moderate quality', async () => {
    const { opts, upstream } = hosted();
    await handleAmbleApi(own('/api/openai/images/generations', { model: 'gpt-image-2.5-flare', prompt: 'a fox', n: 10, size: '4096x4096', quality: 'max' }), opts);
    expect(JSON.parse(String(upstream.mock.calls[0][1].body))).toEqual({ model: 'gpt-image-2.5-flare', prompt: 'a fox', n: 1, size: '1024x1024', quality: 'medium' });
    expect((await handleAmbleApi(own('/api/openai/images/generations', { model: 'gpt-image-2', prompt: 'a fox' }), opts)).status).toBe(403);
  });

  it('answers only Amble own page', async () => {
    const { opts, upstream } = hosted();
    // Another site in the visitor's browser.
    expect((await handleAmbleApi(own('/api/openai/chat/completions', chat(), { 'sec-fetch-site': 'cross-site', origin: 'https://evil.example' }), opts)).status).toBe(403);
    expect((await handleAmbleApi(own('/api/openai/chat/completions', chat(), { origin: 'https://evil.example' }), opts)).status).toBe(403);
    // A script with no browser headers at all.
    const bare = new Request(`https://${HOST}/api/openai/chat/completions`, { method: 'POST', headers: { host: HOST, 'content-type': 'application/json' }, body: JSON.stringify(chat()) });
    expect((await handleAmbleApi(bare, opts)).status).toBe(403);
    // Not JSON (a form post).
    expect((await handleAmbleApi(own('/api/openai/chat/completions', chat(), { 'content-type': 'text/plain' }), opts)).status).toBe(415);
    expect(upstream).not.toHaveBeenCalled();
    expect(isOwnPage(own('/api/openai/models'))).toBe(true);
  });

  it('only proxies the endpoints Amble uses, with their methods', async () => {
    const { opts, upstream } = hosted();
    expect((await handleAmbleApi(own('/api/openai/files', { purpose: 'x' }), opts)).status).toBe(404);
    expect((await handleAmbleApi(own('/api/openai/chat/completions'), opts)).status).toBe(405);
    expect((await handleAmbleApi(own('/api/openai/audio/speech', { model: 'x' }), opts)).status).toBe(404);
    expect(upstream).not.toHaveBeenCalled();
  });

  it('lists only the models it runs', async () => {
    const upstream = vi.fn(async () => Response.json({ data: [{ id: 'gpt-6.1-terra' }, { id: 'gpt-6-astra' }, { id: 'gpt-6-luna' }, { id: 'gpt-image-2.5-flare' }] }));
    const { opts } = hosted({ fetch: upstream as unknown as typeof fetch });
    const res = await handleAmbleApi(own('/api/openai/models'), opts);
    expect((await res.json()).data.map((m: { id: string }) => m.id)).toEqual(['gpt-6.1-terra', 'gpt-6-luna', 'gpt-image-2.5-flare']);
  });

  it('limits how often one visitor can build', async () => {
    let now = 0;
    const { opts, upstream } = hosted({ rateLimit: 2, rateWindowMs: 1000, now: () => now });
    const send = (ip: string) => handleAmbleApi(own('/api/openai/chat/completions', chat(), { 'x-forwarded-for': `${ip}, 10.0.0.1` }), opts);
    expect((await send('1.1.1.1')).status).toBe(200);
    expect((await send('1.1.1.1')).status).toBe(200);
    const limited = await send('1.1.1.1');
    expect(limited.status).toBe(429);
    expect((await limited.json()).error.code).toBe('amble_rate_limit');
    expect((await send('2.2.2.2')).status).toBe(200);
    now = 1500;
    expect((await send('1.1.1.1')).status).toBe(200);
    expect(upstream).toHaveBeenCalledTimes(4);
  });

  it('says so when there is no key', async () => {
    const res = await handleAmbleApi(own('/api/openai/chat/completions', chat()), hostedOptions({}));
    expect(res.status).toBe(401);
    expect((await res.json()).error.message).toMatch(/OPENAI_API_KEY/);
  });

  it('reads its settings from the environment', () => {
    const o = hostedOptions({ OPENAI_API_KEY: ' sk-x ', OPENAI_BASE_URL: 'https://proxy.example/v1/', AMBLE_MODELS: 'a, b', AMBLE_RATE_LIMIT: '7', AMBLE_MAX_OUTPUT_TOKENS: 'lots' });
    expect(o).toMatchObject({ key: 'sk-x', baseUrl: 'https://proxy.example/v1', allowedModels: ['a', 'b'], rateLimit: 7, maxOutputTokens: 64_000, hosted: true });
  });
});

describe('dev server proxy', () => {
  it('forwards anything with your own key (any model, no limits)', async () => {
    const upstream = vi.fn(async () => new Response('{}', { status: 200 }));
    const opts = { ...devOptions({ OPENAI_API_KEY: 'sk-mine' }), fetch: upstream as unknown as typeof fetch };
    const body = chat('gpt-6-astra', { n: 2, service_tier: 'flex' });
    const res = await handleAmbleApi(new Request('http://localhost:5173/api/openai/chat/completions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }), opts);
    expect(res.status).toBe(200);
    expect(JSON.parse(String((upstream.mock.calls[0] as unknown as [string, RequestInit])[1].body))).toEqual(body);
    const config = await (await handleAmbleApi(new Request('http://localhost:5173/api/config'), opts)).json();
    expect(config).toEqual({ serverKey: true, codex: true, hosted: false, models: null });
  });
});

describe('waiting for a model that thinks for a long time', () => {
  const slow = (respond: (body: Record<string, unknown>) => Response, ms = 60) =>
    vi.fn(async (_url: string, init: RequestInit) => {
      await new Promise((r) => setTimeout(r, ms));
      return respond(JSON.parse(String(init.body)));
    });

  it('starts answering at once, with heartbeats, then passes the stream through', async () => {
    const upstream = slow(() => new Response('data: {"choices":[{"delta":{"content":"hi"}}]}\n\ndata: [DONE]\n\n', { status: 200, headers: { 'content-type': 'text/event-stream' } }));
    const { opts } = hosted({ fetch: upstream as unknown as typeof fetch, heartbeatMs: 10 });
    const t0 = Date.now();
    const res = await handleAmbleApi(own('/api/openai/chat/completions', chat()), opts);
    // The headers are out before OpenAI has said anything.
    expect(Date.now() - t0).toBeLessThan(50);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const text = await res.text();
    expect(text.startsWith(': keep-alive\n\n')).toBe(true);
    expect(text.match(/: keep-alive/g)!.length).toBeGreaterThan(2);
    expect(text).toContain('data: {"choices":[{"delta":{"content":"hi"}}]}');
  });

  it("puts OpenAI's error in the stream, with its status", async () => {
    const upstream = slow(() => Response.json({ error: { message: 'Unsupported parameter: stream_options', code: 'unsupported_parameter' } }, { status: 400 }), 5);
    const { opts } = hosted({ fetch: upstream as unknown as typeof fetch });
    const text = await (await handleAmbleApi(own('/api/openai/chat/completions', chat()), opts)).text();
    expect(text).toContain('data: {"error":{"message":"Unsupported parameter: stream_options","status":400,"code":"unsupported_parameter"}}');
  });

  it('pads a JSON reply (images) with spaces, which JSON readers skip', async () => {
    const upstream = slow(() => Response.json({ data: [{ b64_json: 'AAAA' }] }));
    const { opts } = hosted({ fetch: upstream as unknown as typeof fetch, heartbeatMs: 10 });
    const res = await handleAmbleApi(own('/api/openai/images/generations', { model: 'gpt-image-2.5-flare', prompt: 'a fox' }), opts);
    expect(res.headers.get('content-type')).toBe('application/json');
    expect(await res.json()).toEqual({ data: [{ b64_json: 'AAAA' }] });
  });

  it('works with the editor: a slow compile, and a rejected option still retried without it', async () => {
    const { chatJson } = await import('../src/compiler/openai');
    const sent: Array<Record<string, unknown>> = [];
    const upstream = slow((body) => {
      sent.push(body);
      if (body.stream_options) return Response.json({ error: { message: 'Unrecognized request argument supplied: stream_options' } }, { status: 400 });
      return new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: '{"ok":true}' }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`, { status: 200 });
    }, 30);
    const { opts } = hosted({ fetch: upstream as unknown as typeof fetch, heartbeatMs: 5 });
    // The editor's fetch reaches the handler, as it would on Vercel.
    vi.stubGlobal('fetch', (url: string, init: RequestInit) => handleAmbleApi(own(String(url), JSON.parse(String(init.body))), opts));
    try {
      const reply = await chatJson<{ ok: boolean }>({ baseUrl: '/api/openai', headers: {}, via: 'server' }, { model: 'gpt-6.1-terra', system: 's', user: 'u', schema: { type: 'object' }, schemaName: 'x', reasoningEffort: 'high' });
      expect(reply).toEqual({ ok: true });
      expect(sent.map((b) => Boolean(b.stream_options))).toEqual([true, false]);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
