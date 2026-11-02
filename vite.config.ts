/// <reference types="vitest/config" />
import { defineConfig, loadEnv, type Plugin, type Connect } from 'vite';
import react from '@vitejs/plugin-react';
import { build } from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { allowedHostsOf, codexBridge, isSameOrigin, type AllowedHosts } from './server/codexBridge.ts';
import { devOptions, handleAmbleApi, hostedOptions } from './api/amble.ts';

const root = path.dirname(fileURLToPath(import.meta.url));

/**
 * The game player (Phaser + the Amble engine) runs inside a sandboxed iframe with an
 * opaque origin. It is bundled separately into a classic script, `amble-player.js`,
 * which the iframe loads with a plain <script src> (no CORS needed).
 */
function playerRuntime(): Plugin {
  const entry = path.join(root, 'src/engine/index.ts');
  let cached: Promise<string> | null = null;

  const bundle = async (minify: boolean): Promise<string> => {
    const result = await build({
      entryPoints: [entry],
      bundle: true,
      format: 'iife',
      platform: 'browser',
      target: 'es2020',
      minify,
      write: false,
      legalComments: 'none',
      define: { 'import.meta.url': '""' },
      logLevel: 'error',
    });
    return result.outputFiles[0].text;
  };

  return {
    name: 'amble-player-runtime',
    configureServer(server) {
      server.watcher.on('change', (file) => {
        if (file.includes(`${path.sep}src${path.sep}engine${path.sep}`) || file.endsWith('protocol.ts')) cached = null;
      });
      server.middlewares.use((req, res, next) => {
        const url = (req.url ?? '').split('?')[0];
        if (url === '/amble-player.js') {
          cached ??= bundle(false);
          cached.then(
            (js) => {
              res.setHeader('content-type', 'text/javascript; charset=utf-8');
              res.setHeader('cache-control', 'no-cache');
              res.end(js);
            },
            (err: Error) => {
              cached = null;
              res.statusCode = 500;
              res.end(`console.error(${JSON.stringify(String(err.message))})`);
            },
          );
          return;
        }
        next();
      });
    },
    async generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'amble-player.js', source: await bundle(true) });
    },
  };
}

/**
 * Optional server-side key: if OPENAI_API_KEY is set, `/api/openai/*` is proxied to OpenAI with
 * the key attached so it never reaches the browser. It's the same handler Vercel runs
 * (api/amble.ts), in its dev mode: your own key, any model. The same servers also host
 * `/api/codex/*`, the "Sign in with ChatGPT" bridge (server/codexBridge.ts).
 */
function openaiProxy(env: Record<string, string>): Plugin {
  const vars = { ...process.env, ...Object.fromEntries(Object.entries(env).filter(([, v]) => v)) };
  // AMBLE_HOSTED=1 runs the server side exactly as Vercel does (its limits, no ChatGPT sign-in), to try a deployment locally.
  const hosted = vars.AMBLE_HOSTED === '1';
  const options = hosted ? hostedOptions(vars) : devOptions(vars);

  const handler = (allowed: AllowedHosts): Connect.NextHandleFunction => (req, res, next) => {
    const url = (req.url ?? '').split('?')[0];
    if (url !== '/api/config' && !url.startsWith('/api/openai/')) {
      next();
      return;
    }
    if (url !== '/api/config' && !isSameOrigin(req, allowed)) {
      res.statusCode = 403;
      res.end();
      return;
    }
    const controller = new AbortController();
    res.on('close', () => {
      if (!res.writableFinished) controller.abort();
    });
    void (async () => {
      try {
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(chunk as Buffer);
        const headers = new Headers();
        for (const [name, value] of Object.entries(req.headers)) {
          if (typeof value === 'string' && !['connection', 'keep-alive', 'transfer-encoding', 'upgrade', 'content-length', 'expect'].includes(name)) headers.set(name, value);
        }
        const request = new Request(`http://${req.headers.host ?? 'localhost'}${req.url}`, {
          method: req.method,
          headers,
          body: req.method === 'GET' || req.method === 'HEAD' ? undefined : Buffer.concat(chunks),
          signal: controller.signal,
        });
        const response = await handleAmbleApi(request, options);
        res.statusCode = response.status;
        response.headers.forEach((value, name) => res.setHeader(name, value));
        res.flushHeaders();
        if (response.body) for await (const chunk of response.body) res.write(chunk);
        res.end();
      } catch (err) {
        if (controller.signal.aborted) return;
        if (!res.headersSent) {
          res.statusCode = 502;
          res.setHeader('content-type', 'application/json');
        }
        res.end(JSON.stringify({ error: { message: `Proxy error: ${(err as Error).message}` } }));
      }
    })();
  };

  return {
    name: 'amble-openai-proxy',
    configureServer(server) {
      const allowed = allowedHostsOf(server.config.server);
      server.middlewares.use(handler(allowed));
      if (!hosted) server.middlewares.use(codexBridge(allowed));
    },
    configurePreviewServer(server) {
      const allowed = allowedHostsOf(server.config.preview);
      server.middlewares.use(handler(allowed));
      if (!hosted) server.middlewares.use(codexBridge(allowed));
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, root, '');
  return {
    // Relative asset paths, so the build works from any sub-path (e.g. GitHub Pages at /amble/).
    base: './',
    plugins: [react(), playerRuntime(), openaiProxy(env)],
    build: {
      chunkSizeWarningLimit: 2500,
    },
    test: {
      include: ['tests/**/*.test.ts', 'server/**/*.test.ts'],
      environment: 'node',
    },
  };
});
