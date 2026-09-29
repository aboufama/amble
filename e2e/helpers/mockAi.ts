/**
 * `mockAi` (§8.4, §10.2): an OpenAI-compatible endpoint at `https://ai.test/v1` for e2e tests.
 *
 * It answers by kind of request:
 * - `response_format.json_schema.name` `amble_plan`, `amble_explain` or `amble_rig`: the canned JSON in
 *   `opts.plan`, `opts.explain` or `opts.rig` (an object, or a file name in `e2e/fixtures/ai/`);
 * - a user message starting `Task: build|change|fix|resend|continue`: the next reply in `opts.patches`
 *   (a file name in `e2e/fixtures/ai/`, `{ text }`, or `{ status, body?, retryAfter? }` for an error);
 * - `/moderations`: `opts.moderation` (not flagged by default); `GET /models`: one model; anything else: "OK".
 *
 * Replies stream as SSE in 400-character chunks by default (`stream: false` answers with plain JSON;
 * `jsonForStream` answers stream requests with a plain JSON body). `firstByteDelayMs` holds the headers
 * back; `stallAfterChars` sends that much content and then hangs until the request is aborted.
 *
 * How: an init script wraps the page's `fetch` for `https://ai.test/` only, so replies really stream,
 * stall and abort in the page, and every request's exact body and headers are logged here. Call it
 * BEFORE the first `page.goto`. Calling it again on the same page updates the options and keeps the log.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';

export const AI_ORIGIN = 'https://ai.test';
export const AI_BASE = `${AI_ORIGIN}/v1`;
export const MOCK_MODEL = 'test-model';
export const CLASS_CODE = 'TEST-1234';
export const CLASS_HEADER = 'X-Amble-Class';

/** Facts the fixtures were written around (checked by tests/foundation/fixtures.test.ts). */
export const FIXTURE_FACTS = {
  /** change-throws.patch creates boss.js whose line 3 throws on the first `update`. */
  throwsAt: { file: 'boss.js', line: 3 },
  /** build-moon-king.patch (the player core's demo boss game, as the stub starters open) declares these art keys. */
  buildKeys: ['hero', 'boss', 'minion', 'ground', 'ledge', 'shot', 'orb', 'bomb'],
} as const;

const FIXTURE_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'ai');

/** A fixture file's text. */
export function aiFixture(name: string): string {
  return readFileSync(join(FIXTURE_DIR, name), 'utf8');
}

export interface ErrorReply {
  status: number;
  /** The JSON error body (default: an OpenAI-shaped error). */
  body?: unknown;
  /** Seconds, sent as `Retry-After`. */
  retryAfter?: number;
}
/** A fixture file name, the reply text itself, or an HTTP error. */
export type PatchReply = string | { text: string } | ErrorReply;
/** The JSON object itself, a fixture file name, or an HTTP error. */
export type JsonReply = string | ErrorReply | Record<string, unknown>;

export interface MockAiOptions {
  plan?: JsonReply;
  explain?: JsonReply;
  rig?: JsonReply;
  /** Replies to build, change, fix, resend and continue requests, in order. */
  patches?: PatchReply[];
  /** SSE in 400-character chunks for requests that ask to stream (default true). */
  stream?: boolean;
  /** Answer stream requests with a plain JSON body. */
  jsonForStream?: boolean;
  /** Wait this long before the response headers. */
  firstByteDelayMs?: number;
  /** Send this many characters of content, then hang until the request is aborted. */
  stallAfterChars?: number;
  /** Pause between SSE chunks (default 15 ms). */
  chunkDelayMs?: number;
  /** The moderation verdict (default: not flagged). */
  moderation?: { flagged: boolean; categories?: string[] };
  /** Every request fails like a CORS or network failure (`TypeError: Failed to fetch`). */
  networkError?: boolean;
}

export type MockAiKind = 'plan' | 'explain' | 'rig' | 'patch' | 'moderation' | 'models' | 'other';

export interface MockAiRequest {
  url: string;
  /** The path after `/v1` (`/chat/completions`). */
  path: string;
  method: string;
  /** Lower-case header names. */
  headers: Record<string, string>;
  /** The JSON body (null when there is none or it is not JSON). */
  body: any;
  raw: string;
  kind: MockAiKind;
  /** build | change | fix | resend | continue, for patch requests. */
  task: string | null;
  /** The text of the last user message. */
  userText: string;
  /** Whether the request asked to stream. */
  stream: boolean;
}

export interface MockAiLog {
  requests: MockAiRequest[];
  /** Problems with the mock itself (a patch request with no reply left). Tests should expect this empty. */
  errors: string[];
  ofKind(kind: MockAiKind): MockAiRequest[];
  /** Patch requests of one task (`'fix'`). */
  tasks(task: string): MockAiRequest[];
  /** Adds replies after the remaining ones. */
  queue(...replies: PatchReply[]): void;
  /** Changes options for the requests still to come. */
  set(o: Partial<MockAiOptions>): void;
}

/** What the page-side wrapper plays back (plain data, so it crosses into the page). */
interface Playback {
  status: number;
  headers: Record<string, string>;
  chunks: string[];
  chunkDelayMs: number;
  firstByteDelayMs: number;
  /** After this many chunks, hang until aborted. */
  stallAfterChunk: number | null;
  networkError: boolean;
}

interface State {
  opts: MockAiOptions;
  patches: PatchReply[];
  log: MockAiLog;
}

const STATES = new WeakMap<Page, State>();
const CHUNK = 400;

const isError = (v: unknown): v is ErrorReply => typeof v === 'object' && v !== null && typeof (v as { status?: unknown }).status === 'number';

function userTextOf(body: any): string {
  const messages: any[] = Array.isArray(body?.messages) ? body.messages : Array.isArray(body?.input) ? body.input : [];
  const user = [...messages].reverse().find((m) => m?.role === 'user');
  if (!user) return typeof body?.input === 'string' ? body.input : '';
  if (typeof user.content === 'string') return user.content;
  if (Array.isArray(user.content)) return user.content.map((p: any) => (typeof p?.text === 'string' ? p.text : '')).join('\n');
  return '';
}

function kindOf(path: string, method: string, body: any, userText: string): { kind: MockAiKind; task: string | null } {
  if (path.endsWith('/moderations')) return { kind: 'moderation', task: null };
  if (path.endsWith('/models') && method === 'GET') return { kind: 'models', task: null };
  const schema = body?.response_format?.json_schema?.name ?? body?.text?.format?.name ?? null;
  if (schema === 'amble_plan') return { kind: 'plan', task: null };
  if (schema === 'amble_explain') return { kind: 'explain', task: null };
  if (schema === 'amble_rig') return { kind: 'rig', task: null };
  const task = /^\s*Task:\s*(build|change|fix|resend|continue)\b/.exec(userText);
  if (task) return { kind: 'patch', task: task[1] };
  return { kind: 'other', task: null };
}

function sseEvent(delta: Record<string, unknown>, finish: string | null = null): string {
  return `data: ${JSON.stringify({ id: 'chatcmpl-mock', object: 'chat.completion.chunk', created: 0, model: MOCK_MODEL, choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
}

function completion(content: string): string {
  return JSON.stringify({
    id: 'chatcmpl-mock',
    object: 'chat.completion',
    created: 0,
    model: MOCK_MODEL,
    choices: [{ index: 0, message: { role: 'assistant', content, refusal: null }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 100, completion_tokens: Math.ceil(content.length / 4), total_tokens: 100 + Math.ceil(content.length / 4) },
  });
}

function errorPlayback(e: ErrorReply, o: MockAiOptions): Playback {
  const body = e.body ?? { error: { message: `Mock error ${e.status}`, type: 'mock_error', code: null, param: null } };
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (e.retryAfter !== undefined) headers['retry-after'] = String(e.retryAfter);
  return { status: e.status, headers, chunks: [typeof body === 'string' ? body : JSON.stringify(body)], chunkDelayMs: 0, firstByteDelayMs: o.firstByteDelayMs ?? 0, stallAfterChunk: null, networkError: false };
}

/** A chat reply carrying `content`, streamed or plain as the request and options say. */
function contentPlayback(content: string, stream: boolean, o: MockAiOptions): Playback {
  const base = { status: 200, chunkDelayMs: o.chunkDelayMs ?? 15, firstByteDelayMs: o.firstByteDelayMs ?? 0, networkError: false };
  const stall = o.stallAfterChars;
  if (!stream || o.stream === false || o.jsonForStream) {
    return { ...base, headers: { 'content-type': 'application/json' }, chunks: [completion(stall === undefined ? content : content.slice(0, stall))], stallAfterChunk: stall === undefined ? null : 1 };
  }
  const text = stall === undefined ? content : content.slice(0, stall);
  const chunks = [sseEvent({ role: 'assistant', content: '' })];
  for (let i = 0; i < text.length; i += CHUNK) chunks.push(sseEvent({ content: text.slice(i, i + CHUNK) }));
  if (stall !== undefined) return { ...base, headers: { 'content-type': 'text/event-stream' }, chunks, stallAfterChunk: chunks.length };
  chunks.push(sseEvent({}, 'stop'), 'data: [DONE]\n\n');
  return { ...base, headers: { 'content-type': 'text/event-stream' }, chunks, stallAfterChunk: null };
}

function jsonText(reply: JsonReply): string {
  return typeof reply === 'string' ? aiFixture(reply) : JSON.stringify(reply);
}

function patchText(reply: Exclude<PatchReply, ErrorReply>): string {
  return typeof reply === 'string' ? aiFixture(reply) : reply.text;
}

function answer(state: State, req: MockAiRequest): Playback {
  const o = state.opts;
  if (o.networkError) return { status: 0, headers: {}, chunks: [], chunkDelayMs: 0, firstByteDelayMs: o.firstByteDelayMs ?? 0, stallAfterChunk: null, networkError: true };
  switch (req.kind) {
    case 'moderation': {
      const flagged = o.moderation?.flagged ?? false;
      const names = o.moderation?.categories ?? (flagged ? ['violence'] : []);
      const categories = Object.fromEntries(['harassment', 'hate', 'self-harm', 'sexual', 'sexual/minors', 'violence'].map((c) => [c, names.includes(c)]));
      const scores = Object.fromEntries(Object.entries(categories).map(([c, on]) => [c, on ? 0.97 : 0.001]));
      return { status: 200, headers: { 'content-type': 'application/json' }, chunks: [JSON.stringify({ id: 'modr-mock', model: 'omni-moderation-latest', results: [{ flagged, categories, category_scores: scores }] })], chunkDelayMs: 0, firstByteDelayMs: 0, stallAfterChunk: null, networkError: false };
    }
    case 'models':
      return { status: 200, headers: { 'content-type': 'application/json' }, chunks: [JSON.stringify({ object: 'list', data: [{ id: MOCK_MODEL, object: 'model', owned_by: 'school' }] })], chunkDelayMs: 0, firstByteDelayMs: 0, stallAfterChunk: null, networkError: false };
    case 'plan':
    case 'explain':
    case 'rig': {
      const reply = o[req.kind];
      if (reply === undefined) {
        state.log.errors.push(`mockAi: no ${req.kind} reply configured`);
        return errorPlayback({ status: 500 }, o);
      }
      if (isError(reply)) return errorPlayback(reply, o);
      return contentPlayback(jsonText(reply), req.stream, o);
    }
    case 'patch': {
      const reply = state.patches.shift();
      if (reply === undefined) {
        state.log.errors.push(`mockAi: no patch reply left for a ${req.task} request`);
        return errorPlayback({ status: 500 }, o);
      }
      if (isError(reply)) return errorPlayback(reply, o);
      return contentPlayback(patchText(reply), req.stream, o);
    }
    default:
      return contentPlayback('OK', req.stream, o);
  }
}

/** The page side: wraps `fetch` for https://ai.test/ in the top frame and plays back what Node decides. */
function pageScript(): void {
  if (window.top !== window) return;
  const w = window as unknown as { fetch: typeof fetch; __ambleMockAi(req: unknown): Promise<Playback> };
  const real = w.fetch.bind(window);
  const aborted = () => new DOMException('The operation was aborted.', 'AbortError');
  const sleep = (ms: number, signal: AbortSignal) =>
    new Promise<void>((resolve, reject) => {
      if (signal.aborted) return reject(aborted());
      if (!ms) return resolve();
      const t = setTimeout(resolve, ms);
      signal.addEventListener('abort', () => {
        clearTimeout(t);
        reject(aborted());
      }, { once: true });
    });
  w.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    let request: Request;
    try {
      request = new Request(input, init);
    } catch {
      return real(input, init);
    }
    if (!request.url.startsWith('https://ai.test/')) return real(input, init);
    const signal = request.signal;
    if (signal.aborted) throw aborted();
    const headers: Record<string, string> = {};
    request.headers.forEach((v, k) => {
      headers[k] = v;
    });
    const body = request.method === 'GET' || request.method === 'HEAD' ? '' : await request.clone().text();
    const plan = await w.__ambleMockAi({ url: request.url, method: request.method, headers, body });
    await sleep(plan.firstByteDelayMs, signal);
    if (plan.networkError) throw new TypeError('Failed to fetch');
    const enc = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const onAbort = () => {
          try {
            controller.error(aborted());
          } catch {
            // already closed
          }
        };
        signal.addEventListener('abort', onAbort, { once: true });
        void (async () => {
          try {
            for (let i = 0; i < plan.chunks.length; i++) {
              if (i > 0) await sleep(plan.chunkDelayMs, signal);
              controller.enqueue(enc.encode(plan.chunks[i]));
              if (plan.stallAfterChunk !== null && i + 1 >= plan.stallAfterChunk) return;
            }
            if (plan.stallAfterChunk !== null) return;
            signal.removeEventListener('abort', onAbort);
            controller.close();
          } catch {
            // aborted: the stream already errored
          }
        })();
      },
    });
    return new Response(stream, { status: plan.status, headers: plan.headers });
  };
}

/** Starts the mock endpoint for this page (before `page.goto`); returns the request log. */
export async function mockAi(page: Page, opts: MockAiOptions = {}): Promise<MockAiLog> {
  const existing = STATES.get(page);
  if (existing) {
    existing.opts = { ...existing.opts, ...opts };
    if (opts.patches) existing.patches = [...opts.patches];
    return existing.log;
  }
  const requests: MockAiRequest[] = [];
  const state: State = {
    opts: { ...opts },
    patches: [...(opts.patches ?? [])],
    log: {
      requests,
      errors: [],
      ofKind: (kind) => requests.filter((r) => r.kind === kind),
      tasks: (task) => requests.filter((r) => r.kind === 'patch' && r.task === task),
      queue: (...replies) => {
        state.patches.push(...replies);
      },
      set: (o) => {
        state.opts = { ...state.opts, ...o };
        if (o.patches) state.patches = [...o.patches];
      },
    },
  };
  STATES.set(page, state);
  await page.exposeFunction('__ambleMockAi', (req: { url: string; method: string; headers: Record<string, string>; body: string }): Playback => {
    let body: any = null;
    try {
      body = req.body ? JSON.parse(req.body) : null;
    } catch {
      body = null;
    }
    const url = new URL(req.url);
    const path = url.pathname.replace(/^\/v1/, '');
    const userText = userTextOf(body);
    const { kind, task } = kindOf(path, req.method, body, userText);
    const entry: MockAiRequest = { url: req.url, path, method: req.method, headers: req.headers, body, raw: req.body, kind, task, userText, stream: body?.stream === true };
    requests.push(entry);
    return answer(state, entry);
  });
  await page.addInitScript(pageScript);
  return state.log;
}
