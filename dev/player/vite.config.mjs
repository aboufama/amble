// Dev harness for the player core: `npx vite --config dev/player/vite.config.mjs`, then open
// http://127.0.0.1:5213/dev/player/index.html
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { ambleRuntime } from '../../vite/ambleRuntime.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export default defineConfig({
  root,
  base: '/',
  cacheDir: path.join(root, '.vite-player'),
  plugins: [ambleRuntime({ root })],
  server: { port: 5213, strictPort: true, host: '127.0.0.1' },
  clearScreen: false,
});
