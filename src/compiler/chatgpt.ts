/**
 * "Sign in with ChatGPT" from the editor's side. It only works when Amble runs on your computer:
 * the dev server hands requests to the Codex CLI, which is signed in with your ChatGPT account
 * (see server/codexBridge.ts). On a static host like GitHub Pages there is no bridge.
 */
import type { CodexStatus } from './codexTypes';
import { devServerConfig } from './devServer';

/** The bridge's status, or null when there's no bridge (static hosting). */
export async function fetchCodexStatus(): Promise<CodexStatus | null> {
  if (!(await devServerConfig()).codex) return null;
  try {
    const res = await fetch('/api/codex/status', { cache: 'no-store' });
    if (!res.ok || !(res.headers.get('content-type') ?? '').includes('json')) return null;
    return (await res.json()) as CodexStatus;
  } catch {
    return null;
  }
}

async function post(path: string): Promise<CodexStatus> {
  const res = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  if (!res.ok) throw new Error(`The dev server said ${res.status} ${res.statusText}.`);
  return (await res.json()) as CodexStatus;
}

/** Starts `codex login`, which opens the ChatGPT sign-in page in your browser. */
export function startCodexLogin(): Promise<CodexStatus> {
  return post('/api/codex/login');
}

export function cancelCodexLogin(): Promise<CodexStatus> {
  return post('/api/codex/login/cancel');
}
