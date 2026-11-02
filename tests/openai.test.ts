import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { chatJson, type Transport } from '../src/compiler/openai';
import { resetSpend, totalUsd, useSpend } from '../src/compiler/spend';

const t: Transport = { baseUrl: 'https://api.openai.com/v1', headers: { Authorization: 'Bearer sk-test' }, via: 'browser' };
const req = { model: 'gpt-6.1-terra', system: 's', user: 'u', schema: { type: 'object' }, schemaName: 'x', reasoningEffort: 'high' as const };

function sse(content: string, usage?: object): string {
  const lines = [
    `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content }, finish_reason: null }] })}`,
    `data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}`,
    ...(usage ? [`data: ${JSON.stringify({ choices: [], usage })}`] : []),
    'data: [DONE]',
  ];
  return lines.join('\n\n') + '\n\n';
}

const bodies: Array<Record<string, unknown>> = [];
beforeEach(() => {
  resetSpend();
  bodies.length = 0;
});
afterEach(() => vi.unstubAllGlobals());

describe('chatJson', () => {
  it('asks for usage at the end of the stream and adds the cost to the spend counter', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        bodies.push(JSON.parse(String(init.body)));
        return new Response(sse('{"ok":true}', { prompt_tokens: 10_000, completion_tokens: 2_000, completion_tokens_details: { reasoning_tokens: 1_500 } }), { status: 200 });
      }),
    );
    expect(await chatJson<{ ok: boolean }>(t, req)).toEqual({ ok: true });
    expect(bodies[0]).toMatchObject({ model: 'gpt-6.1-terra', stream: true, stream_options: { include_usage: true }, reasoning_effort: 'high' });
    expect(totalUsd(useSpend.getState())).toBeCloseTo((10_000 * 1 + 2_000 * 5) / 1e6, 10);
    expect(useSpend.getState().byModel['gpt-6.1-terra']).toMatchObject({ calls: 1, reasoning: 1_500 });
  });

  it('drops the usage request for endpoints that reject it, and keeps streaming', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        const body = JSON.parse(String(init.body));
        bodies.push(body);
        if (body.stream_options) return Response.json({ error: { message: 'Unrecognized request argument supplied: stream_options' } }, { status: 400 });
        return new Response(sse('{"ok":1}'), { status: 200 });
      }),
    );
    expect(await chatJson(t, req)).toEqual({ ok: 1 });
    expect(bodies.map((b) => [b.stream, Boolean(b.stream_options)])).toEqual([
      [true, true],
      [true, false],
    ]);
    // The second request ran, but reported no usage: it counts, with its cost missing.
    expect(useSpend.getState().byModel['gpt-6.1-terra']).toMatchObject({ calls: 1, incomplete: 1 });
  });

  it("explains a rejected key on the site's server differently from the visitor's own", async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: { message: 'Incorrect API key provided' } }, { status: 401 })));
    await expect(chatJson({ baseUrl: '/api/openai', headers: {}, via: 'server' }, req)).rejects.toThrow(/This site's OpenAI key was rejected/);
    await expect(chatJson(t, req)).rejects.toThrow(/Your OpenAI API key was rejected/);
  });

  it("passes the server's own refusals through as they are", async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: { message: 'This site builds with gpt-6.1-terra or gpt-6-luna.', code: 'amble_model_not_allowed' } }, { status: 403 })));
    await expect(chatJson({ baseUrl: '/api/openai', headers: {}, via: 'server' }, { ...req, model: 'gpt-6-astra' })).rejects.toThrow(/^This site builds with/);
  });
});
