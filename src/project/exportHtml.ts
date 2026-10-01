import { buildRunPackage } from '../player/package';
import { loadHavokWasm, playerScriptUrl } from '../player/host';
import { bytesToBase64 } from '../audio/synth';
import { downloadBlob, safeFilename } from './persistence';
import type { Project } from './types';

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

/** Builds a single self-contained HTML file that plays the game (engine, physics and assets inlined). */
export async function buildGameHtml(project: Project): Promise<string> {
  const pkg = buildRunPackage(project);
  const [js, wasm] = await Promise.all([
    fetch(playerScriptUrl()).then((r) => {
      if (!r.ok) throw new Error('Could not load the game engine.');
      return r.text();
    }),
    loadHavokWasm(),
  ]);
  const pkgJson = JSON.stringify(pkg).replace(/</g, '\\u003c');
  const title = escapeHtml(project.title || 'Amble game');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
</head>
<body>
<script type="application/json" id="amble-package">${pkgJson}</script>
<script type="text/plain" id="amble-havok">${bytesToBase64(new Uint8Array(wasm))}</script>
<script>${js.replace(/<\/script/gi, '<\\/script')}</script>
</body>
</html>`;
}

export async function exportGameHtml(project: Project): Promise<void> {
  const html = await buildGameHtml(project);
  downloadBlob(new Blob([html], { type: 'text/html' }), `${safeFilename(project.title)}.html`);
}
