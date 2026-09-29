/**
 * Vite plugin: builds the game runtime that runs inside the sandboxed player iframe, and tells the editor
 * where it is.
 *
 *   import runtimeUrl, { standaloneUrl } from 'virtual:amble-runtime';   // editor code
 *   new Player({ container, runtimeUrl });
 *
 * The runtime file is Phaser's own prebuilt dist (phaser.min.js: 309 KB gzip, Matter included) followed by
 * the Amble runtime (src/runtime/shell/index.ts: sandbox shell + kit), bundled by esbuild into one IIFE.
 * Binding a drawing to its bones is not in it: the editor sends each drawing's bake. The standalone script
 * (src/runtime/standalone.ts: the binder and the ▶ Play card) is a second, small file that only a shared
 * web page needs; the page appends it to the runtime.
 * - Build: emitted as `assets/amble-player-<sha256:10>.js` and `assets/amble-standalone-<sha256:10>.js`,
 *   minified by oxc (the minifier Vite uses for the app). The content hash keeps the editor and the
 *   runtime in step under GitHub Pages' 10-minute cache.
 * - Dev: served from memory at `<base>amble-player.js` and `<base>amble-standalone.js`, rebuilt when any file
 *   esbuild bundled (or anything under src/runtime/) changes; the page then reloads, since a sandboxed
 *   realm cannot hot-update.
 * The editor fetches the runtime same-origin and posts the bytes into each iframe, so no CORS is involved.
 */
import { build, type Metafile, type Plugin as EsbuildPlugin } from 'esbuild';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { minifySync, type Plugin, type ViteDevServer } from 'vite';

import { PLAYER_BOOT } from '../src/play/boot.ts';

export const RUNTIME_VIRTUAL_ID = 'virtual:amble-runtime';
const RESOLVED_ID = '\0' + RUNTIME_VIRTUAL_ID;
const DEV_FILE = 'amble-player.js';
const DEV_STANDALONE = 'amble-standalone.js';
const STANDALONE_ENTRY = 'src/runtime/standalone.ts';
/** The runtime's syntax level (the app's own build needs a newer Chrome than this). */
const TARGET = 'es2022';

export interface AmbleRuntimeOptions {
  /** Repository root (default: Vite's root). */
  root?: string;
  /** Runtime entry, relative to root. */
  entry?: string;
}

/**
 * Runtime code imports `phaser` for its types and its API; at run time Phaser is the global that the
 * prebuilt dist defines, so the import resolves to that global instead of bundling Phaser's sources.
 * An ES module default (runtime code only uses `import Phaser from 'phaser'`), so no CommonJS interop.
 */
const phaserGlobal: EsbuildPlugin = {
  name: 'amble-phaser-global',
  setup(b) {
    b.onResolve({ filter: /^phaser$/ }, () => ({ path: 'phaser', namespace: 'amble-phaser-global' }));
    b.onLoad({ filter: /.*/, namespace: 'amble-phaser-global' }, () => ({ contents: 'export default globalThis.Phaser;', loader: 'js' }));
  },
};

interface Bundle {
  code: string;
  inputs: Set<string>;
}

/** One entry as a browser IIFE. Minified by oxc, which packs this code about 2 KB gzip tighter than esbuild. */
async function bundleScript(root: string, entry: string, minify: boolean): Promise<Bundle> {
  const result = await build({
    entryPoints: [path.join(root, entry)],
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: TARGET,
    minify: false,
    write: false,
    metafile: true,
    legalComments: 'none',
    logLevel: 'error',
    plugins: [phaserGlobal],
  });
  const meta: Metafile = result.metafile ?? { inputs: {}, outputs: {} };
  const inputs = new Set(Object.keys(meta.inputs).map((p) => path.resolve(root, p)));
  let code = result.outputFiles[0].text;
  if (minify) {
    const out = minifySync(path.basename(entry), code, { compress: { target: TARGET }, mangle: true });
    if (out.errors.length) throw new Error(`Minifying ${entry} failed: ${out.errors.map((e) => e.message).join('; ')}`);
    code = out.code;
  }
  return { code, inputs };
}

async function bundleRuntime(root: string, entry: string, minify: boolean): Promise<Bundle> {
  const runtime = await bundleScript(root, entry, minify);
  const phaser = readFileSync(path.join(root, 'node_modules/phaser/dist/phaser.min.js'), 'utf8');
  return { code: `${phaser}\n;\n${runtime.code}`, inputs: runtime.inputs };
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

const hash10 = (code: string) => createHash('sha256').update(code).digest('hex').slice(0, 10);

export function runtimeFileName(code: string): string {
  return `assets/amble-player-${hash10(code)}.js`;
}

export function standaloneFileName(code: string): string {
  return `assets/amble-standalone-${hash10(code)}.js`;
}

export function ambleRuntime(options: AmbleRuntimeOptions = {}): Plugin {
  const entry = options.entry ?? 'src/runtime/shell/index.ts';
  let root = options.root ?? process.cwd();
  let isBuild = false;
  const dev: Record<string, { make: () => Promise<Bundle>; bundle: Promise<Bundle> | null; inputs: Set<string> }> = {
    [DEV_FILE]: { make: () => bundleRuntime(root, entry, false), bundle: null, inputs: new Set() },
    [DEV_STANDALONE]: { make: () => bundleScript(root, STANDALONE_ENTRY, false), bundle: null, inputs: new Set() },
  };

  const devBuild = (file: string): Promise<Bundle> => {
    const d = dev[file];
    d.bundle ??= d.make().then(
      (b) => {
        d.inputs = b.inputs;
        return b;
      },
      (err: unknown) => {
        d.bundle = null;
        throw err;
      },
    );
    return d.bundle;
  };

  const invalidate = (server: ViteDevServer, file: string): void => {
    const abs = path.resolve(file);
    const runtimeDir = path.join(root, 'src', 'runtime') + path.sep;
    let hit = false;
    for (const d of Object.values(dev)) {
      if (!d.inputs.has(abs) && !abs.startsWith(runtimeDir)) continue;
      d.bundle = null;
      hit = true;
    }
    if (hit) server.ws.send({ type: 'full-reload' });
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
      if (!isBuild) {
        const url = (file: string) => `new URL(import.meta.env.BASE_URL + ${JSON.stringify(file)}, location.href).href`;
        return `export default ${url(DEV_FILE)};\nexport const standaloneUrl = ${url(DEV_STANDALONE)};`;
      }
      const [runtime, standalone] = await Promise.all([bundleRuntime(root, entry, true), bundleScript(root, STANDALONE_ENTRY, true)]);
      const ref = this.emitFile({ type: 'asset', fileName: runtimeFileName(runtime.code), source: runtime.code });
      const standaloneRef = this.emitFile({ type: 'asset', fileName: standaloneFileName(standalone.code), source: standalone.code });
      // The bundler writes the URLs relative to the chunk that imports them, so they work under any base
      // (GitHub Pages' /amble/) and from pages in sub-folders.
      return `export default import.meta.ROLLUP_FILE_URL_${ref};\nexport const standaloneUrl = import.meta.ROLLUP_FILE_URL_${standaloneRef};`;
    },
    configureServer(server) {
      for (const event of ['change', 'add', 'unlink'] as const) server.watcher.on(event, (file: string) => invalidate(server, file));
      server.middlewares.use((req, res, next) => {
        const pathname = (req.url ?? '').split('?')[0];
        const file = Object.keys(dev).find((f) => pathname.endsWith('/' + f));
        if (!file) return next();
        devBuild(file).then(
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
