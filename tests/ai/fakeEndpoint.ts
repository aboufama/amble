/** A scripted OpenAI-compatible endpoint for transport tests: every request gets the next reply. */
import type { Transport } from '../../src/ai/wire/types';

export interface SentRequest {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
  init: RequestInit;
}

export type Reply = Response | ((req: SentRequest) => Response | Promise<Response>);

const enc = new TextEncoder();

function chunk(delta: Record<string, unknown>, finish: string | null = null): string {
  return `data: ${JSON.stringify({ id: 'x', object: 'chat.completion.chunk', choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
}

/** A streamed (SSE) reply made of these content pieces. */
export function sse(pieces: string[], o: { finish?: string; usage?: object; refusal?: string; headers?: Record<string, string>; noNewlineAtEnd?: boolean } = {}): Response {
  const events = [
    chunk({ role: 'assistant', content: '' }),
    ...pieces.map((p) => chunk({ content: p })),
    ...(o.refusal ? [chunk({ refusal: o.refusal })] : []),
    chunk({}, o.finish ?? 'stop'),
    ...(o.usage ? [`data: ${JSON.stringify({ choices: [], usage: o.usage })}\n\n`] : []),
    o.noNewlineAtEnd ? 'data: [DONE]' : 'data: [DONE]\n\n',
  ];
  return new Response(
    new ReadableStream({
      start(c) {
        for (const e of events) c.enqueue(enc.encode(e));
        c.close();
      },
    }),
    { status: 200, headers: { 'content-type': 'text/event-stream', ...o.headers } },
  );
}

/** A plain (non-streamed) Chat Completions reply. */
export function plain(content: string, o: { finish?: string; usage?: object; contentType?: string; refusal?: string } = {}): Response {
  const body = { id: 'x', object: 'chat.completion', choices: [{ index: 0, message: { role: 'assistant', content, refusal: o.refusal ?? null }, finish_reason: o.finish ?? 'stop' }], usage: o.usage };
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': o.contentType ?? 'application/json' } });
}

/** An error reply shaped like OpenAI's. */
export function httpError(status: number, message: string, o: { code?: string; param?: string; headers?: Record<string, string> } = {}): Response {
  return new Response(JSON.stringify({ error: { message, type: 'invalid_request_error', code: o.code ?? null, param: o.param ?? null } }), {
    status,
    headers: { 'content-type': 'application/json', ...o.headers },
  });
}

/** A stream that sends `pieces` and then hangs until the request is aborted. */
export function hangingStream(pieces: string[], signal: AbortSignal | null | undefined): Response {
  return new Response(
    new ReadableStream({
      start(c) {
        c.enqueue(enc.encode(chunk({ role: 'assistant', content: '' })));
        for (const p of pieces) c.enqueue(enc.encode(chunk({ content: p })));
        signal?.addEventListener('abort', () => c.error(new DOMException('The operation was aborted.', 'AbortError')));
      },
    }),
    { status: 200, headers: { 'content-type': 'text/event-stream' } },
  );
}

/** A fetch that never answers, until aborted. */
export function never(req: SentRequest): Promise<Response> {
  return new Promise((_, reject) => {
    req.init.signal?.addEventListener('abort', () => reject(new DOMException('The operation was aborted.', 'AbortError')));
  });
}

export function fakeEndpoint(replies: Reply[]) {
  const sent: SentRequest[] = [];
  const fetch = async (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
    const headers: Record<string, string> = {};
    new Headers(init.headers).forEach((v, k) => (headers[k] = v));
    const req: SentRequest = { url: String(input), headers, body: init.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {}, init };
    sent.push(req);
    const reply = replies[sent.length - 1];
    if (!reply) throw new Error(`unexpected request #${sent.length} to ${req.url}`);
    return typeof reply === 'function' ? reply(req) : reply;
  };
  return { sent, fetch: fetch as typeof globalThis.fetch };
}

export function transport(fetch: typeof globalThis.fetch, over: Partial<Transport> = {}): Transport {
  return {
    baseUrl: 'https://ai.example.org/v1',
    headers: { 'X-Amble-Class': 'MAPLE-7Q2K' },
    via: 'endpoint',
    auth: 'class-code',
    caps: {},
    host: 'ai.example.org',
    fetch,
    isOnline: () => true,
    ...over,
  };
}

/** The text of the user message a request carried (string or parts). */
export function userContent(req: SentRequest): unknown {
  return (req.body.messages as Array<{ role: string; content: unknown }>)[1].content;
}

export function systemContent(req: SentRequest): string {
  return String((req.body.messages as Array<{ role: string; content: unknown }>)[0].content);
}
