/// <reference types="vitest/config" />
import { defineConfig, loadEnv, type Plugin, type Connect } from 'vite';
import react from '@vitejs/plugin-react';
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));

/**
 * The game player (Babylon.js + Havok + the Amble engine) runs inside a sandboxed
 * iframe with an opaque origin. It is bundled separately into a classic script,
 * `amble-player.js`, which the iframe loads with a plain <script src> (no CORS
 * needed). The Havok WebAssembly binary is handed to the iframe by the editor.
 */
function playerRuntime(): Plugin {
  const entry = path.join(root, 'src/engine/index.ts');
  const havokWasm = path.join(root, 'node_modules/@babylonjs/havok/lib/esm/HavokPhysics.wasm');
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
        if (url === '/amble-havok.wasm') {
          res.setHeader('content-type', 'application/wasm');
          res.end(readFileSync(havokWasm));
          return;
        }
        next();
      });
    },
    async generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'amble-player.js', source: await bundle(true) });
      this.emitFile({ type: 'asset', fileName: 'amble-havok.wasm', source: readFileSync(havokWasm) });
    },
  };
}

/**
 * Optional server-side key: if OPENAI_API_KEY is set, `/api/openai/*` is
 * proxied to OpenAI with the key attached so it never reaches the browser.
 */
function openaiProxy(env: Record<string, string>): Plugin {
  const key = env.OPENAI_API_KEY || process.env.OPENAI_API_KEY || '';
  const baseUrl = (env.OPENAI_BASE_URL || process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '');

  const handler: Connect.NextHandleFunction = (req, res, next) => {
    const url = req.url ?? '';
    if (url === '/api/config') {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ serverKey: Boolean(key) }));
      return;
    }
    if (!url.startsWith('/api/openai/')) {
      next();
      return;
    }
    void (async () => {
      if (!key) {
        res.statusCode = 401;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ error: { message: 'OPENAI_API_KEY is not set on the server.' } }));
        return;
      }
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      const controller = new AbortController();
      res.on('close', () => controller.abort());
      try {
        const upstream = await fetch(baseUrl + url.slice('/api/openai'.length), {
          method: req.method,
          headers: {
            'content-type': String(req.headers['content-type'] ?? 'application/json'),
            authorization: `Bearer ${key}`,
          },
          body: req.method === 'GET' || req.method === 'HEAD' ? undefined : Buffer.concat(chunks),
          signal: controller.signal,
        });
        res.statusCode = upstream.status;
        upstream.headers.forEach((value, name) => {
          if (!['content-encoding', 'content-length', 'transfer-encoding', 'connection'].includes(name)) {
            res.setHeader(name, value);
          }
        });
        res.flushHeaders();
        if (upstream.body) {
          for await (const chunk of upstream.body) res.write(chunk);
        }
        res.end();
      } catch (err) {
        if (controller.signal.aborted) return;
        res.statusCode = 502;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ error: { message: `Proxy error: ${(err as Error).message}` } }));
      }
    })();
  };

  return {
    name: 'amble-openai-proxy',
    configureServer(server) {
      server.middlewares.use(handler);
    },
    configurePreviewServer(server) {
      server.middlewares.use(handler);
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
      include: ['tests/**/*.test.ts'],
      environment: 'node',
    },
  };
});
