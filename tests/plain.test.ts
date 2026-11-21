import { afterEach, describe, expect, it, vi } from 'vitest';
import { chatJson, parseJsonReply, type Transport } from '../src/compiler/openai';

const t: Transport = { baseUrl: 'https://openrouter.ai/api/v1', headers: { Authorization: 'Bearer sk-or-test' }, via: 'browser' };
const sse = (content: string) =>
  [`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content }, finish_reason: null }] })}`, `data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}`, 'data: [DONE]'].join('\n\n') + '\n\n';
const schema = { type: 'object', additionalProperties: false, required: ['svg'], properties: { svg: { type: 'string' } } };
const req = { model: 'openai/gpt-6.2-sol', system: 'Draw.', user: 'A hen.', schema, schemaName: 'svg_art', reasoningEffort: 'low' as const, kind: 'art' as const };

afterEach(() => {
  vi.unstubAllGlobals();
  delete (globalThis as { __ambleHarness?: object }).__ambleHarness;
});

describe('replies without a response format (so Amazon Bedrock may serve them)', () => {
  it('asks for the schema in words, and lets Bedrock answer first', async () => {
    const bodies: Array<Record<string, unknown>> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        bodies.push(JSON.parse(String(init.body)));
        return new Response(sse('{"svg":"<svg/>"}'), { status: 200 });
      }),
    );
    (globalThis as { __ambleHarness?: object }).__ambleHarness = { plainOutput: true };
    expect(await chatJson(t, req)).toEqual({ svg: '<svg/>' });
    const body = bodies[0] as { response_format?: unknown; messages: Array<{ content: string }>; provider: { only: string[]; order: string[] } };
    expect(body.response_format).toBeUndefined();
    expect(body.messages[0].content).toContain('Reply with a single JSON object that follows this JSON schema');
    expect(body.messages[0].content).toContain('no code fence');
    expect(body.messages[0].content).toContain('"svg"');
    expect(body.provider.order).toEqual(['amazon-bedrock', 'azure', 'openai']);
  });

  it('asks again, held to the schema, when a reply is not valid JSON', async () => {
    const bodies: Array<Record<string, unknown>> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        bodies.push(JSON.parse(String(init.body)));
        return new Response(sse(bodies.length === 1 ? '{"svg": "<svg/>' : '{"svg":"<svg/>"}'), { status: 200 });
      }),
    );
    (globalThis as { __ambleHarness?: object }).__ambleHarness = { plainOutput: true };
    expect(await chatJson(t, req)).toEqual({ svg: '<svg/>' });
    expect(bodies).toHaveLength(2);
    expect(bodies[1].response_format).toMatchObject({ type: 'json_schema' });
    // Held to the schema, it goes to the providers that can do that.
    expect((bodies[1].provider as { order: string[] }).order).toEqual(['azure', 'openai']);
  });

  it('puts back the brace of an object left open before its array closes', () => {
    const broken = '{\n  "sprites": [\n    {"name":"Hen","code":"class Hen extends Sprite {\\n}"\n  ],\n  "title":"Cluck"\n}';
    expect(parseJsonReply(broken)).toEqual({ sprites: [{ name: 'Hen', code: 'class Hen extends Sprite {\n}' }], title: 'Cluck' });
    expect(() => parseJsonReply('{"a": [1, 2')).toThrow();
  });

  it("isn't used straight to OpenAI (only through OpenRouter)", async () => {
    const bodies: Array<Record<string, unknown>> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        bodies.push(JSON.parse(String(init.body)));
        return new Response(sse('{"svg":"<svg/>"}'), { status: 200 });
      }),
    );
    (globalThis as { __ambleHarness?: object }).__ambleHarness = { plainOutput: true };
    await chatJson({ ...t, baseUrl: 'https://api.openai.com/v1' }, { ...req, model: 'gpt-6.2-sol' });
    expect(bodies[0].response_format).toMatchObject({ type: 'json_schema' });
  });
});
