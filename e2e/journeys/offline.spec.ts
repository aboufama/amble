/**
 * Offline (§4.3, §5.15, §10.2 `prod @prod`): once the service worker has installed and warmed the starter
 * worlds, the network can go away: a reload still opens Amble from its sub-path, the student's own world
 * plays, a starter they never opened plays with its drawings, the Desk draws and brings a drawing to
 * life, and the wish box says wishes come back online. Runs in the `prod` project; the dev server has no service worker.
 */
import { classLinkPayload, expect, test, TEST_CLASS } from '../helpers/app';
import { mockAi } from '../helpers/mockAi';

const firstFrames = async (page: import('@playwright/test').Page) => Number((await page.getByTestId('player-layer').getAttribute('data-first-frame')) ?? 0);

test('offline after install: my world, a new starter and the Desk work; the wish box says wishes come back online @prod', async ({ page, context }, info) => {
  test.skip(info.project.name !== 'prod', 'Build only: the dev server has no service worker.');
  test.setTimeout(240_000);
  await mockAi(page);
  // The class's wishes are on, so the wish box has something to say about being offline.
  await page.goto(`./#class=${classLinkPayload(TEST_CLASS as unknown as Record<string, unknown>)}`);
  await page.getByRole('dialog').getByRole('button', { name: 'Join', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  await page.waitForFunction(async () => (await navigator.serviceWorker.getRegistration())?.active?.state === 'activated', null, { timeout: 60_000 });
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 30_000 });
  // The starter worlds' files are warmed after install.
  await page.waitForFunction(
    async () => {
      const keys = await caches.keys();
      let files: string[] = [];
      for (const k of keys) files = files.concat((await (await caches.open(k)).keys()).map((r) => new URL(r.url).pathname));
      return files.some((f) => f.startsWith('/amble/starters/sky-run/art/'));
    },
    null,
    { timeout: 90_000, polling: 1000 },
  );

  // My own world, made while online.
  await page.evaluate(() => {
    location.hash = '#/starter/moon-king';
  });
  await expect(page).toHaveURL(/#\/w\/[A-Za-z0-9_-]+$/);
  const mine = new URL(page.url()).hash;
  await expect(page.getByTestId('player-layer')).toHaveAttribute('data-first-frame', /^[1-9]\d*$/, { timeout: 60_000 });

  await context.setOffline(true);
  try {
    await page.reload();
    await expect(page.locator('[data-testid^="screen-"]').first()).toBeVisible();
    expect(new URL(page.url()).pathname).toBe('/amble/');

    // My world plays, and the wish box says wishes come back online.
    await expect(page.getByTestId('screen-world')).toBeVisible();
    expect(new URL(page.url()).hash).toBe(mine);
    await expect(page.getByTestId('player-layer')).toHaveAttribute('data-first-frame', /^[1-9]\d*$/, { timeout: 60_000 });
    await expect(page.getByTestId('ask-card')).toContainText("Wishes come back when you're online.");

    // A starter never opened before plays with its drawings, from the cache.
    const before = await firstFrames(page);
    await page.evaluate(() => {
      location.hash = '#/starter/sky-run';
    });
    await expect(page).toHaveURL(/#\/w\/[A-Za-z0-9_-]+$/);
    await expect.poll(() => firstFrames(page), { timeout: 60_000 }).toBeGreaterThan(before);
    await expect(page.getByTestId('cast-card-hero')).toHaveAttribute('data-status', 'drawn');

    // The Desk opens and draws.
    const world = new URL(page.url()).hash;
    await page.evaluate((w) => {
      location.hash = `${w}/draw/bloop`;
    }, world);
    await expect(page.getByTestId('screen-draw')).toBeVisible();
    const board = page.getByTestId('desk-board');
    await expect(page.locator('.desk__sheet canvas').first()).toBeVisible();
    const b = (await board.boundingBox())!;
    await page.mouse.move(b.x + b.width * 0.4, b.y + b.height * 0.5);
    await page.mouse.down();
    for (let i = 1; i <= 10; i++) await page.mouse.move(b.x + b.width * (0.4 + i * 0.02), b.y + b.height * (0.5 + (i % 2) * 0.02));
    await page.mouse.up();
    // Bring to life works offline too (export and bones in the workers, from the cache).
    await page.waitForTimeout(500);
    await page.getByTestId('bring-to-life').click();
    await page.waitForFunction((w) => location.hash === w, world, { timeout: 60_000 });
    await expect(page.getByTestId('cast-card-bloop')).toHaveAttribute('data-status', 'drawn');
  } finally {
    await context.setOffline(false);
  }
});
