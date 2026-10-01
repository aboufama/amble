// Builds every theme in themes/<slug>/ as its own copy of the app at dist/themes/<slug>/, and writes
// dist/themes/index.html, a page that links them all. Run it after `npm run build`.
//
// A theme is the source files it changes, mirrored under themes/<slug>/files/ (every theme carries its own
// version of every file any theme changes, so no theme picks up another's edits), plus theme.json: its
// name, the seed it grew from, a line about it and a few swatches. The app's base path is './', so each
// copy works from its own folder.
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const themesDir = join(root, 'themes');
const out = join(root, 'dist', 'themes');

if (!existsSync(themesDir)) {
  console.log('No themes/ folder: nothing to build.');
  process.exit(0);
}
const slugs = readdirSync(themesDir, { withFileTypes: true })
  .filter((d) => d.isDirectory() && existsSync(join(themesDir, d.name, 'theme.json')))
  .map((d) => d.name);
const themes = slugs
  .map((slug) => ({ slug, ...JSON.parse(readFileSync(join(themesDir, slug, 'theme.json'), 'utf8')) }))
  .sort((a, b) => (a.order ?? 99) - (b.order ?? 99));

for (const t of themes) {
  const tmp = mkdtempSync(join(tmpdir(), `amble-theme-${t.slug}-`));
  rmSync(tmp, { recursive: true, force: true });
  execFileSync('git', ['worktree', 'add', '--detach', '--quiet', tmp, 'HEAD'], { cwd: root, stdio: 'inherit' });
  try {
    cpSync(join(themesDir, t.slug, 'files'), tmp, { recursive: true });
    symlinkSync(join(root, 'node_modules'), join(tmp, 'node_modules'), 'dir');
    execFileSync('npx', ['vite', 'build', '--logLevel', 'warn', '--outDir', join(out, t.slug), '--emptyOutDir'], { cwd: tmp, stdio: 'inherit' });
    const preview = join(themesDir, t.slug, 'preview.webp');
    if (existsSync(preview)) cpSync(preview, join(out, t.slug, 'preview.webp'));
    console.log(`themes/${t.slug}: built`);
  } finally {
    execFileSync('git', ['worktree', 'remove', '--force', tmp], { cwd: root, stdio: 'inherit' });
  }
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const card = (t) => `
    <li class="theme">
      <a class="shot" href="./${esc(t.slug)}/"><img src="./${esc(t.slug)}/preview.webp" alt="The ${esc(t.name)} theme: the code area, blocks and stage" width="1440" height="900" loading="lazy"></a>
      <div class="about">
        <h2>${esc(t.name)}</h2>
        <p class="seed">${t.seed ? `Seed ${esc(t.seed)}` : 'The untouched Scratch look'}</p>
        <p>${esc(t.summary)}</p>
        <ul class="swatches" aria-label="Its colours">${(t.swatches ?? []).map((c) => `<li style="background:${esc(c)}" title="${esc(c)}"></li>`).join('')}</ul>
        <a class="open" href="./${esc(t.slug)}/">Open ${esc(t.name)}</a>
      </div>
    </li>`;

writeFileSync(
  join(out, 'index.html'),
  `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Amble themes</title>
<link rel="icon" href="../favicon.svg" type="image/svg+xml">
<style>
  :root { --bg: #e5f0ff; --card: #fff; --text: #575e75; --line: rgba(0, 0, 0, 0.15); --accent: #855cd6; --on-accent: #fff; color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--text); font: 15px/1.5 'Helvetica Neue', Helvetica, Arial, sans-serif; }
  header { background: var(--accent); color: var(--on-accent); padding: 14px 16px; }
  header h1 { margin: 0 auto; max-width: 1100px; font-size: 22px; }
  main { max-width: 1100px; margin: 0 auto; padding: 20px 16px 48px; }
  .lede { margin: 0 0 20px; max-width: 70ch; }
  ol { list-style: none; margin: 0; padding: 0; display: grid; gap: 18px; grid-template-columns: repeat(auto-fill, minmax(min(100%, 480px), 1fr)); }
  .theme { background: var(--card); border: 1px solid var(--line); border-radius: 8px; overflow: hidden; display: grid; }
  .shot img { display: block; width: 100%; height: auto; border-bottom: 1px solid var(--line); }
  .about { padding: 12px 16px 16px; display: grid; gap: 6px; }
  .about h2 { margin: 0; font-size: 18px; }
  .about p { margin: 0; }
  .seed { font-size: 12px; letter-spacing: 0.04em; text-transform: uppercase; opacity: 0.8; }
  .swatches { list-style: none; display: flex; gap: 6px; margin: 4px 0; padding: 0; }
  .swatches li { width: 22px; height: 22px; border-radius: 50%; border: 1px solid var(--line); }
  .open { justify-self: start; margin-top: 4px; padding: 8px 14px; border-radius: 4px; background: var(--accent); color: var(--on-accent); font-weight: 700; text-decoration: none; }
  .open:focus-visible, .shot:focus-visible { outline: 3px solid #333; outline-offset: 2px; }
</style>
</head>
<body>
<header><h1>Amble themes</h1></header>
<main>
  <p class="lede">The Scratch-style editor with a subtle spin. Each theme is a full, working copy of Amble: open one and build a game in it. Your projects are shared between them, so you can open the same game in each and compare.</p>
  <ol>${themes.map(card).join('')}
  </ol>
</main>
</body>
</html>
`,
);
console.log(`dist/themes/index.html: ${themes.length} themes`);
