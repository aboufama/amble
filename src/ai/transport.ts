/**
 * The transport: `chatJson` and `chatText`, the two request primitives, on Chat Completions (the
 * wire format with the widest support among district proxies: LiteLLM, vLLM, Ollama, Azure
 * gateways). All AI traffic leaves through here (and `wire/fetch.ts`, its one door).
 *
 * Every call:
 * - streams when it can, and reads a plain JSON answer when a proxy ignores `stream: true`;
 * - drops features the endpoint rejects with a 400 (pictures, streaming, strict schemas, token
 *   limits, `store`, `safety_identifier`, reasoning effort) and tries again;
 * - retries 429, 5xx and network errors with backoff and jitter, honoring Retry-After;
 * - gives up on a stalled stream, a total deadline, or the caller's AbortSignal;
 * - fails with a typed `AiError` a student can read.
 */
import { aiError } from './errors';
import { parseJsonReply } from './json/parse';
import { checkJson, clampJson, wireSchema, type JsonSchema } from './json/schema';
import { buildBody, downgrade, hasImages, initialOptions, type JsonSpec, type ReplyFormat, type WireOptions } from './wire/body';
import { codexRun } from './wire/codex';
import { classify, failureOf, isRetryable, parseRetryAfter, retryDelay, retryReason, type Failure } from './wire/failures';
import { aiFetch, sleep, Watchdog, type AbortCause } from './wire/fetch';
import { knownUnsupported, rememberUnsupported } from './wire/learned';
import { addUsage, emptyReply, readChatReply, readHttpFailure, type ReplyState } from './wire/reply';
import type { ChatJsonRequest, ChatJsonResult, ChatRequestBase, ChatTextRequest, ChatTextResult, Transport, Usage } from './wire/types';

export type {
  Capabilities,
  ChatJsonRequest,
  ChatJsonResult,
  ChatMessage,
  ChatRequestBase,
  ChatStatus,
  ChatTextRequest,
  ChatTextResult,
  ContentPart,
  FallbackFeature,
  ReasoningEffort,
  Transport,
  Usage,
} from './wire/types';

export const DEFAULT_TIMEOUT_MS = 10 * 60_000;
export const DEFAULT_STALL_MS = 90_000;
export const DEFAULT_RETRIES = 3;
const MAX_FALLBACKS = 10;

/** Codex answers only JSON, so text replies travel in one field. */
const TEXT_SCHEMA: JsonSchema = { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false };
const TEXT_NOTE = 'Put your whole reply, exactly as you would write it, in the "text" field.';

interface Call {
  t: Transport;
  json: JsonSpec | null;
  opts: WireOptions;
  deadline: number;
  safetyId: string | null;
  hadImages: boolean;
}

interface Completion {
  state: ReplyState;
  format: ReplyFormat;
  /** A text reply that stopped early; `state.content` holds what arrived. */
  interrupted: boolean;
  usage: Usage | null;
}

function online(t: Transport): boolean {
  if (t.isOnline) return t.isOnline();
  const nav = (globalThis as { navigator?: { onLine?: boolean } }).navigator;
  return nav?.onLine !== false;
}

function ctxOf(t: Transport) {
  return { host: t.host, auth: t.auth, online: online(t) };
}

function abortFailure(cause: AbortCause, partial: string): Failure {
  return cause === 'user' ? { kind: 'cancelled' } : { kind: 'timeout', which: cause, partial };
}

async function startCall(t: Transport, req: ChatRequestBase, json: JsonSpec | null): Promise<Call> {
  const safetyId = t.safetyIdentifier ? await t.safetyIdentifier().catch(() => null) : null;
  const noVision = knownUnsupported(t.baseUrl, 'images', req.model);
  const opts = initialOptions(t.caps, req, json, { noVision, safetyId: Boolean(safetyId) });
  if (t.via === 'codex') {
    opts.stream = false;
    opts.streamUsage = false;
  }
  return { t, json, opts, deadline: Date.now() + (req.timeoutMs ?? DEFAULT_TIMEOUT_MS), safetyId, hadImages: hasImages(req.user) };
}

/** A text reply that broke off is kept, unless a filter stopped it. */
function keepsPartial(f: Failure): boolean {
  if (f.kind === 'network' || f.kind === 'timeout') return true;
  return f.kind === 'stream' && f.code !== 'content_filter' && !/content[_ ]?filter/i.test(f.message);
}

async function attempt(call: Call, req: ChatRequestBase, dog: Watchdog, state: ReplyState, onDelta?: (delta: string, text: string) => void): Promise<void> {
  const { t, json, opts } = call;
  const stallMs = req.stallMs ?? DEFAULT_STALL_MS;
  req.onStatus?.({ phase: 'waiting' });
  if (t.via === 'codex') {
    const schema = json ? wireSchema(json.schema) : TEXT_SCHEMA;
    const codexReq = json ? req : { ...req, system: `${req.system}\n\n${TEXT_NOTE}` };
    const text = await codexRun(t, codexReq, schema, opts.images, dog.signal, (ev) => {
      if (ev.type === 'progress') req.onStatus?.({ phase: ev.phase });
      else if (ev.type === 'usage') {
        const u = ev.usage;
        state.usage = { inputTokens: u.inputTokens, outputTokens: u.outputTokens, totalTokens: u.inputTokens + u.outputTokens, reasoningTokens: 0, cachedTokens: u.cachedInputTokens, requests: 1 };
      }
    });
    state.content = json ? text : unwrapText(text);
    state.finishReason = 'stop';
    req.onStatus?.({ phase: 'writing', chars: state.content.length });
    onDelta?.(state.content, state.content);
    return;
  }
  const res = await aiFetch(t, '/chat/completions', { method: 'POST', body: buildBody(req, opts, json, call.safetyId), signal: dog.signal });
  dog.started();
  if (!res.ok) throw await readHttpFailure(res, parseRetryAfter(res.headers));
  let writing = false;
  await readChatReply(res, state, {
    onBytes: () => {
      if (writing) dog.alive(stallMs);
    },
    onContent: (delta, content) => {
      writing = true;
      dog.alive(stallMs);
      req.onStatus?.({ phase: 'writing', chars: content.length });
      onDelta?.(delta, content);
    },
  });
}

function unwrapText(text: string): string {
  const parsed = parseJsonReply(text);
  if (parsed.ok && parsed.value && typeof parsed.value === 'object' && 'text' in parsed.value && typeof parsed.value.text === 'string') return parsed.value.text;
  return text;
}

/** One logical request: retried, downgraded and timed until it succeeds or fails for good. */
async function complete(call: Call, req: ChatRequestBase, onDelta?: (delta: string, text: string) => void): Promise<Completion> {
  const { t } = call;
  const retries = t.via === 'codex' ? 0 : (req.retries ?? DEFAULT_RETRIES);
  let usage: Usage | null = null;
  let retry = 0;
  let fallbacks = 0;
  for (;;) {
    if (req.signal?.aborted) throw aiError('cancelled', { host: t.host });
    if (!online(t)) throw aiError('offline', { host: t.host });
    const left = call.deadline - Date.now();
    if (left <= 0) throw classify({ kind: 'timeout', which: 'total', partial: '' }, ctxOf(t));
    const state = emptyReply();
    const dog = new Watchdog(req.signal, left, req.firstByteMs);
    try {
      await attempt(call, req, dog, state, onDelta);
      usage = addUsage(usage, state.usage);
      return { state, format: call.opts.format, interrupted: false, usage };
    } catch (err) {
      const f = dog.cause ? abortFailure(dog.cause, state.content) : failureOf(err);
      usage = addUsage(usage, state.usage);
      if (f.kind === 'cancelled') throw aiError('cancelled', { host: t.host });
      if (!call.json && state.content && keepsPartial(f)) return { state, format: 'text', interrupted: true, usage };
      const dropped = fallbacks < MAX_FALLBACKS ? downgrade(call.opts, f, req) : null;
      if (dropped) {
        fallbacks++;
        if (dropped === 'images') rememberUnsupported(t.baseUrl, 'images', req.model);
        req.onStatus?.({ phase: 'fallback', dropped });
        continue;
      }
      if (retry < retries && isRetryable(f) && online(t)) {
        const delay = retryDelay(f, retry);
        if (delay !== null && delay < call.deadline - Date.now() - 1000) {
          retry++;
          req.onStatus?.({ phase: 'retrying', attempt: retry, delayMs: delay, reason: retryReason(f) });
          try {
            await sleep(delay, req.signal);
          } catch {
            throw aiError('cancelled', { host: t.host });
          }
          continue;
        }
      }
      throw classify(f, ctxOf(t));
    } finally {
      dog.dispose();
    }
  }
}

function checkFinish(t: Transport, s: ReplyState): void {
  if (s.refusal) throw aiError('refused', { host: t.host, detail: `The model refused: ${s.refusal}` });
  if (s.finishReason === 'content_filter') throw aiError('refused', { host: t.host, code: 'content_filter', detail: 'A content filter stopped the reply.' });
}

/**
 * Streams a free-text reply (for example an AMBLE PATCH envelope). A reply cut short by the token
 * limit, a stall or a dropped connection resolves with `truncated: true` and the text that arrived.
 */
export async function chatText(t: Transport, req: ChatTextRequest): Promise<ChatTextResult> {
  const call = await startCall(t, req, null);
  const c = await complete(call, req, req.onDelta);
  checkFinish(t, c.state);
  const truncated = c.interrupted || c.state.finishReason === 'length';
  if (!c.state.content) {
    throw aiError(truncated ? 'too-long' : 'bad-reply', { host: t.host, detail: truncated ? 'The reply ran out of room before any text arrived.' : 'The reply was empty.' });
  }
  const result: ChatTextResult = {
    text: c.state.content,
    finishReason: c.interrupted ? 'interrupted' : c.state.finishReason,
    truncated,
    usage: c.usage,
    imagesDropped: call.hadImages && !call.opts.images,
  };
  req.onDone?.(result);
  return result;
}

function repairMessage(problems: string[]): string {
  return [
    'Your reply could not be used:',
    ...problems.slice(0, 12).map((p) => `- ${p}`),
    'Reply again with only the corrected JSON object, following the schema exactly.',
  ].join('\n');
}

/**
 * Asks for a JSON reply of a known shape: strict `json_schema` first, then `json_object`, then the
 * schema in the prompt, whatever the endpoint accepts. The reply is parsed, clamped and checked
 * against the schema; a bad reply gets `repairs` rounds (default 1) with the problems sent back.
 */
export async function chatJson<T>(t: Transport, req: ChatJsonRequest<T>): Promise<ChatJsonResult<T>> {
  const schema = req.schema.json;
  const call = await startCall(t, req, { schema, name: req.schemaName });
  let repairsLeft = req.repairs ?? 1;
  let usage: Usage | null = null;
  let current: ChatRequestBase = req;
  let repaired = false;
  for (;;) {
    const c = await complete(call, current, req.onDelta);
    usage = addUsage(usage, c.usage);
    checkFinish(t, c.state);
    if (c.state.finishReason === 'length') throw aiError('too-long', { host: t.host, detail: 'The reply ran out of room (finish_reason: length).' });
    const parsed = parseJsonReply(c.state.content);
    const value = parsed.ok && req.clamp !== false ? clampJson(parsed.value, schema) : parsed.ok ? parsed.value : undefined;
    const problems = parsed.ok ? checkJson(value, schema) : [parsed.error];
    if (problems.length === 0) {
      const format = c.format === 'text' ? 'prompt' : c.format;
      return { value: value as T, usage, format, imagesDropped: call.hadImages && !call.opts.images, repaired };
    }
    if (repairsLeft <= 0) throw aiError('bad-reply', { host: t.host, detail: problems.join('\n') });
    repairsLeft--;
    repaired = true;
    req.onStatus?.({ phase: 'repairing', problems });
    current = {
      ...req,
      messages: [...(req.messages ?? []), { role: 'assistant', content: c.state.content }, { role: 'user', content: repairMessage(problems) }],
    };
  }
}

/**
 * A minimal request that proves the endpoint, credentials and model work (Settings "Test").
 * Never needs `/models`, which many proxies don't offer. Resolves with the round-trip time.
 */
export async function pingModel(t: Transport, model: string, opts: { signal?: AbortSignal; timeoutMs?: number } = {}): Promise<number> {
  const started = Date.now();
  const req: ChatRequestBase = { model, system: 'You check that a connection works.', user: 'Reply with the word OK.', maxTokens: 16, signal: opts.signal, timeoutMs: opts.timeoutMs ?? 60_000, retries: 1 };
  const call = await startCall({ ...t, caps: { ...t.caps, stream: false } }, req, null);
  await complete(call, req);
  return Date.now() - started;
}

/** Model ids the endpoint lists, for a Settings suggestion list. Optional: many proxies don't offer it. */
export async function listModels(t: Transport, signal?: AbortSignal): Promise<string[]> {
  const dog = new Watchdog(signal, 30_000, undefined);
  try {
    const res = await aiFetch(t, '/models', { method: 'GET', signal: dog.signal });
    if (!res.ok) throw await readHttpFailure(res, undefined);
    const body = (await res.json()) as { data?: Array<{ id?: unknown }> };
    return (body.data ?? []).flatMap((m) => (typeof m.id === 'string' ? [m.id] : [])).sort();
  } catch (err) {
    throw classify(dog.cause ? abortFailure(dog.cause, '') : failureOf(err), ctxOf(t));
  } finally {
    dog.dispose();
  }
}
