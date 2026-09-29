import { expect, test, type Page } from '@playwright/test';

// The rig harness (dev/rig/index.html). Run against its own server:
//   npx vite --config dev/rig/vite.config.mjs &  E2E_PORT=5212 E2E_REUSE=1 npx playwright test e2e/rig.spec.ts
// (any dev server rooted at the repo serves the page too).

type RigInfo = Record<string, unknown> & { ready?: boolean };

async function open(page: Page, query: string): Promise<{ info: RigInfo; errors: string[] }> {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/favicon|404/.test(m.text())) errors.push(m.text());
  });
  await page.goto(`/dev/rig/index.html?${query}`);
  await page.waitForFunction(() => (window as unknown as { __rig?: RigInfo }).__rig?.ready === true, null, { timeout: 90_000 });
  const info = await page.evaluate(() => (window as unknown as { __rig: RigInfo }).__rig);
  return { info, errors };
}

/** How many pixels of the page's first canvas are not the background. */
async function paintedPixels(page: Page): Promise<number> {
  const shot = await page.locator('canvas').first().screenshot();
  return shot.length;
}

test('a drawing moves every clip through the Phaser mesh', async ({ page }) => {
  const { info, errors } = await open(page, 'mode=sheet&sample=hero&frames=4&cell=80');
  expect(errors).toEqual([]);
  expect(info.clips).toEqual(expect.arrayContaining(['idle', 'walk', 'run', 'jump', 'attack', 'hurt', 'die']));
  expect(Number(info.triangles)).toBeGreaterThan(200);
  expect(await paintedPixels(page)).toBeGreaterThan(20_000);
});

test('every kind runs around a platformer with physics, no errors', async ({ page }) => {
  const { info, errors } = await open(page, 'mode=live');
  expect(errors).toEqual([]);
  expect(info.count).toBe(16);
  const before = await page.locator('canvas').first().screenshot();
  await page.waitForTimeout(400);
  const after = await page.locator('canvas').first().screenshot();
  expect(before.equals(after)).toBe(false);
});

test('20 characters cost little per frame', async ({ page }) => {
  const { info, errors } = await open(page, 'mode=perf&n=20');
  expect(errors).toEqual([]);
  expect(info.count).toBe(20);
  // rig math for all 20 (the budget is 1-2 ms on a Chromebook)
  expect(Number(info.rigMedianMs)).toBeLessThan(4);
});

test('the Canvas 2D preview animates without Phaser', async ({ page }) => {
  const { errors } = await open(page, 'mode=preview');
  expect(errors).toEqual([]);
  const a = await page.locator('canvas').first().screenshot();
  await page.waitForTimeout(300);
  const b = await page.locator('canvas').first().screenshot();
  expect(a.equals(b)).toBe(false);
});

test('the rig worker rigs and binds off the main thread', async ({ page }) => {
  const { info, errors } = await open(page, 'mode=worker');
  expect(errors).toEqual([]);
  const results = info.results as { name: string; confidence: number; cachedBindMs: number; bindMs: number }[];
  expect(results).toHaveLength(16);
  for (const r of results) expect(r.cachedBindMs).toBeLessThan(r.bindMs);
  expect(info.stripFrames).toBe(8);
  expect(Number(info.longestFrameMs)).toBeLessThan(250);
});

test('the Canvas renderer falls back to cut-out pieces', async ({ page }) => {
  const { errors } = await open(page, 'mode=sheet&sample=dog&canvas=1&clips=idle,walk&frames=3');
  expect(errors).toEqual([]);
  expect(await paintedPixels(page)).toBeGreaterThan(10_000);
});
