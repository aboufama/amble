// The starters' review harness: `npx vite --config tools/starters/vite.config.mjs`, then open
// http://127.0.0.1:5288/tools/starters/harness/index.html (review.mjs starts it by itself).
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { ambleRuntime } from '../../vite/ambleRuntime.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export default defineConfig({
  root,
  base: '/',
  cacheDir: path.join(root, '.vite', 'starters-harness'),
  plugins: [ambleRuntime({ root })],
  server: { port: Number(process.env.STARTERS_PORT) || 5288, strictPort: true, host: '127.0.0.1', fs: { strict: false } },
  clearScreen: false,
});
