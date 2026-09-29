/** M6's starting point (FOUNDATION-STUB spec; M6 replaces it with files, persistence and offline specs). */
import { expect, gotoRoute, openAmble, test } from '../helpers/app';

test('worlds persist in IndexedDB across a reload', async ({ page }) => {
  await openAmble(page);
  const mode = await page.evaluate(() => (window as unknown as { __amble: { store: { mode: string } } }).__amble.store.mode);
  expect(mode).toBe('idb');
  await gotoRoute(page, '#/starter/moon-king');
  await expect(page.getByTestId('screen-world')).toBeVisible();
  const url = page.url();
  await page.reload();
  await expect(page.getByTestId('screen-world')).toBeVisible();
  expect(page.url()).toBe(url);
  const count = await page.evaluate(async () => (await (window as unknown as { __amble: { store: { worlds: { list(): Promise<unknown[]> } } } }).__amble.store.worlds.list()).length);
  expect(count).toBe(1);
});

test('Settings → Storage renders', async ({ page }) => {
  await openAmble(page, { route: '#/settings/storage' });
  await expect(page.getByTestId('screen-settings')).toBeVisible();
});
