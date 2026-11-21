import { afterEach, describe, expect, it, vi } from 'vitest';
import { AiError, chatJson, isBusy, isDropped, onBusy, outputCap, type Transport } from '../src/compiler/openai';

const t: Transport = { baseUrl: 'https://openrouter.ai/api/v1', headers: { Authorization: 'Bearer sk-or-test' }, via: 'browser' };
const sse = (content: string) =>
  [`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content }, finish_reason: null }] })}`, `data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}`, 'data: [DONE]'].join('\n\n') + '\n\n';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('many games at once', () => {
  it('tells busy from broken', () => {
    expect(isBusy(new AiError('Rate limit exceeded', 429))).toBe(true);
    expect(isBusy(new AiError('Lots of builds from here in the last few minutes.', 429, 'amble_rate_limit'))).toBe(true);
    expect(isBusy(new AiError('This request would exceed your available credits given your current in-flight requests. Retry after in-flight requests settle, or add credits.', 402))).toBe(true);
    expect(isBusy(new AiError('Provider overloaded', 503))).toBe(true);
    // Out of money or a bad key isn't busy: waiting won't help.
    expect(isBusy(new AiError('You exceeded your current quota', 429))).toBe(false);
    expect(isBusy(new AiError('Insufficient credits', 402))).toBe(false);
    expect(isBusy(new AiError('Bad key', 401))).toBe(false);
    expect(isBusy(new Error('x'))).toBe(false);
  });

  it('asks for replies only as long as each kind needs (more room for more thinking)', () => {
    expect(outputCap({ schemaName: 'svg_art', reasoningEffort: 'low' })).toBe(8_000);
    expect(outputCap({ schemaName: 'amble_pieces', reasoningEffort: 'low' })).toBe(24_000);
    expect(outputCap({ schemaName: 'amble_pieces', reasoningEffort: 'high' })).toBe(64_000);
    expect(outputCap({ schemaName: 'amble_ask', reasoningEffort: 'low' })).toBe(1_000);
    expect(outputCap({ schemaName: 'something_new', reasoningEffort: 'low' })).toBeUndefined();
  });

  it('waits its turn when turned away as busy, says so, and goes on', async () => {
    vi.useFakeTimers();
    const bodies: Array<Record<string, unknown>> = [];
    let calls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        bodies.push(JSON.parse(String(init.body)));
        calls++;
        if (calls === 1) return new Response(JSON.stringify({ error: { code: 402, message: 'This request would exceed your available credits given your current in-flight requests. Retry after in-flight requests settle, or add credits.' } }), { status: 402 });
        return new Response(sse('{"svg":"<svg/>"}'), { status: 200 });
      }),
    );
    const told: boolean[] = [];
    const stop = onBusy((b) => told.push(b));
    const done = chatJson<{ svg: string }>(t, { model: 'openai/gpt-6.2-sol', system: 's', user: 'u', schema: { type: 'object' }, schemaName: 'svg_art', reasoningEffort: 'low', kind: 'art' });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(await done).toEqual({ svg: '<svg/>' });
    stop();
    expect(calls).toBe(2);
    expect(told).toEqual([true, false]);
    expect(bodies[0].max_completion_tokens).toBe(8_000);
  });

  it('sends a request again at once when its connection dropped', async () => {
    vi.useFakeTimers();
    expect(isDropped(new TypeError('Failed to fetch'))).toBe(true);
    expect(isDropped(new AiError('Proxy error: terminated', 502))).toBe(true);
    expect(isDropped(new AiError('Bad request', 400))).toBe(false);
    let calls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        calls++;
        if (calls === 1) throw new TypeError('network error');
        return new Response(sse('{"svg":"<svg/>"}'), { status: 200 });
      }),
    );
    const done = chatJson<{ svg: string }>(t, { model: 'openai/gpt-6.2-sol', system: 's', user: 'u', schema: { type: 'object' }, schemaName: 'svg_art', reasoningEffort: 'low', kind: 'art' });
    await vi.advanceTimersByTimeAsync(2_000);
    expect(await done).toEqual({ svg: '<svg/>' });
    expect(calls).toBe(2);
  });

  it('says plainly when it never got a turn', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: { code: 429, message: 'Rate limit exceeded' } }), { status: 429 })));
    const done = chatJson(t, { model: 'openai/gpt-6.2-sol', system: 's', user: 'u', schema: { type: 'object' }, schemaName: 'amble_pieces', reasoningEffort: 'low' }).catch((e: AiError) => e);
    await vi.advanceTimersByTimeAsync(200_000);
    const err = (await done) as AiError;
    expect(err.code).toBe('amble_busy');
    expect(err.message).toMatch(/So many people are making games right now/);
  });
});
