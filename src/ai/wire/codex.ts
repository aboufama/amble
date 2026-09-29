/**
 * "Sign in with ChatGPT", the dev-server-only path: requests go to the local Codex CLI through
 * server/codexBridge.ts. On a static host there is no bridge, and production builds never ask
 * (the config only offers this source when `import.meta.env.DEV`).
 */
import type { CodexRunEvent, CodexStatus } from '../codexTypes';
import type { JsonSchema } from '../json/schema';
import { textOnly } from './body';
import { TransportFailure } from './failures';
import { aiFetch } from './fetch';
import { readHttpFailure } from './reply';
import type { ChatRequestBase, ContentPart, Transport } from './types';

/** Signed-in requests use GPT-6 Astra with low reasoning: the preset ChatGPT calls "Astra Light". */
export const CODEX_MODEL = 'gpt-6-astra';
export const CODEX_MODEL_NAME = 'GPT-6 Astra Light';
export const CODEX_REASONING = 'low';
export const CODEX_BASE_URL = '/api/codex';

/** What the local dev or preview server offers. A static host offers nothing. */
export interface DevServerInfo {
  /** OPENAI_API_KEY is set on the server, so `/api/openai` works without a key in the browser. */
  serverKey: boolean;
  /** The "Sign in with ChatGPT" bridge is there. */
  codex: boolean;
}

let devInfo: Promise<DevServerInfo> | null = null;

export function devServerInfo(): Promise<DevServerInfo> {
  devInfo ??= fetch('/api/config', { cache: 'no-store' })
    .then((r) => (r.ok && (r.headers.get('content-type') ?? '').includes('json') ? r.json() : {}))
    .then((c: Partial<DevServerInfo>) => ({ serverKey: Boolean(c.serverKey), codex: Boolean(c.codex) }))
    .catch(() => ({ serverKey: false, codex: false }));
  return devInfo;
}

/** The bridge's status, or null when there's no bridge. */
export async function fetchCodexStatus(): Promise<CodexStatus | null> {
  if (!(await devServerInfo()).codex) return null;
  try {
    const res = await fetch(`${CODEX_BASE_URL}/status`, { cache: 'no-store' });
    if (!res.ok || !(res.headers.get('content-type') ?? '').includes('json')) return null;
    return (await res.json()) as CodexStatus;
  } catch {
    return null;
  }
}

async function post(path: string): Promise<CodexStatus> {
  const res = await fetch(`${CODEX_BASE_URL}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  if (!res.ok) throw new Error(`The dev server said ${res.status} ${res.statusText}.`);
  return (await res.json()) as CodexStatus;
}

/** Starts `codex login`, which opens the ChatGPT sign-in page. */
export function startCodexLogin(): Promise<CodexStatus> {
  return post('/login');
}

export function cancelCodexLogin(): Promise<CodexStatus> {
  return post('/login/cancel');
}

function imagesOf(content: string | ContentPart[]): string[] {
  return typeof content === 'string' ? [] : content.flatMap((p) => (p.type === 'image_url' ? [p.image_url.url] : []));
}

/** Codex takes one prompt, so later turns are appended to the user text. */
function userText(req: ChatRequestBase): string {
  const more = (req.messages ?? []).map((m) => `${m.role === 'assistant' ? 'Your earlier reply' : 'Then'}:\n${textOnly(m.content)}`);
  return [textOnly(req.user), ...more].join('\n\n---\n\n');
}

/**
 * One structured request through the bridge. Resolves with the model's JSON text; progress and
 * usage arrive through `onEvent`.
 */
export async function codexRun(
  t: Transport,
  req: ChatRequestBase,
  schema: JsonSchema,
  images: boolean,
  signal: AbortSignal,
  onEvent: (ev: CodexRunEvent) => void,
): Promise<string> {
  const res = await aiFetch(t, '/run', {
    method: 'POST',
    signal,
    body: {
      system: req.system,
      user: userText(req),
      schema,
      model: req.model,
      reasoningEffort: req.reasoningEffort && req.reasoningEffort !== 'none' ? req.reasoningEffort : CODEX_REASONING,
      ...(images ? { images: imagesOf(req.user) } : {}),
    },
  });
  if (!res.ok || !res.body) throw await readHttpFailure(res, undefined);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let result: string | null = null;
  const handle = (line: string) => {
    if (!line.trim()) return;
    let ev: CodexRunEvent;
    try {
      ev = JSON.parse(line) as CodexRunEvent;
    } catch {
      return;
    }
    if (ev.type === 'error') {
      if (/sign(ed)? in|log(ged)? in|login/i.test(ev.message)) throw new TransportFailure({ kind: 'http', status: 401, message: ev.message, html: false });
      throw new TransportFailure({ kind: 'stream', message: ev.message, partial: '' });
    }
    if (ev.type === 'result') result = ev.text;
    else onEvent(ev);
  };
  for (;;) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    let i: number;
    while ((i = buffer.indexOf('\n')) >= 0) {
      handle(buffer.slice(0, i));
      buffer = buffer.slice(i + 1);
    }
    if (done) break;
  }
  handle(buffer);
  if (result === null) throw new TransportFailure({ kind: 'stream', message: 'Codex finished without an answer.', partial: '' });
  return result;
}
