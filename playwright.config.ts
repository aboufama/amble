import { defineConfig } from '@playwright/test';

// Each checkout tests its own dev server: set E2E_PORT to give it a port of its own, and
// E2E_REUSE=1 to test a server that is already running there.
const port = Number(process.env.E2E_PORT) || 5199;
const baseURL = `http://localhost:${port}`;

// Set PW_CHROMIUM_PATH to use an existing Chromium binary instead of Playwright's download.
const executablePath = process.env.PW_CHROMIUM_PATH || undefined;

export default defineConfig({
  testDir: 'e2e',
  timeout: 90_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL,
    viewport: { width: 1440, height: 900 },
    launchOptions: {
      executablePath,
      // Software WebGL, so games render on machines without a GPU (CI).
      args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
    },
  },
  webServer: {
    command: `npx vite --port ${port} --strictPort`,
    url: baseURL,
    reuseExistingServer: !!process.env.E2E_REUSE,
    timeout: 60_000,
    env: { OPENAI_API_KEY: '' },
  },
});
