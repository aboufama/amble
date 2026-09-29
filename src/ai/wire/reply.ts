/**
 * Reads a Chat Completions reply, streamed (SSE) or not. The format is decided by the bytes, not
 * the request: some proxies ignore `stream: true` and answer with one JSON object, and filters
 * sometimes answer with an HTML block page, which becomes a `blocked-by-filter` error.
 */
import { TransportFailure } from './failures';
import type { Usage } from './types';

export interface ReplyState {
  content: string;
  refusal: string;
  finishReason: string | null;
  usage: Usage | null;
}

export interface ReadHooks {
  /** Bytes arrived (resets the stall timer). */
  onBytes(): void;
  /** Model text arrived. */
  onContent(delta: string, content: string): void;
}

interface WireMessage {
  content?: unknown;
  refusal?: unknown;
}

interface WireChoice {
  delta?: WireMessage | null;
  message?: WireMessage | null;
  text?: unknown;
  finish_reason?: unknown;
}

interface WireUsage {
  prompt_tokens?: unknown;
  completion_tokens?: unknown;
  total_tokens?: unknown;
  input_tokens?: unknown;
  output_tokens?: unknown;
  prompt_tokens_details?: { cached_tokens?: unknown } | null;
  completion_tokens_details?: { reasoning_tokens?: unknown } | null;
}

interface WireChunk {
  choices?: WireChoice[] | null;
  usage?: WireUsage | null;
  error?: { message?: unknown; code?: unknown } | string | null;
}

export function emptyReply(): ReplyState {
  return { content: '', refusal: '', finishReason: null, usage: null };
}

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

export function readUsage(u: WireUsage): Usage {
  const inputTokens = num(u.prompt_tokens) || num(u.input_tokens);
  const outputTokens = num(u.completion_tokens) || num(u.output_tokens);
  return {
    inputTokens,
    outputTokens,
    totalTokens: num(u.total_tokens) || inputTokens + outputTokens,
    reasoningTokens: num(u.completion_tokens_details?.reasoning_tokens),
    cachedTokens: num(u.prompt_tokens_details?.cached_tokens),
    requests: 1,
  };
}

export function addUsage(a: Usage | null, b: Usage | null): Usage | null {
  if (!a) return b;
  if (!b) return a;
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    totalTokens: a.totalTokens + b.totalTokens,
    reasoningTokens: a.reasoningTokens + b.reasoningTokens,
    cachedTokens: a.cachedTokens + b.cachedTokens,
    requests: a.requests + b.requests,
  };
}

/** Message content is a string, or (some providers) an array of text parts. */
function textOf(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map((p: unknown) => (p && typeof p === 'object' && 'text' in p && typeof p.text === 'string' ? p.text : '')).join('');
}

function isChunk(v: unknown): v is WireChunk {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function handleChunk(chunk: WireChunk, state: ReplyState, hooks: ReadHooks): void {
  if (chunk.error) {
    const e = chunk.error;
    const message = typeof e === 'string' ? e : typeof e.message === 'string' ? e.message : 'The reply stopped with an error.';
    const code = typeof e === 'object' && typeof e.code === 'string' ? e.code : undefined;
    throw new TransportFailure({ kind: 'stream', message, code, partial: state.content });
  }
  if (chunk.usage) state.usage = readUsage(chunk.usage);
  const choice = chunk.choices?.[0];
  if (!choice) return;
  const message = choice.delta ?? choice.message;
  const piece = textOf(message?.content) || (typeof choice.text === 'string' ? choice.text : '');
  if (piece) {
    state.content += piece;
    hooks.onContent(piece, state.content);
  }
  if (typeof message?.refusal === 'string') state.refusal += message.refusal;
  if (typeof choice.finish_reason === 'string') state.finishReason = choice.finish_reason;
}

function parseLine(line: string, state: ReplyState, hooks: ReadHooks): void {
  const l = line.endsWith('\r') ? line.slice(0, -1) : line;
  if (!l.startsWith('data:')) return;
  const data = l.slice(5).trim();
  if (!data || data === '[DONE]') return;
  let chunk: unknown;
  try {
    chunk = JSON.parse(data);
  } catch {
    return;
  }
  if (isChunk(chunk)) handleChunk(chunk, state, hooks);
}

function parseWhole(text: string, state: ReplyState, hooks: ReadHooks): void {
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new TransportFailure({ kind: 'stream', message: 'The reply was cut off before it was complete.', partial: state.content });
  }
  if (isChunk(body)) handleChunk(body, state, hooks);
}

/**
 * Reads the whole reply into `state`, calling `hooks` as it goes. On a failure mid-way, `state`
 * still holds what arrived.
 */
export async function readChatReply(res: Response, state: ReplyState, hooks: ReadHooks): Promise<void> {
  if (/text\/html/i.test(res.headers.get('content-type') ?? '')) throw new TransportFailure({ kind: 'html', status: res.status });
  const reader = res.body?.getReader();
  if (!reader) return;
  const decoder = new TextDecoder();
  // Decided by the first bytes; an object, so the closure's assignment is visible below.
  const format: { mode: 'unknown' | 'sse' | 'json' } = { mode: 'unknown' };
  let buffer = '';
  const feed = (text: string) => {
    buffer += text;
    if (format.mode === 'unknown') {
      const first = buffer.trimStart()[0];
      if (!first) return;
      if (first === '<') throw new TransportFailure({ kind: 'html', status: res.status });
      format.mode = first === '{' || first === '[' ? 'json' : 'sse';
    }
    if (format.mode !== 'sse') return;
    let i: number;
    while ((i = buffer.indexOf('\n')) >= 0) {
      parseLine(buffer.slice(0, i), state, hooks);
      buffer = buffer.slice(i + 1);
    }
  };
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    hooks.onBytes();
    feed(decoder.decode(value, { stream: true }));
  }
  feed(decoder.decode());
  if (format.mode === 'sse' && buffer.trim()) parseLine(buffer, state, hooks);
  if (format.mode === 'json') parseWhole(buffer, state, hooks);
}

/** FastAPI-style servers (vLLM and others) answer 422 with `{detail: [{loc: ['body', 'store'], msg}]}`. */
function fastApiDetail(detail: unknown): string {
  if (typeof detail === 'string') return detail;
  if (!Array.isArray(detail)) return '';
  return detail
    .map((d: unknown) => {
      if (!d || typeof d !== 'object') return '';
      const loc = 'loc' in d && Array.isArray(d.loc) ? d.loc.join('.') : '';
      const msg = 'msg' in d && typeof d.msg === 'string' ? d.msg : '';
      return loc ? `${loc}: ${msg}` : msg;
    })
    .filter(Boolean)
    .join('; ');
}

/** The error in a non-2xx reply: provider message, code and parameter, whatever the body format. */
export async function readHttpFailure(res: Response, retryAfterMs: number | undefined): Promise<TransportFailure> {
  const type = res.headers.get('content-type') ?? '';
  let text = '';
  try {
    text = await res.text();
  } catch {
    // The body is optional; the status says enough.
  }
  const html = /text\/html/i.test(type) || /^\s*</.test(text);
  let message = `${res.status} ${res.statusText}`.trim();
  let code: string | undefined;
  let param: string | undefined;
  if (!html) {
    try {
      const body: unknown = JSON.parse(text);
      const err = isChunk(body) ? body.error : undefined;
      if (typeof err === 'string') message = err;
      else if (err && typeof err === 'object') {
        if (typeof err.message === 'string' && err.message) message = err.message;
        if (typeof err.code === 'string') code = err.code;
        const p = (err as { param?: unknown }).param;
        if (typeof p === 'string') param = p;
        const t = (err as { type?: unknown }).type;
        if (!code && typeof t === 'string') code = t;
      } else if (body && typeof body === 'object' && 'detail' in body) {
        message = fastApiDetail(body.detail) || message;
      }
    } catch {
      if (text.trim()) message = text.trim().slice(0, 300);
    }
  }
  return new TransportFailure({ kind: 'http', status: res.status, message, code, param, retryAfterMs, html });
}
