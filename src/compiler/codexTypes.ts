/** Shared by the editor and the dev server's ChatGPT bridge (server/codexBridge.ts). */

export type CodexAuth = 'chatgpt' | 'apikey' | 'none';

export interface CodexStatus {
  /** The Codex CLI was found on this computer. */
  installed: boolean;
  version: string | null;
  /** How Codex is signed in. */
  auth: CodexAuth;
  /** A sign-in started from Amble that is waiting for the browser. */
  login: { pending: boolean; url: string | null; error: string | null };
}

export interface CodexRunRequest {
  system: string;
  user: string;
  schema: Record<string, unknown>;
  model: string;
  reasoningEffort: string;
}

/** One line of the /api/codex/run reply (newline-delimited JSON). */
export type CodexRunEvent =
  | { type: 'progress'; phase: 'thinking' | 'working' }
  | { type: 'result'; text: string }
  | { type: 'error'; message: string };
