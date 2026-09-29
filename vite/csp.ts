/**
 * The editor page's Content Security Policy (§6.2), injected as a meta tag in builds only (Vite's dev
 * server needs inline scripts), plus `referrer: no-referrer`. srcdoc game frames inherit this policy, so it
 * allows the player's bootstrap by its hash and blob: scripts; `frame-src 'self'` stops a game from
 * navigating its own frame to leak data. `connect` is `https:` in the public build and the district's AI
 * origin in district builds.
 */
import type { Plugin } from 'vite';

export interface CspOptions {
  /** Where AI requests may go (`https:`, or `https://ai.sau99.org`). */
  connect: string[];
  /** sha256 hashes of the player's srcdoc bootstrap ('sha256-…'), from the player core. */
  bootHashes: () => string[];
}

export function editorCsp(o: CspOptions): string {
  const boot = o.bootHashes().map((h) => `'${h.replace(/^'|'$/g, '')}'`);
  return [
    "default-src 'self'",
    ['script-src', "'self'", ...boot, 'blob:'].join(' '),
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "media-src 'self' data: blob:",
    "worker-src 'self' blob:",
    "frame-src 'self'",
    ['connect-src', "'self'", ...o.connect].join(' '),
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'none'",
  ].join('; ');
}

/** The AI origin a district build may reach, from `VITE_AMBLE_AI_BASE_URL` (else any https origin). */
export function aiConnectSources(env: Record<string, string>): string[] {
  const base = env.VITE_AMBLE_AI_BASE_URL;
  if (!base) return ['https:'];
  try {
    return [new URL(base).origin];
  } catch {
    return ['https:'];
  }
}

export function csp(o: CspOptions): Plugin {
  return {
    name: 'amble-csp',
    apply: 'build',
    transformIndexHtml() {
      return [
        { tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: editorCsp(o) }, injectTo: 'head-prepend' },
        { tag: 'meta', attrs: { name: 'referrer', content: 'no-referrer' }, injectTo: 'head-prepend' },
      ];
    },
  };
}
