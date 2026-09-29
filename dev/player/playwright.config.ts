// Playwright for the player core, against its own harness on port 5213:
//   npx playwright test -c dev/player/playwright.config.ts
import { defineConfig } from '@playwright/test';

const port = 5213;

export default defineConfig({
  testDir: '../../e2e',
  testMatch: /player\.spec\.ts$/,
  timeout: 120_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    viewport: { width: 1400, height: 900 },
    launchOptions: {
      executablePath: process.env.PW_CHROMIUM_PATH || '/opt/pw-browsers/chromium',
      // Software WebGL, so games render without a GPU.
      args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
    },
  },
  webServer: {
    command: 'npx vite --config dev/player/vite.config.mjs',
    cwd: '../..',
    url: `http://127.0.0.1:${port}/dev/player/index.html`,
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
