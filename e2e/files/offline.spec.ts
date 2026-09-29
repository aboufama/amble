/**
 * Offline (§4.3, §10.2 `prod @prod`): the production build's service worker installs and precaches the
 * app; with the network gone, a reload still opens Amble from its sub-path, and a starter world opens.
 * Runs in the `prod` project (`--project prod` or E2E_PROD=1); the dev server has no service worker.
 */
import { expect, test } from '../helpers/app';

test('the service worker installs, and an offline reload still opens a starter @prod', async ({ page, context }, info) => {
  test.skip(info.project.name !== 'prod', 'Build only: the dev server has no service worker.');
  await page.goto('./');
  await expect(page.locator('[data-testid^="screen-"]').first()).toBeVisible();
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', /manifest\.webmanifest$/);
  // The first install takes over the page at once.
  await page.waitForFunction(async () => (await navigator.serviceWorker.getRegistration())?.active?.state === 'activated', null, { timeout: 60_000 });
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 30_000 });
  const cached = await page.evaluate(async () => {
    const keys = await caches.keys();
    const app = keys.find((k) => k.startsWith('amble-app-'));
    const list = app ? await (await caches.open(app)).keys() : [];
    return { app: Boolean(app), files: list.map((r) => new URL(r.url).pathname) };
  });
  expect(cached.app).toBe(true);
  expect(cached.files).toContain('/amble/index.html');
  expect(cached.files.some((f) => /\/amble\/assets\/.+\.js$/.test(f))).toBe(true);
  expect(cached.files).toContain('/amble/manifest.webmanifest');

  await context.setOffline(true);
  try {
    await page.reload();
    await expect(page.locator('[data-testid^="screen-"]').first()).toBeVisible();
    expect(new URL(page.url()).pathname).toBe('/amble/');
    await page.evaluate(() => {
      location.hash = '#/starter/moon-king';
    });
    await expect(page).toHaveURL(/#\/w\/[A-Za-z0-9_-]+$/);
    await expect(page.getByTestId('screen-world')).toBeVisible();
    // The player (runtime script and Phaser) comes from the cache too: the game draws its first frame.
    await expect(page.getByTestId('player-layer')).toHaveAttribute('data-first-frame', /^[1-9]\d*$/, { timeout: 45_000 });
  } finally {
    await context.setOffline(false);
  }
});
