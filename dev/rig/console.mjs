// Opens a harness page and prints its console and errors for a few seconds (debugging).
// Usage: node dev/rig/console.mjs "mode=preview" [seconds]
import { chromium } from 'playwright';

const BASE = process.env.RIG_URL ?? 'http://127.0.0.1:5212/dev/rig/index.html';
const [query = 'mode=menu', seconds = '8'] = process.argv.slice(2);
const browser = await chromium.launch({
  executablePath: process.env.PW_CHROMIUM_PATH ?? '/opt/pw-browsers/chromium',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
try {
  const page = await browser.newPage();
  page.on('console', (m) => console.log(`[${m.type()}]`, m.text().slice(0, 500)));
  page.on('pageerror', (e) => console.log('[pageerror]', String(e.stack ?? e).slice(0, 1500)));
  await page.goto(`${BASE}?${query}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(Number(seconds) * 1000);
  console.log('__rig =', JSON.stringify(await page.evaluate(() => window.__rig ?? null)).slice(0, 1500));
  console.log('out =', (await page.evaluate(() => document.getElementById('out')?.textContent ?? '')).slice(0, 3000));
} finally {
  await browser.close();
}
