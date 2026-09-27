/**
 * Minimal OpenAI client (Chat Completions + Images). Works directly from the browser with a
 * key from Settings, through the dev server's `/api/openai` proxy when OPENAI_API_KEY is set
 * there, or, when Amble runs on your computer, with your ChatGPT sign-in through Codex
 * (src/compiler/chatgpt.ts). Any OpenAI-compatible endpoint can be used via the base URL setting.
 */
import { fetchCodexStatus } from './chatgpt';
import type { CodexRunEvent } from './codexTypes';
import { devServerConfig } from './devServer';

export type ReasoningEffort = 'default' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export interface AiSettings {
  /** Compile with your ChatGPT sign-in (Codex on this computer) instead of an API key. */
  useChatGpt: boolean;
  apiKey: string;
  baseUrl: string;
  model: string;
  reasoningEffort: ReasoningEffort;
  /** Model used for compiled assets (SVG art, sounds, 3D recipes). Empty = same as `model`. */
  assetModel: string;
  /** How compiled costumes are drawn: vector art written by the chat model, or an image model. */
  artMode: 'svg' | 'image';
  imageModel: string;
}

export const DEFAULT_SETTINGS: AiSettings = {
  useChatGpt: false,
  apiKey: '',
  baseUrl: 'https://api.openai.com/v1',
  model: 'gpt-5',
  reasoningEffort: 'low',
  assetModel: 'gpt-5-mini',
  artMode: 'svg',
  imageModel: 'gpt-image-1',
};

/** Signed-in compiles use GPT-6 Astra with low reasoning: the preset ChatGPT calls "Astra Light". */
export const CHATGPT_MODEL = 'gpt-6-astra';
export const CHATGPT_REASONING: ReasoningEffort = 'low';
export const CHATGPT_MODEL_NAME = 'GPT-6 Astra Light';

export interface Transport {
  baseUrl: string;
  headers: Record<string, string>;
  /** "chatgpt" = your ChatGPT sign-in via Codex; "browser" = key in this browser; "server" = dev server key. */
  via: 'chatgpt' | 'browser' | 'server';
}

/** The settings a request really uses: the ChatGPT sign-in always runs GPT-6 Astra Light. */
export function effectiveSettings(settings: AiSettings, t: Transport): AiSettings {
  if (t.via !== 'chatgpt') return settings;
  // Codex only answers with text, so compiled art is always vector drawings.
  return { ...settings, model: CHATGPT_MODEL, reasoningEffort: CHATGPT_REASONING, assetModel: CHATGPT_MODEL, artMode: 'svg' };
}

/** Does the dev/preview server have OPENAI_API_KEY configured? */
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
    return {
      baseUrl: (settings.baseUrl || DEFAULT_SETTINGS.baseUrl).replace(/\/+$/, ''),
      headers: { Authorization: `Bearer ${settings.apiKey.trim()}` },
      via: 'browser',
    };
  }
  if (await hasServerKey()) return { baseUrl: '/api/openai', headers: {}, via: 'server' };
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
  return /^(o\d|gpt-[5-9])/i.test(model.trim());
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
}

async function readError(res: Response): Promise<AiError> {
  let message = `${res.status} ${res.statusText}`;
  let code: string | undefined;
  try {
    const body = (await res.json()) as { error?: { message?: string; code?: string } };
    if (body.error?.message) message = body.error.message;
    code = body.error?.code;
  } catch {
    /* not JSON */
  }
  if (res.status === 401) message = `Your OpenAI API key was rejected (${message}). Check it in Settings.`;
  if (res.status === 429 && !/quota/i.test(message)) message = `Rate limited by OpenAI: ${message}`;
  return new AiError(message, res.status, code);
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
  format: 'json_schema' | 'json_object';
  effort: boolean;
}

/** Sends a chat request and returns the parsed JSON reply. Retries without features a model/account rejects. */
export async function chatJson<T>(t: Transport, req: ChatJsonRequest): Promise<T> {
  if (t.via === 'chatgpt') return parseJsonReply<T>(await codexOnce(req));
  const opts: Options = { stream: true, format: 'json_schema', effort: Boolean(req.reasoningEffort && req.reasoningEffort !== 'default') };
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const text = await chatOnce(t, req, opts);
      return parseJsonReply<T>(text);
    } catch (err) {
      if (!(err instanceof AiError) || err.status !== 400) throw err;
      const m = err.message.toLowerCase();
      if (opts.stream && m.includes('stream')) opts.stream = false;
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
  if (opts.effort && isReasoningModel(req.model)) body.reasoning_effort = req.reasoningEffort;

  req.onProgress?.({ phase: 'waiting', chars: 0 });
  const res = await fetch(`${t.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...t.headers },
    body: JSON.stringify(body),
    signal: req.signal,
  });
  if (!res.ok) throw await readError(res);

  if (!opts.stream) {
    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string | null; refusal?: string | null }; finish_reason?: string }>;
    };
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
        error?: { message?: string };
        choices?: Array<{ delta?: { content?: string | null; refusal?: string | null }; finish_reason?: string | null }>;
      };
      try {
        chunk = JSON.parse(data);
      } catch {
        continue;
      }
      if (chunk.error) throw new AiError(chunk.error.message ?? 'The compile request stopped partway.');
      const choice = chunk.choices?.[0];
      if (choice?.delta?.content) {
        content += choice.delta.content;
        req.onProgress?.({ phase: 'writing', chars: content.length });
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
  if (!res.ok) throw await readError(res);
  const json = (await res.json()) as { data?: Array<{ b64_json?: string; url?: string }> };
  const b64 = json.data?.[0]?.b64_json;
  if (!b64) throw new AiError('The image model returned no image.');
  return `data:image/png;base64,${b64}`;
}

/** Model ids available to this key (for the Settings dropdown). */
export async function listModels(t: Transport): Promise<string[]> {
  const res = await fetch(`${t.baseUrl}/models`, { headers: t.headers });
  if (!res.ok) throw await readError(res);
  const json = (await res.json()) as { data?: Array<{ id: string }> };
  return (json.data ?? []).map((m) => m.id).sort();
}
