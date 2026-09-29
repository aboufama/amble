/** M2's route renders (FOUNDATION-STUB spec; M2 replaces it with world-play, change-mode and ghost-loop specs). */
import { expect, gotoRoute, openAmble, test } from '../helpers/app';

test('a starter opens as a world with the game slot under the player layer', async ({ page }) => {
  await openAmble(page);
  await gotoRoute(page, '#/starter/moon-king');
  await expect(page).toHaveURL(/#\/w\/[A-Za-z0-9_-]+$/);
  await expect(page.getByTestId('screen-world')).toBeVisible();
  const slot = page.getByTestId('world-slot');
  await expect(slot).toHaveAttribute('id', 'game');
  const layer = page.getByTestId('player-layer');
  await expect.poll(async () => (await layer.boundingBox())?.width ?? 0).toBeGreaterThan(100);
  const [a, b] = await Promise.all([slot.boundingBox(), layer.boundingBox()]);
  expect(Math.abs(a!.x - b!.x)).toBeLessThan(2);
  expect(Math.abs(a!.y - b!.y)).toBeLessThan(2);
});

test('the skip link says "Skip to the game" in a world', async ({ page }) => {
  await openAmble(page);
  await gotoRoute(page, '#/starter/moon-king');
  await expect(page.getByTestId('screen-world')).toBeVisible();
  await expect(page.locator('.skip-link')).toHaveText('Skip to the game');
});
