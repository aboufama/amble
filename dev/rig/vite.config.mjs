// Dev server for the rig harness: `npx vite --config dev/rig/vite.config.mjs` → http://127.0.0.1:5212/dev/rig/
import { defineConfig } from 'vite';
import { realpathSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

export default defineConfig({
  root,
  cacheDir: '.vite-rig',
  appType: 'mpa',
  server: {
    host: '127.0.0.1',
    port: 5212,
    strictPort: true,
    open: false,
    // node_modules is a symlink to the main checkout
    fs: { allow: [root, realpathSync(resolve(root, 'node_modules'))] },
  },
  optimizeDeps: { entries: ['dev/rig/index.html'], include: ['phaser'] },
  worker: { format: 'es' },
  clearScreen: false,
});
