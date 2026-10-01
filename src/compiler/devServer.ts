/** What the local dev/preview server offers. Static hosting (like GitHub Pages) offers nothing. */
export interface DevServerConfig {
  /** OPENAI_API_KEY is set on the server, so `/api/openai` works without a key in the browser. */
  serverKey: boolean;
  /** The "Sign in with ChatGPT" bridge (`/api/codex`) is there. */
  codex: boolean;
}

let config: Promise<DevServerConfig> | null = null;

export function devServerConfig(): Promise<DevServerConfig> {
  config ??= fetch('/api/config')
    .then((r) => (r.ok ? r.json() : {}))
    .then((c: Partial<DevServerConfig>) => ({ serverKey: Boolean(c.serverKey), codex: Boolean(c.codex) }))
    .catch(() => ({ serverKey: false, codex: false }));
  return config;
}
