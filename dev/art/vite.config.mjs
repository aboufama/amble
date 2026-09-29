// Dev server for the art engine harness: `npx vite --config dev/art/vite.config.mjs`, then open
// http://localhost:5211/dev/art/ (query: w, h, kind, pixel=1, perf=1, probe=1, desync=0, worker=0).
import { defineConfig } from 'vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export default defineConfig({
  root,
  cacheDir: path.join(root, '.vite-art'),
  server: { port: 5211, strictPort: true, host: 'localhost' },
  logLevel: 'warn',
});
