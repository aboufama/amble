// Screenshots of the rig harness at 1x and 4x. Needs the harness server running:
//   npx vite --config dev/rig/vite.config.mjs &   then   node dev/rig/shoot.mjs [page...]
// Pages: sheets (every sample), live, perf, preview, worker, editing, canvas. Output: $RIG_OUT.
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const OUT = process.env.RIG_OUT ?? 'out';
const BASE = process.env.RIG_URL ?? 'http://127.0.0.1:5212/dev/rig/index.html';
const SAMPLES = ['hero', 'stick', 'navy', 'wand', 'layered', 'astronaut', 'closeLegs', 'dog', 'cat', 'slime', 'bird', 'bat', 'fish', 'snake', 'crate', 'car'];
mkdirSync(OUT, { recursive: true });

const want = process.argv.slice(2);
const pages = [];
const on = (name) => !want.length || want.includes(name) || want.some((w) => name.startsWith(w));
for (const s of SAMPLES) if (on(`sheet-${s}`) || want.includes('sheets')) pages.push({ name: `sheet-${s}`, query: `mode=sheet&sample=${s}`, zoom: true });
if (on('canvas')) pages.push({ name: 'canvas-hero', query: 'mode=sheet&sample=hero&canvas=1&clips=idle,walk,jump,attack,die' });
if (on('live')) pages.push({ name: 'live', query: 'mode=live', wait: 1500 });
if (on('perf')) pages.push({ name: 'perf', query: 'mode=perf&n=20' });
if (on('preview')) pages.push({ name: 'preview', query: 'mode=preview' });
if (on('worker')) pages.push({ name: 'worker', query: 'mode=worker' });
if (on('editing')) pages.push({ name: 'editing', query: 'mode=editing' });

const browser = await chromium.launch({
  executablePath: process.env.PW_CHROMIUM_PATH ?? '/opt/pw-browsers/chromium',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const summary = {};
try {
  for (const p of pages) {
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => {
      if (m.type() === 'error' && !/favicon|404/.test(m.text())) errors.push(m.text());
    });
    await page.goto(`${BASE}?${p.query}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.waitForFunction(() => window.__rig?.ready, null, { timeout: 120000 });
    if (p.wait) await page.waitForTimeout(p.wait);
    const info = await page.evaluate(() => window.__rig);
    summary[p.name] = { ...info, errors };
    await page.screenshot({ path: join(OUT, `phaser-${p.name}.png`), fullPage: true });
    await ctx.close();
    if (p.zoom) {
      // the first rows up close: seams, cracks and hidden areas show at 4x
      // rendered 4x bigger (not upscaled), so the mesh's real detail shows
      const zctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 1 });
      const zp = await zctx.newPage();
      await zp.goto(`${BASE}?${p.query}&clips=${p.zoomClips ?? 'walk,attack,jump'}&frames=4&cell=440`, { waitUntil: 'domcontentloaded', timeout: 120000 });
      await zp.waitForFunction(() => window.__rig?.ready, null, { timeout: 120000 });
      await zp.screenshot({ path: join(OUT, `phaser-${p.name}-4x.png`), fullPage: true });
      await zctx.close();
    }
    console.log(p.name, JSON.stringify(summary[p.name]).slice(0, 400));
  }
} finally {
  await browser.close();
}
writeFileSync(join(OUT, 'phaser-summary.json'), JSON.stringify(summary, null, 1));
