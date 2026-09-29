/// <reference types="vitest/config" />
import { defineConfig, loadEnv, searchForWorkspaceRoot, type Plugin, type Connect } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { allowedHostsOf, codexBridge, isSameOrigin, type AllowedHosts } from './server/codexBridge.ts';
import { ambleRuntime, playerBootHashes } from './vite/ambleRuntime.ts';
import { LAZY_GROUPS, PURE_ON_LOAD } from './vite/chunks.ts';
import { aiConnectSources, csp } from './vite/csp.ts';
import { devOnlyGuard } from './vite/devOnlyGuard.ts';
import { envGuard } from './vite/envGuard.ts';
import { swPlugin } from './vite/swPlugin.ts';

const root = path.dirname(fileURLToPath(import.meta.url));

/**
 * Optional server-side key: if OPENAI_API_KEY is set, `/api/openai/*` is
 * proxied to OpenAI with the key attached so it never reaches the browser.
 * The same servers also host `/api/codex/*`, the "Sign in with ChatGPT" bridge
 * (server/codexBridge.ts).
 */
function openaiProxy(env: Record<string, string>): Plugin {
  const key = env.OPENAI_API_KEY || process.env.OPENAI_API_KEY || '';
  const baseUrl = (env.OPENAI_BASE_URL || process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '');

  const handler = (allowed: AllowedHosts): Connect.NextHandleFunction => (req, res, next) => {
    const url = req.url ?? '';
    if (url === '/api/config') {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ serverKey: Boolean(key), codex: true }));
      return;
    }
    if (!url.startsWith('/api/openai/')) {
      next();
      return;
    }
    if (!isSameOrigin(req, allowed)) {
      res.statusCode = 403;
      res.end();
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
    // Dev and preview servers only: production builds never request /api/*.
    apply: 'serve',
    configureServer(server) {
      const allowed = allowedHostsOf(server.config.server);
      server.middlewares.use(handler(allowed));
      server.middlewares.use(codexBridge(allowed));
    },
    configurePreviewServer(server) {
      const allowed = allowedHostsOf(server.config.preview);
      server.middlewares.use(handler(allowed));
      server.middlewares.use(codexBridge(allowed));
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, root, '');
  return {
    // Relative asset paths, so the build works from any sub-path (e.g. GitHub Pages at /amble/).
    base: './',
    // Each checkout keeps its own dependency cache, even when node_modules is shared.
    cacheDir: '.vite',
    // A checkout may link node_modules from elsewhere (parallel worktrees share one install), so the
    // dev server must also serve files from wherever node_modules really lives, fonts included.
    server: { fs: { allow: [searchForWorkspaceRoot(root), realpathSync(path.join(root, 'node_modules'))] } },
    plugins: [
      react(),
      // The game runtime plugin: it bundles the Phaser player for the sandboxed game iframe, serves it
      // from the dev server and emits it into the build (`import runtimeUrl from 'virtual:amble-runtime'`).
      ambleRuntime({ root }),
      envGuard(env),
      // Fails a build that still holds the test hooks or an e2e harness.
      devOnlyGuard(),
      // Game frames (srcdoc) inherit this policy, so it allows the player's bootstrap by its hash.
      csp({ connect: aiConnectSources(env), bootHashes: playerBootHashes }),
      swPlugin(),
      openaiProxy(env),
    ],
    build: {
      chunkSizeWarningLimit: 2500,
      // The validator, the kit's API and the player in chunks of their own, out of the first load.
      rolldownOptions: { treeshake: { moduleSideEffects: PURE_ON_LOAD }, output: { codeSplitting: { groups: LAZY_GROUPS } } },
    },
    test: {
      include: ['tests/**/*.test.ts', 'server/**/*.test.ts'],
      environment: 'node',
      // CSS reaches tests as text (`?raw`), so the token and style checks read the real stylesheets.
      css: { include: [/\.css/] },
    },
  };
});
