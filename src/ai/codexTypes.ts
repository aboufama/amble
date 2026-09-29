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
  /** Pictures for the model to look at, as `data:image/...;base64,` URLs (at most CODEX_MAX_IMAGES). */
  images?: string[];
}

/** Token counts Codex reports when a turn completes. */
export interface CodexUsage {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
}

/** One line of the /api/codex/run reply (newline-delimited JSON). */
export type CodexRunEvent =
  | { type: 'progress'; phase: 'thinking' | 'working' }
  | { type: 'usage'; usage: CodexUsage }
  | { type: 'result'; text: string }
  | { type: 'error'; message: string };

/** Limits the bridge enforces on pictures, so a request can't fill the disk. */
export const CODEX_MAX_IMAGES = 4;
export const CODEX_MAX_IMAGE_BYTES = 4 * 1024 * 1024;
