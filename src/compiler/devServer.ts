/** What the server offers: the dev/preview server on your computer, or a hosted one (Vercel, api/amble.ts). Static hosting (like GitHub Pages) offers nothing. */
export interface DevServerConfig {
  /** OPENAI_API_KEY is set on the server, so `/api/openai` works without a key in the browser. */
  serverKey: boolean;
  /** The "Sign in with ChatGPT" bridge (`/api/codex`) is there. */
  codex: boolean;
  /** A public deployment: its key only runs `models`. */
  hosted: boolean;
  models: string[] | null;
}

let config: Promise<DevServerConfig> | null = null;
/** The answer, once it's in (for rendering without waiting). */
let known: DevServerConfig | null = null;

export function knownServerConfig(): DevServerConfig | null {
  return known;
}

export function devServerConfig(): Promise<DevServerConfig> {
  config ??= fetch('/api/config')
    .then((r) => (r.ok && (r.headers.get('content-type') ?? '').includes('json') ? r.json() : {}))
    .then((c: Partial<DevServerConfig>) => ({
      serverKey: Boolean(c.serverKey),
      codex: Boolean(c.codex),
      hosted: Boolean(c.hosted),
      models: Array.isArray(c.models) ? c.models.filter((m): m is string => typeof m === 'string') : null,
    }))
    .catch(() => ({ serverKey: false, codex: false, hosted: false, models: null }))
    .then((c) => (known = c));
  return config;
}
