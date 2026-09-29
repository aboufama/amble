// Headless check for the AI plumbing: starts the harness server on 5214, opens the harness in
// Chromium with a teacher's class link in the fragment, and fails if any check fails.
//   node dev/ai/check.mjs [screenshot.png]
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const here = path.dirname(fileURLToPath(import.meta.url));
const shot = process.argv[2];

const link = {
  v: 1,
  baseUrl: 'http://localhost:5214/mock/sse-classlink/v1',
  model: 'amble-default',
  code: 'MAPLE-7Q2K',
  name: 'Room 12',
  district: 'SAU 99',
  policy: { ageBand: 'middle', safetyIdentifier: true },
};
const fragment = `#class=${Buffer.from(JSON.stringify(link)).toString('base64url')}`;

const server = await createServer({ configFile: path.join(here, 'vite.config.mjs') });
await server.listen();
let failed = 0;
const browser = await chromium.launch({
  executablePath: process.env.PW_CHROMIUM_PATH || '/opt/pw-browsers/chromium',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
try {
  const page = await browser.newPage({ viewport: { width: 1100, height: 980 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`http://127.0.0.1:5214/dev/ai/index.html${fragment}`);
  await page.waitForFunction(() => window.__aiHarness?.done === true, null, { timeout: 90_000 });
  const results = await page.evaluate(() => window.__aiHarness.results);
  const url = page.url();
  for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name.padEnd(76)} ${String(Math.round(r.ms)).padStart(5)} ms  ${r.detail}`);
  if (url.includes('class=')) {
    console.log('FAIL  the class link is still in the address bar');
    failed++;
  }
  for (const e of errors) console.log(`PAGE ERROR  ${e}`);
  failed += results.filter((r) => !r.ok).length + errors.length;
  console.log(`\n${results.length - results.filter((r) => !r.ok).length}/${results.length} checks passed`);
  if (shot) await page.screenshot({ path: shot, fullPage: true });
} finally {
  await browser.close();
  await server.close();
}
process.exit(failed ? 1 : 0);
