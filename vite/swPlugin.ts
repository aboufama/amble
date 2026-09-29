/**
 * The service worker build step (§4.3, §6.1; M6 owns). After a production build is written:
 * - lists every file of the build; the app's files (page, scripts, styles, fonts, the player, icons,
 *   the web manifest) become the precache, the starter worlds' files are warmed after install;
 * - bundles `src/pwa/sw.ts` with esbuild into `sw.js` beside the page, with that list and a version
 *   (a hash of the list and the page), so an unchanged build never makes browsers update.
 * Also, in dev and builds: links the web manifest from the page, and gives the app its build id
 * (`import.meta.env.AMBLE_BUILD_ID`, 'dev' on the dev server) for the "Amble was updated" chip.
 */
import { createHash } from 'node:crypto';
import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { build } from 'esbuild';
import type { Plugin, ResolvedConfig } from 'vite';

/** Never precached: the worker itself, maps, and GitHub Pages' marker file. */
const SKIP = [/^sw\.js$/, /\.map$/, /^\.nojekyll$/, /(^|\/)\.[^/]+$/];

/** Fetched after install instead of blocking it (big, and only needed once a starter is opened). */
const LATER = [/^starters\//];

async function listFiles(dir: string, base = dir): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await listFiles(full, base)));
    else if (entry.isFile()) out.push(path.relative(base, full).split(path.sep).join('/'));
  }
  return out.sort();
}

export interface SwLists {
  precache: string[];
  later: string[];
}

/** Splits a build's files into the precache and the later warm-up. */
export function splitFiles(files: string[]): SwLists {
  const keep = files.filter((f) => !SKIP.some((re) => re.test(f)));
  return { precache: keep.filter((f) => !LATER.some((re) => re.test(f))), later: keep.filter((f) => LATER.some((re) => re.test(f))) };
}

export function swPlugin(): Plugin {
  let config: ResolvedConfig | null = null;
  const buildId = Date.now().toString(36);
  return {
    name: 'amble-sw',
    config(_user, env) {
      return { define: { 'import.meta.env.AMBLE_BUILD_ID': JSON.stringify(env.command === 'build' ? buildId : 'dev') } };
    },
    configResolved(resolved) {
      config = resolved;
    },
    transformIndexHtml() {
      return [{ tag: 'link', attrs: { rel: 'manifest', href: 'manifest.webmanifest' }, injectTo: 'head' }];
    },
    async closeBundle() {
      if (!config || config.command !== 'build' || config.build.ssr) return;
      const outDir = path.resolve(config.root, config.build.outDir);
      const index = path.join(outDir, 'index.html');
      if (!(await stat(index).catch(() => null))) return;
      const lists = splitFiles(await listFiles(outDir));
      const version = createHash('sha256')
        .update(JSON.stringify(lists))
        .update(await readFile(index))
        .digest('hex')
        .slice(0, 16);
      const result = await build({
        entryPoints: [path.join(config.root, 'src/pwa/sw.ts')],
        bundle: true,
        write: false,
        format: 'iife',
        platform: 'browser',
        target: 'es2020',
        minify: true,
        legalComments: 'none',
        define: {
          __AMBLE_VERSION__: JSON.stringify(version),
          __AMBLE_PRECACHE__: JSON.stringify(lists.precache),
          __AMBLE_LATER__: JSON.stringify(lists.later),
        },
      });
      await writeFile(path.join(outDir, 'sw.js'), result.outputFiles[0].text);
      config.logger.info(`amble-sw: sw.js precaches ${lists.precache.length} files, warms ${lists.later.length} (version ${version})`);
    },
  };
}
