/**
 * Minimal OpenAI client (Chat Completions + Images). Works directly from the browser with a
 * key from Settings, through the dev server's `/api/openai` proxy when OPENAI_API_KEY is set
 * there, or, when Amble runs on your computer, with your ChatGPT sign-in through Codex
 * (src/compiler/chatgpt.ts). Any OpenAI-compatible endpoint can be used via the base URL setting.
 */
import { fetchCodexStatus } from './chatgpt';
import type { CodexRunEvent } from './codexTypes';
import { devServerConfig } from './devServer';
import { DEFAULT_IMAGE_MODEL, DEFAULT_MODE, modeSettings } from './models';
import { harness } from './harness';
import { chatTokens, imageTokens, recordPlanCall, recordUsage, type ChatUsage, type ImageUsage, type SpendKind } from './spend';

export type ReasoningEffort = 'default' | 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export interface AiSettings {
  /** Compile with your ChatGPT sign-in (Codex on this computer) instead of an API key. */
  useChatGpt: boolean;
  apiKey: string;
  baseUrl: string;
  model: string;
  reasoningEffort: ReasoningEffort;
  /** Model used for compiled assets (SVG art and sounds). Empty = same as `model`. */
  assetModel: string;
  /** How compiled costumes are drawn: vector art written by the chat model, or an image model. */
  artMode: 'svg' | 'image';
  imageModel: string;
}

/** New settings start in the Best mode (GPT-6.1 Terra, high reasoning): see src/compiler/models.ts. */
export const DEFAULT_SETTINGS: AiSettings = {
  useChatGpt: false,
  apiKey: '',
  baseUrl: 'https://api.openai.com/v1',
  ...modeSettings(DEFAULT_MODE),
  artMode: 'svg',
  imageModel: DEFAULT_IMAGE_MODEL,
};

/** Signed-in compiles use GPT-6 Astra with low reasoning: the preset ChatGPT calls "Astra Light". */
export const CHATGPT_MODEL = 'gpt-6-astra';
export const CHATGPT_REASONING: ReasoningEffort = 'low';
export const CHATGPT_MODEL_NAME = 'GPT-6 Astra Light';

export interface Transport {
  baseUrl: string;
  headers: Record<string, string>;
  /** "chatgpt" = your ChatGPT sign-in via Codex; "browser" = key in this browser; "server" = the server's key (dev server or hosted). */
  via: 'chatgpt' | 'browser' | 'server';
  /** The requests go to OpenRouter (a key for it in this browser, or the server's proxy to it). */
  router?: 'openrouter';
}

/** Through OpenRouter, a model named the OpenAI way ("gpt-6.2-sol") is "openai/gpt-6.2-sol". */
export const routedName = (model: string) => (model && !model.includes('/') ? `openai/${model}` : model);

/**
 * The settings a request really uses: the ChatGPT sign-in always runs GPT-6 Astra Light; through
 * OpenRouter, the models get OpenRouter's names (and with them its routing: see `harness().providerOrder`).
 */
export function effectiveSettings(settings: AiSettings, t: Transport): AiSettings {
  if (t.router === 'openrouter') return { ...settings, model: routedName(settings.model.trim()), assetModel: settings.assetModel.trim() ? routedName(settings.assetModel.trim()) : '' };
  if (t.via !== 'chatgpt') return settings;
  // Codex only answers with text, so compiled art is always vector drawings.
  return { ...settings, model: CHATGPT_MODEL, reasoningEffort: CHATGPT_REASONING, assetModel: CHATGPT_MODEL, artMode: 'svg' };
}

/** Does the server (dev, preview or hosted) have OPENAI_API_KEY configured? */
export function hasServerKey(): Promise<boolean> {
  return devServerConfig().then((c) => c.serverKey);
}

export async function resolveTransport(settings: AiSettings): Promise<Transport | null> {
  if (settings.useChatGpt) {
    const codex = await fetchCodexStatus();
    // No bridge means this isn't a local run (e.g. GitHub Pages): fall back to a key.
    if (codex) {
      if (codex.auth !== 'chatgpt') throw new AiError("Codex on this computer isn't signed in with ChatGPT anymore. Sign in with ChatGPT again, or sign out in Settings to use an API key.");
      return { baseUrl: '/api/codex', headers: {}, via: 'chatgpt' };
    }
  }
  if (settings.apiKey.trim()) {
    const baseUrl = (settings.baseUrl || DEFAULT_SETTINGS.baseUrl).replace(/\/+$/, '');
    return {
      baseUrl,
      headers: { Authorization: `Bearer ${settings.apiKey.trim()}` },
      via: 'browser',
      ...(/^https?:\/\/([\w-]+\.)*openrouter\.ai(\/|:|$)/i.test(baseUrl) ? { router: 'openrouter' as const } : {}),
    };
  }
  const server = await devServerConfig();
  if (server.serverKey) return { baseUrl: '/api/openai', headers: {}, via: 'server', ...(server.upstream === 'openrouter' ? { router: 'openrouter' as const } : {}) };
  return null;
}

export class AiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'AiError';
  }
}

export function isReasoningModel(model: string): boolean {
  return /^(?:openai\/)?(o\d|gpt-[5-9])/i.test(model.trim());
}

/** An OpenRouter-style id ("anthropic/claude-opus-5.5"): a provider, a slash, a model. */
export function isRoutedModel(model: string): boolean {
  return /^[\w.-]+\/[\w.:-]+$/.test(model.trim());
}

export type ContentPart = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string; detail?: 'low' | 'high' | 'auto' } };

export interface ChatJsonRequest {
  model: string;
  system: string;
  user: string | ContentPart[];
  /** JSON schema for the reply (Structured Outputs, strict). */
  schema: Record<string, unknown>;
  schemaName: string;
  reasoningEffort?: ReasoningEffort;
  signal?: AbortSignal;
  onProgress?(progress: { phase: 'waiting' | 'writing'; chars: number }): void;
  /** The reply so far, as it streams in (not called when the reply comes in one piece). */
  onText?(text: string): void;
  /** What the request makes, for the spend counter. */
  kind?: SpendKind;
}

async function readError(res: Response, t: Transport): Promise<AiError> {
  let message = `${res.status} ${res.statusText}`;
  let code: string | undefined;
  try {
    const body = (await res.json()) as { error?: { message?: string; code?: unknown; metadata?: { raw?: unknown } } };
    if (body.error?.message) message = body.error.message;
    // OpenRouter answers with a numeric code (the HTTP status) and the provider's own words in metadata.raw.
    if (typeof body.error?.metadata?.raw === 'string' && body.error.metadata.raw.trim()) message = `${message}: ${body.error.metadata.raw.trim().slice(0, 400)}`;
    code = body.error?.code === undefined || body.error?.code === null ? undefined : String(body.error.code);
  } catch {
    /* not JSON */
  }
  return errorFrom(res.status, message, code, t);
}

/** An error the server put in the body after answering 200 (see keepWarm in api/amble.ts). */
interface BodyError {
  message?: string;
  code?: string | null;
  status?: number;
}

function bodyError(e: BodyError, t: Transport): AiError {
  const message = e.message || 'The compile request stopped partway.';
  const code = e.code === undefined || e.code === null ? undefined : String(e.code);
  return typeof e.status === 'number' ? errorFrom(e.status, message, code, t) : new AiError(message, undefined, code);
}

function errorFrom(status: number, message: string, code: string | undefined, t: Transport): AiError {
  // The server's own refusals (a model it doesn't run, too many builds) already say what to do.
  if (code?.startsWith('amble_')) return new AiError(message, status, code);
  if (status === 401) {
    message = t.via === 'server' ? `This site's OpenAI key was rejected (${message}). Ask whoever runs the site to check it.` : `Your OpenAI API key was rejected (${message}). Check it in Settings.`;
  }
  if (status === 429 && !/quota/i.test(message)) message = `Rate limited by OpenAI: ${message}`;
  return new AiError(message, status, code);
}

/** Pulls the JSON object out of a reply (tolerates code fences from non-strict providers). */
export function parseJsonReply<T>(text: string): T {
  let t = text.trim();
  const fence = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(t);
  if (fence) t = fence[1];
  if (!t.startsWith('{')) {
    const start = t.indexOf('{');
    const end = t.lastIndexOf('}');
    if (start >= 0 && end > start) t = t.slice(start, end + 1);
  }
  try {
    return JSON.parse(t) as T;
  } catch (err) {
    throw new AiError(`The compiler's reply wasn't valid JSON (${(err as Error).message}).`);
  }
}

interface Options {
  stream: boolean;
  /** Ask for token usage at the end of the stream (for the spend counter). */
  usage: boolean;
  format: 'json_schema' | 'json_object';
  effort: boolean;
}

/** How long to wait (ms) before each retry of a rate-limited request: about a minute and a half in all. */
const RATE_LIMIT_WAITS = [2_000, 5_000, 10_000, 20_000, 40_000];

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(new DOMException('Aborted', 'AbortError'));
      },
      { once: true },
    );
  });
}

/** Sends a chat request and returns the parsed JSON reply. Retries without features a model/account rejects. */
export async function chatJson<T>(t: Transport, req: ChatJsonRequest): Promise<T> {
  if (t.via === 'chatgpt') return parseJsonReply<T>(await codexOnce(req));
  const opts: Options = { stream: true, usage: true, format: 'json_schema', effort: Boolean(req.reasoningEffort && req.reasoningEffort !== 'default') };
  let waits = 0;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const text = await chatOnce(t, req, opts);
      return parseJsonReply<T>(text);
    } catch (err) {
      // Rate limited (a burst of art requests, or a new account's per-minute cap): wait and try again.
      if (err instanceof AiError && err.status === 429 && !/quota|billing|credit/i.test(err.message) && waits < RATE_LIMIT_WAITS.length && !req.signal?.aborted) {
        await sleep(RATE_LIMIT_WAITS[waits++] * (0.75 + Math.random() * 0.5), req.signal);
        attempt--;
        continue;
      }
      if (!(err instanceof AiError) || err.status !== 400) throw err;
      const m = err.message.toLowerCase();
      if (opts.stream && opts.usage && (m.includes('stream_options') || m.includes('include_usage'))) opts.usage = false;
      else if (opts.stream && m.includes('stream')) opts.stream = false;
      else if (opts.effort && m.includes('reasoning')) opts.effort = false;
      else if (opts.format === 'json_schema' && (m.includes('response_format') || m.includes('json_schema') || m.includes('schema'))) opts.format = 'json_object';
      else throw err;
    }
  }
  throw new AiError('The compile request failed.');
}

async function chatOnce(t: Transport, req: ChatJsonRequest, opts: Options): Promise<string> {
  const body: Record<string, unknown> = {
    model: req.model,
    messages: [
      { role: 'system', content: opts.format === 'json_object' ? `${req.system}\n\nReply with a single JSON object that follows this JSON schema:\n${JSON.stringify(req.schema)}` : req.system },
      { role: 'user', content: req.user },
    ],
    response_format:
      opts.format === 'json_schema'
        ? { type: 'json_schema', json_schema: { name: req.schemaName, strict: true, schema: req.schema } }
        : { type: 'json_object' },
    stream: opts.stream,
  };
  if (opts.stream && opts.usage) body.stream_options = { include_usage: true };
  if (isRoutedModel(req.model)) {
    // OpenRouter: one reasoning setting for every provider, and only providers that honour the
    // reply's JSON schema (and the other parameters sent) may serve the request.
    if (opts.effort) body.reasoning = { effort: req.reasoningEffort };
    const { providerSort: sort, providerOrder, codeProvider } = harness();
    const maker = req.model.split('/')[0];
    const order = ((req.kind ?? 'code') === 'code' ? codeProvider?.[maker] : undefined) ?? providerOrder?.[maker];
    body.provider = { require_parameters: true, ...(sort ? { sort } : {}), ...(order?.length ? { only: order, order, allow_fallbacks: false } : {}) };
  } else if (opts.effort && isReasoningModel(req.model)) body.reasoning_effort = req.reasoningEffort;

  req.onProgress?.({ phase: 'waiting', chars: 0 });
  // Debug timeline (benchmarks): one entry per request when the page keeps a `__ambleTrace` array.
  const trace = traceStart(req);
  const got: { usage: ChatUsage | null; rejected: boolean } = { usage: null, rejected: false };
  let text = '';
  try {
    const res = await fetch(`${t.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...t.headers },
      body: JSON.stringify(body),
      signal: req.signal,
    });
    if (!res.ok) {
      got.rejected = true;
      throw await readError(res, t);
    }
    // The request is billed from here on: the spend counter hears about it however it ends.
    const firstChars = req.onProgress;
    text = await readChat(res, t, { ...req, onProgress: (p) => (trace?.first === undefined && p.phase === 'writing' && trace ? (trace.first = performance.now() - trace.t0) : 0, firstChars?.(p)) }, opts, (u) => (got.usage = u));
    return text;
  } catch (err) {
    // OpenAI turned the request down (an error with a status): nothing was billed.
    if (err instanceof AiError && err.status !== undefined) got.rejected = true;
    if (trace) trace.error = (err as Error).message;
    throw err;
  } finally {
    if (!got.rejected) recordUsage(req.model, req.kind ?? 'code', got.usage ? chatTokens(got.usage) : null, got.usage?.cost);
    traceEnd(trace, got.usage, text);
  }
}

interface TraceEntry {
  kind: string;
  schema: string;
  model: string;
  effort: string;
  t0: number;
  ms?: number;
  first?: number;
  chars?: number;
  input?: number;
  output?: number;
  reasoning?: number;
  usd?: number | null;
  error?: string;
}

function traceStart(req: ChatJsonRequest): TraceEntry | null {
  const sink = (globalThis as { __ambleTrace?: TraceEntry[] }).__ambleTrace;
  if (!Array.isArray(sink)) return null;
  const entry: TraceEntry = { kind: req.kind ?? 'code', schema: req.schemaName, model: req.model, effort: req.reasoningEffort ?? 'default', t0: performance.now() };
  sink.push(entry);
  return entry;
}

function traceEnd(entry: TraceEntry | null, usage: ChatUsage | null, text: string): void {
  if (!entry) return;
  entry.ms = performance.now() - entry.t0;
  entry.chars = text.length;
  // Benchmarks that study the replies keep them too.
  if ((globalThis as { __ambleTraceText?: boolean }).__ambleTraceText) (entry as TraceEntry & { text?: string }).text = text;
  if (usage) {
    const tk = chatTokens(usage);
    Object.assign(entry, { input: tk.input, output: tk.output, reasoning: tk.reasoning, usd: typeof usage.cost === 'number' ? usage.cost : null });
  }
}

async function readChat(res: Response, t: Transport, req: ChatJsonRequest, opts: Options, onUsage: (u: ChatUsage) => void): Promise<string> {
  if (!opts.stream) {
    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string | null; refusal?: string | null }; finish_reason?: string }>;
      usage?: ChatUsage | null;
      error?: BodyError;
    };
    if (json.error) throw bodyError(json.error, t);
    if (json.usage) onUsage(json.usage);
    const choice = json.choices?.[0];
    if (choice?.message?.refusal) throw new AiError(`The compile request was refused: ${choice.message.refusal}`);
    if (choice?.finish_reason === 'length') throw new AiError('The compile ran out of room before finishing. Try fewer or shorter blocks in your own words, or a model with a larger output limit.');
    const content = choice?.message?.content ?? '';
    req.onProgress?.({ phase: 'writing', chars: content.length });
    return content;
  }

  const reader = res.body?.getReader();
  if (!reader) throw new AiError('No response body.');
  const decoder = new TextDecoder();
  let buffer = '';
  let content = '';
  let refusal = '';
  let finish: string | null = null;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (data === '[DONE]') continue;
      let chunk: {
        error?: BodyError;
        choices?: Array<{ delta?: { content?: string | null; refusal?: string | null }; finish_reason?: string | null }>;
        usage?: ChatUsage | null;
      };
      try {
        chunk = JSON.parse(data);
      } catch {
        continue;
      }
      if (chunk.usage) onUsage(chunk.usage);
      if (chunk.error) throw bodyError(chunk.error, t);
      const choice = chunk.choices?.[0];
      if (choice?.delta?.content) {
        content += choice.delta.content;
        req.onProgress?.({ phase: 'writing', chars: content.length });
        req.onText?.(content);
      }
      if (choice?.delta?.refusal) refusal += choice.delta.refusal;
      if (choice?.finish_reason) finish = choice.finish_reason;
    }
  }
  if (refusal) throw new AiError(`The compile request was refused: ${refusal}`);
  if (finish === 'length') throw new AiError('The compile ran out of room before finishing. Try fewer or shorter blocks in your own words, or a model with a larger output limit.');
  return content;
}

/** One structured request through Codex on this computer (the dev server's /api/codex bridge). */
async function codexOnce(req: ChatJsonRequest): Promise<string> {
  const user = typeof req.user === 'string' ? req.user : req.user.map((p) => (p.type === 'text' ? p.text : '')).join('\n');
  req.onProgress?.({ phase: 'waiting', chars: 0 });
  const res = await fetch('/api/codex/run', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      system: req.system,
      user,
      schema: req.schema,
      model: req.model,
      reasoningEffort: req.reasoningEffort && req.reasoningEffort !== 'default' ? req.reasoningEffort : CHATGPT_REASONING,
    }),
    signal: req.signal,
  });
  if (!res.ok || !res.body) throw new AiError(`The ChatGPT bridge failed (${res.status} ${res.statusText}).`, res.status);
  recordPlanCall(req.model, req.kind ?? 'code');

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const handle = (line: string): string | null => {
    if (!line.trim()) return null;
    const ev = JSON.parse(line) as CodexRunEvent;
    if (ev.type === 'error') throw new AiError(ev.message);
    if (ev.type !== 'result') return null;
    req.onProgress?.({ phase: 'writing', chars: ev.text.length });
    return ev.text;
  };
  for (;;) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    let i: number;
    while ((i = buffer.indexOf('\n')) >= 0) {
      const text = handle(buffer.slice(0, i));
      buffer = buffer.slice(i + 1);
      if (text !== null) return text;
    }
    if (done) break;
  }
  const text = handle(buffer);
  if (text !== null) return text;
  throw new AiError('Codex finished without an answer.');
}

export interface ImageRequest {
  model: string;
  prompt: string;
  size: '1024x1024' | '1536x1024' | '1024x1536';
  transparent: boolean;
  signal?: AbortSignal;
}

/** Generates an image and returns a PNG data URL. */
export async function generateImage(t: Transport, req: ImageRequest): Promise<string> {
  const body: Record<string, unknown> = { model: req.model, prompt: req.prompt, size: req.size, n: 1 };
  if (/^gpt-image/i.test(req.model)) {
    body.quality = 'medium';
    body.output_format = 'png';
    if (req.transparent) body.background = 'transparent';
  } else {
    body.response_format = 'b64_json';
  }
  const res = await fetch(`${t.baseUrl}/images/generations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...t.headers },
    body: JSON.stringify(body),
    signal: req.signal,
  });
  if (!res.ok) throw await readError(res, t);
  let json: { data?: Array<{ b64_json?: string; url?: string }>; usage?: ImageUsage | null; error?: BodyError } = {};
  try {
    json = (await res.json()) as typeof json;
  } finally {
    if (!json.error) recordUsage(req.model, 'image', json.usage ? imageTokens(json.usage) : null);
  }
  if (json.error) throw bodyError(json.error, t);
  const b64 = json.data?.[0]?.b64_json;
  if (!b64) throw new AiError('The image model returned no image.');
  return `data:image/png;base64,${b64}`;
}

/** Model ids available to this key (for the Settings dropdown). */
export async function listModels(t: Transport): Promise<string[]> {
  const res = await fetch(`${t.baseUrl}/models`, { headers: t.headers });
  if (!res.ok) throw await readError(res, t);
  const json = (await res.json()) as { data?: Array<{ id: string }> };
  return (json.data ?? []).map((m) => m.id).sort();
}
