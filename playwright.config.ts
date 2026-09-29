import { defineConfig, type PlaywrightTestConfig } from '@playwright/test';

// Each checkout tests its own servers: E2E_PORT gives it a port of its own (the production preview uses
// E2E_PORT + 100), and E2E_REUSE=1 tests servers that are already running there.
const port = Number(process.env.E2E_PORT) || 5199;
const prodPort = port + 100;
const devURL = `http://localhost:${port}`;
const prodURL = `http://localhost:${prodPort}/amble/`;

// Set PW_CHROMIUM_PATH to use an existing Chromium binary instead of Playwright's download.
const executablePath = process.env.PW_CHROMIUM_PATH || undefined;

// The `prod` project builds the app first, so it runs only when asked for: `--project prod`, or E2E_PROD=1
// to run it after `dev`.
const wantsProd = !!process.env.E2E_PROD || process.argv.some((a, i, all) => a === '--project=prod' || (a === '--project' && all[i + 1] === 'prod'));
// Workers load this file again without the command line: the environment carries the choice to them.
if (wantsProd) process.env.E2E_PROD = '1';

const use: PlaywrightTestConfig['use'] = {
  viewport: { width: 1366, height: 768 },
  launchOptions: {
    executablePath,
    // Software WebGL, so games render on machines without a GPU (CI).
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  },
};

// A server key must never reach a test: the app talks to the mocked class endpoint only.
const env = { OPENAI_API_KEY: '' };

export default defineConfig({
  testDir: 'e2e',
  // The player core's own spec runs against its harness server: npx playwright test -c dev/player/playwright.config.ts
  testIgnore: /player\.spec\.ts$/,
  timeout: 90_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use,
  projects: [
    { name: 'dev', use: { ...use, baseURL: devURL } },
    ...(wantsProd ? [{ name: 'prod', grep: /@prod/, use: { ...use, baseURL: prodURL } }] : []),
  ],
  webServer: [
    {
      command: `npx vite --port ${port} --strictPort`,
      url: devURL,
      reuseExistingServer: !!process.env.E2E_REUSE,
      timeout: 60_000,
      env,
    },
    ...(wantsProd
      ? [
          {
            command: `npm run build && npx vite preview --base /amble/ --port ${prodPort} --strictPort`,
            url: prodURL,
            reuseExistingServer: !!process.env.E2E_REUSE,
            timeout: 240_000,
            env,
          },
        ]
      : []),
  ],
});
