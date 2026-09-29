// Builds the starter worlds' committed assets (§9): replays every ArtScript through the real brush engine,
// exports it, composites each body part, makes the sticker, moves the rig onto the trimmed drawing, checks
// the bind, validates every starter's code, and writes public/starters/<id>/art/<key>/ (art.json + files).
// Then, unless --no-browser: robot-tests every starter and seed in Chromium and writes the Trail signs
// (public/starters/<id>/sign.png) and the review sheets (see review.mjs).
//
//   node tools/starters/build.mjs [starter ids...] [--no-browser] [--start-rigs <dir>]
//
// A drawing without a committed rig (<key>.rig.json) takes its starting rig from --start-rigs
// (<script>.rig.json, board pixels) and gets a new <key>.rig.json to review and fix by hand.
import { build } from 'esbuild';
import { mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const startRigs = option('--start-rigs');
const only = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--start-rigs');

// esbuild: `?raw` imports (the game files) as text, like Vite.
const raw = {
  name: 'raw',
  setup(b) {
    b.onResolve({ filter: /\?raw$/ }, (a) => ({ path: resolve(a.resolveDir, a.path.replace(/\?raw$/, '')), namespace: 'raw' }));
    b.onLoad({ filter: /.*/, namespace: 'raw' }, (a) => ({ contents: readFileSync(a.path, 'utf8'), loader: 'text' }));
  },
};
const cache = join(root, '.vite', 'starters');
mkdirSync(cache, { recursive: true });
const bundle = join(cache, 'node-entry.mjs');
await build({ entryPoints: [join(here, 'lib/node-entry.ts')], bundle: true, format: 'esm', platform: 'node', target: 'node22', outfile: bundle, logLevel: 'warning', plugins: [raw], define: { 'import.meta.env': '{}' } });
const L = await import(bundle);

const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
let problems = 0;
const fail = (msg) => {
  problems++;
  console.error('  PROBLEM:', msg);
};

for (const meta of L.STARTERS) {
  if (only.length && !only.includes(meta.id)) continue;
  console.log(`\n${meta.id}`);
  const files = await meta.files();
  const v = L.validateGame(files.map((f) => ({ path: f.path, content: f.source })), { manifest: L.KIT_API, fix: false });
  for (const i of [...v.errors, ...v.warnings]) fail(`${i.file}:${i.line} ${i.severity} ${i.rule}: ${i.message}`);
  const lines = Object.fromEntries(files.map((f) => [f.path, f.source.split('\n').length]));
  console.log(`  code: ${Object.entries(lines).map(([p, n]) => `${p} ${n} lines`).join(', ')}; ${v.errors.length} errors, ${v.warnings.length} warnings`);

  for (const cast of meta.cast) {
    const load = meta.scripts[cast.key];
    if (!load) continue;
    const script = await load();
    const errors = L.validateArtScript(script);
    if (errors.length) fail(`${cast.key}: ArtScript ${errors.slice(0, 3).join('; ')}`);
    const artDir = join(root, 'src/starters', meta.id, 'art');
    const rigFile = join(artDir, `${cast.key}.rig.json`);
    const rig = existsSync(rigFile) ? JSON.parse(readFileSync(rigFile, 'utf8')) : null;
    const start = !rig && startRigs && existsSync(join(startRigs, `${script.name}.rig.json`)) ? JSON.parse(readFileSync(join(startRigs, `${script.name}.rig.json`), 'utf8')) : null;
    const t0 = performance.now();
    const built = await L.buildArt({ cast, script, rig, startRig: start });
    const ms = Math.round(performance.now() - t0);
    if (cast.kind === 'character' && !built.rig) fail(`${cast.key}: no rig (commit ${cast.key}.rig.json, or pass --start-rigs)`);
    if (built.rig) {
      try {
        const bound = L.bindRig({ image: built.flat, layers: built.parts }, built.rig);
        const layered = built.rig.parts?.filter((p) => p.layer && built.parts[p.layer]).length ?? 0;
        console.log(`    bones: ${built.rig.bones.length} bones, ${bound.stats.parts} parts (${layered} from layers), ${bound.stats.triangles} triangles, flat=${bound.flat}`);
        if (bound.flat) fail(`${cast.key}: the rig did not bind to the part layers`);
      } catch (err) {
        fail(`${cast.key}: the rig does not bind: ${err instanceof Error ? err.message : err}`);
      }
      if (built.rigUpdated) {
        writeFileSync(rigFile, JSON.stringify(JSON.parse(L.serializeRig(built.rig)), null, 1) + '\n');
        console.log(`    wrote ${cast.key}.rig.json (${built.rig.made}): review it`);
      }
    }
    const out = join(root, 'public/starters', meta.id, 'art', cast.key);
    rmSync(out, { recursive: true, force: true });
    let bytes = 0;
    for (const f of built.files) {
      mkdirSync(dirname(join(out, f.path)), { recursive: true });
      writeFileSync(join(out, f.path), f.bytes);
      bytes += f.bytes.length;
    }
    writeFileSync(join(out, 'art.json'), JSON.stringify(built.json, null, 1) + '\n');
    console.log(`  ${cast.key} (${script.name}): flat ${built.json.export.w}x${built.json.export.h}, ${built.files.length} files, ${kb(bytes)}, ${ms} ms`);
  }
}

if (problems) {
  console.error(`\n${problems} problem(s).`);
  process.exit(1);
}
if (!flag('--no-browser')) {
  const r = spawnSync(process.execPath, [join(here, 'review.mjs'), '--robot', '--signs', ...only], { stdio: 'inherit', cwd: root });
  process.exit(r.status ?? 1);
}
