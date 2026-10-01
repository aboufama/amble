import { defineConfig } from '@playwright/test';

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
    baseURL: 'http://localhost:5199',
    viewport: { width: 1440, height: 900 },
    launchOptions: {
      executablePath,
      // Software WebGL so the 3D engine works on machines without a GPU (CI).
      args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
    },
  },
  webServer: {
    command: 'npx vite --port 5199 --strictPort',
    url: 'http://localhost:5199',
    reuseExistingServer: true,
    timeout: 60_000,
    env: { OPENAI_API_KEY: '' },
  },
});
