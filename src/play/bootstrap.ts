/**
 * The player iframe document ("blob mode", measured in the Phaser probe).
 *
 * - The iframe is sandbox="allow-scripts": an opaque origin with no storage, cookies or access to the editor.
 * - Its srcdoc's ONLY script is the tiny bootstrap (PLAYER_BOOT, ./boot.ts), allowed by its sha256 hash.
 *   It asks the editor for the runtime ('boot'), and runs the posted bytes (Phaser + Amble runtime) as blob:
 *   scripts. The sandboxed document never touches the network, which matters because Chrome does not
 *   HTTP-cache anything an opaque-origin frame fetches.
 */
import { PLAYER_BOOT } from './boot';
import { STANDALONE_RUNTIME_ID } from './protocol';

export { PLAYER_BOOT };

/**
 * Standalone export bootstrap: the runtime and the game travel inside the page itself, in non-executed
 * JSON blocks (a JSON string cannot end its <script> element early), and the runtime runs as a blob: script.
 */
export const STANDALONE_BOOT =
  `window.__ambleBoot=performance.now();var t=document.getElementById('${STANDALONE_RUNTIME_ID}');` +
  "var s=document.createElement('script');s.src=URL.createObjectURL(new Blob([JSON.parse(t.textContent)],{type:'text/javascript'}));" +
  'document.head.appendChild(s)';

export const PLAYER_CSS =
  'html,body{margin:0;height:100%;overflow:hidden;background:#0f0c1e;touch-action:none;-webkit-user-select:none;user-select:none;' +
  '-webkit-tap-highlight-color:transparent}#amble-game{position:absolute;inset:0}#amble-game canvas{display:block}';

export async function sha256Base64(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  let bin = '';
  for (const b of new Uint8Array(buf)) bin += String.fromCharCode(b);
  return btoa(bin);
}

const hashes = new Map<string, Promise<string>>();

/** `'sha256-...'` CSP source for an inline script (memoized). */
export function scriptHash(source: string): Promise<string> {
  let h = hashes.get(source);
  if (!h) {
    h = sha256Base64(source).then((b64) => `'sha256-${b64}'`);
    hashes.set(source, h);
  }
  return h;
}

/**
 * The player's CSP. Why each part is there (all verified in the probe):
 *   script-src <hash> blob:   the bootstrap, then Phaser/runtime/student code as blob: scripts. No 'unsafe-eval'.
 *   img-src data: blob:       REQUIRED: Phaser's built-in __DEFAULT/__MISSING/__WHITE textures are data: PNGs.
 *   style-src 'unsafe-inline' the page's <style>; Phaser only sets element.style, which CSP does not restrict.
 *   connect-src 'none'        Phaser decodes data: URLs itself; games cannot fetch anything.
 *   media-src 'none'          sound is Web Audio (AudioBuffers), never <audio>.
 *   font-src data:            fonts travel inside the game.
 */
export function playerCsp(bootHash: string): string {
  return [
    "default-src 'none'",
    `script-src ${bootHash} blob:`,
    "style-src 'unsafe-inline'",
    'img-src data: blob:',
    'font-src data: blob:',
    "media-src 'none'",
    "connect-src 'none'",
    "worker-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c);
}

/** The srcdoc of a player iframe. */
export async function playerSrcdoc(title = 'Amble game'): Promise<string> {
  const csp = playerCsp(await scriptHash(PLAYER_BOOT));
  return (
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}">` +
    `<meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><style>${PLAYER_CSS}</style></head>` +
    `<body><div id="amble-game"></div><script>${PLAYER_BOOT}</script></body></html>`
  );
}
