import { buildRunPackage } from '../player/package';
import { playerScriptUrl } from '../player/host';
import { downloadBlob, safeFilename } from './persistence';
import type { Project } from './types';

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

/** A CSP source for an inline script: 'sha256-<base64 of the digest of its text>'. */
async function sha256(text: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
  let binary = '';
  for (const b of digest) binary += String.fromCharCode(b);
  return `sha256-${btoa(binary)}`;
}

/** Builds a single self-contained HTML file that plays the game (engine and assets inlined). */
export async function buildGameHtml(project: Project): Promise<string> {
  const pkg = buildRunPackage(project);
  const js = await fetch(playerScriptUrl()).then((r) => {
    if (!r.ok) throw new Error('Could not load the game engine.');
    return r.text();
  });
  const pkgJson = JSON.stringify(pkg).replace(/</g, '\\u003c');
  const title = escapeHtml(project.title || 'Amble game');
  // (Line ends as the HTML parser will read them, so the hash below matches.)
  const script = js.replace(/<\/script/gi, '<\\/script').replace(/\r\n?/g, '\n');
  // The same rules as the editor's player: the game runs only its own engine and has no network access.
  const csp = [
    "default-src 'none'",
    `script-src '${await sha256(script)}' 'unsafe-eval' 'wasm-unsafe-eval'`,
    "style-src 'unsafe-inline'",
    'img-src data: blob:',
    'media-src data: blob:',
    'connect-src data: blob:',
    'font-src data:',
    'worker-src blob:',
  ].join('; ');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<title>${title}</title>
</head>
<body>
<script type="application/json" id="amble-package">${pkgJson}</script>
<script>${script}</script>
</body>
</html>`;
}

export async function exportGameHtml(project: Project): Promise<void> {
  const html = await buildGameHtml(project);
  downloadBlob(new Blob([html], { type: 'text/html' }), `${safeFilename(project.title)}.html`);
}
