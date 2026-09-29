// Type-checks each starter's game files against the kit's declaration (amble-kit.d.ts) with the project's
// tsc, as scripts, one program per starter (its files share one global scope, as they do in the player).
// Used by the unit tests and by `node tools/starters/lib/typecheck.mjs [ids...]`.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

/** The game files of a starter, helpers first (alphabetical), game.js last. */
export function starterFiles(id) {
  const dir = join(root, 'src/starters', id);
  const js = readdirSync(dir).filter((f) => f.endsWith('.js')).sort((a, b) => (a === 'game.js' ? 1 : b === 'game.js' ? -1 : a.localeCompare(b)));
  return js.map((f) => join(dir, f));
}

/** tsc's complaints about one starter ("game.js(12,5): error TS2339: ..."); empty when it type-checks. */
export function typecheck(id) {
  const dir = mkdtempSync(join(tmpdir(), `amble-starter-${id}-`));
  try {
    const phaser = join(root, 'node_modules/phaser/types/phaser.d.ts');
    const dts = readFileSync(join(root, 'src/play/kit/amble-kit.d.ts'), 'utf8');
    // As a .ts script, so the declaration itself is checked too (skipLibCheck skips .d.ts files).
    writeFileSync(join(dir, 'amble-kit.ts'), dts.replace('/// <reference types="phaser" />', `/// <reference path=${JSON.stringify(phaser)} />`));
    const files = starterFiles(id).map((f) => {
      writeFileSync(join(dir, basename(f)), readFileSync(f, 'utf8'));
      return basename(f);
    });
    writeFileSync(
      join(dir, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: { target: 'ES2022', lib: ['ES2023', 'DOM'], module: 'ESNext', moduleResolution: 'bundler', allowJs: true, checkJs: true, noEmit: true, strict: false, skipLibCheck: true, types: [] },
        files: ['amble-kit.ts', ...files],
      }),
    );
    try {
      execFileSync(join(root, 'node_modules/.bin/tsc'), ['-p', join(dir, 'tsconfig.json')], { encoding: 'utf8', stdio: 'pipe' });
      return [];
    } catch (err) {
      const out = String(err.stdout ?? err);
      return out.split('\n').filter((l) => l.trim()).map((l) => l.replace(dir + '/', ''));
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const ids = process.argv.slice(2).length ? process.argv.slice(2) : ['moon-king', 'sky-run', 'wobble-tower', 'lantern-maze', 'clanks-climb', 'parade'];
  let bad = 0;
  for (const id of ids) {
    const out = typecheck(id);
    bad += out.length;
    console.log(`${id}: ${out.length ? out.length + ' problem(s)' : 'ok'}`);
    for (const line of out.slice(0, 30)) console.log('  ' + line);
  }
  process.exit(bad ? 1 : 0);
}
