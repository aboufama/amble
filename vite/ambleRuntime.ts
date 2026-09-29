/**
 * Vite plugin: builds the game runtime that runs inside the sandboxed player iframe, and tells the editor
 * where it is.
 *
 *   import runtimeUrl from 'virtual:amble-runtime';   // editor code
 *   new Player({ container, runtimeUrl });
 *
 * The runtime file is Phaser's own prebuilt dist (phaser.min.js: 309 KB gzip, Matter included) followed by
 * the Amble runtime (src/runtime/shell/index.ts: sandbox shell + kit), bundled by esbuild into one IIFE.
 * - Build: emitted as `assets/amble-player-<sha256:10>.js`. The content hash keeps the editor and the
 *   runtime in step under GitHub Pages' 10-minute cache.
 * - Dev: served from memory at `<base>amble-player.js`, rebuilt when any file esbuild bundled (or anything
 *   under src/runtime/) changes; the page then reloads, since a sandboxed realm cannot hot-update.
 * The editor fetches it same-origin and posts the bytes into each iframe, so no CORS is involved.
 */
import { build, type Metafile, type Plugin as EsbuildPlugin } from 'esbuild';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Plugin, ViteDevServer } from 'vite';

import { PLAYER_BOOT } from '../src/play/boot.ts';

export const RUNTIME_VIRTUAL_ID = 'virtual:amble-runtime';
const RESOLVED_ID = '\0' + RUNTIME_VIRTUAL_ID;
const DEV_FILE = 'amble-player.js';

export interface AmbleRuntimeOptions {
  /** Repository root (default: Vite's root). */
  root?: string;
  /** Runtime entry, relative to root. */
  entry?: string;
}

/**
 * Runtime code imports `phaser` for its types and its API; at run time Phaser is the global that the
 * prebuilt dist defines, so the import resolves to that global instead of bundling Phaser's sources.
 */
const phaserGlobal: EsbuildPlugin = {
  name: 'amble-phaser-global',
  setup(b) {
    b.onResolve({ filter: /^phaser$/ }, () => ({ path: 'phaser', namespace: 'amble-phaser-global' }));
    b.onLoad({ filter: /.*/, namespace: 'amble-phaser-global' }, () => ({ contents: 'module.exports = globalThis.Phaser;', loader: 'js' }));
  },
};

interface Bundle {
  code: string;
  inputs: Set<string>;
}

async function bundleRuntime(root: string, entry: string, minify: boolean): Promise<Bundle> {
  const result = await build({
    entryPoints: [path.join(root, entry)],
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'es2020',
    minify,
    write: false,
    metafile: true,
    legalComments: 'none',
    logLevel: 'error',
    plugins: [phaserGlobal],
  });
  const phaser = readFileSync(path.join(root, 'node_modules/phaser/dist/phaser.min.js'), 'utf8');
  const meta: Metafile = result.metafile ?? { inputs: {}, outputs: {} };
  const inputs = new Set(Object.keys(meta.inputs).map((p) => path.resolve(root, p)));
  return { code: `${phaser}\n;\n${result.outputFiles[0].text}`, inputs };
}

/**
 * CSP sources ('sha256-...') for the player's srcdoc bootstrap. A srcdoc game frame inherits the editor
 * page's Content Security Policy, so the page's script-src must allow the bootstrap by its hash (plus
 * blob:, for the runtime and the game's files): `csp({ bootHashes: playerBootHashes })` in vite.config.ts.
 * Hashed from the bootstrap's source when called, so it can never go stale.
 */
export function playerBootHashes(): string[] {
  return [`sha256-${createHash('sha256').update(PLAYER_BOOT, 'utf8').digest('base64')}`];
}

export function runtimeFileName(code: string): string {
  return `assets/amble-player-${createHash('sha256').update(code).digest('hex').slice(0, 10)}.js`;
}

export function ambleRuntime(options: AmbleRuntimeOptions = {}): Plugin {
  const entry = options.entry ?? 'src/runtime/shell/index.ts';
  let root = options.root ?? process.cwd();
  let isBuild = false;
  let devBundle: Promise<Bundle> | null = null;
  let devInputs = new Set<string>();

  const devBuild = (): Promise<Bundle> => {
    devBundle ??= bundleRuntime(root, entry, false).then(
      (b) => {
        devInputs = b.inputs;
        return b;
      },
      (err: unknown) => {
        devBundle = null;
        throw err;
      },
    );
    return devBundle;
  };

  const invalidate = (server: ViteDevServer, file: string): void => {
    const abs = path.resolve(file);
    const runtimeDir = path.join(root, 'src', 'runtime') + path.sep;
    if (!devInputs.has(abs) && !abs.startsWith(runtimeDir)) return;
    devBundle = null;
    server.ws.send({ type: 'full-reload' });
  };

  return {
    name: 'amble-runtime',
    configResolved(config) {
      isBuild = config.command === 'build';
      root = options.root ?? config.root;
    },
    resolveId(id) {
      return id === RUNTIME_VIRTUAL_ID ? RESOLVED_ID : null;
    },
    async load(id) {
      if (id !== RESOLVED_ID) return null;
      if (!isBuild) return `export default new URL(import.meta.env.BASE_URL + ${JSON.stringify(DEV_FILE)}, location.href).href;`;
      const { code } = await bundleRuntime(root, entry, true);
      const fileName = runtimeFileName(code);
      const ref = this.emitFile({ type: 'asset', fileName, source: code });
      // The bundler writes the URL relative to the chunk that imports it, so it works under any base
      // (GitHub Pages' /amble/) and from pages in sub-folders.
      return `export default import.meta.ROLLUP_FILE_URL_${ref};`;
    },
    configureServer(server) {
      for (const event of ['change', 'add', 'unlink'] as const) server.watcher.on(event, (file: string) => invalidate(server, file));
      server.middlewares.use((req, res, next) => {
        const pathname = (req.url ?? '').split('?')[0];
        if (!pathname.endsWith('/' + DEV_FILE)) return next();
        devBuild().then(
          ({ code }) => {
            res.setHeader('content-type', 'text/javascript; charset=utf-8');
            res.setHeader('cache-control', 'no-cache');
            res.end(code);
          },
          (err: Error) => {
            res.statusCode = 500;
            res.setHeader('content-type', 'text/javascript; charset=utf-8');
            res.end(`console.error(${JSON.stringify('Amble runtime build failed: ' + err.message)})`);
          },
        );
      });
    },
  };
}
