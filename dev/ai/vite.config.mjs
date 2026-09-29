// Dev server for the AI harness: `node dev/ai/check.mjs` (headless check), or
// `npx vite --config dev/ai/vite.config.mjs` and open http://127.0.0.1:5214/dev/ai/index.html
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { mockAi } from './mock.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export default defineConfig({
  root,
  // Its own dependency cache: node_modules is shared with other checkouts.
  cacheDir: '.vite-ai',
  // The mock answers CORS itself (Vite's default CORS would allow this origin for every scenario).
  server: { host: '127.0.0.1', port: 5214, strictPort: true, cors: false },
  plugins: [mockAi()],
  logLevel: 'warn',
});
