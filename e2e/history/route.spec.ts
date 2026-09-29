/** M9's routes render (FOUNDATION-STUB spec; M9 replaces it with footsteps and code specs). */
import { expect, gotoRoute, openAmble, test } from '../helpers/app';

test('Look inside opens for a world and for one of its files', async ({ page }) => {
  await openAmble(page);
  await gotoRoute(page, '#/starter/moon-king');
  await expect(page.getByTestId('screen-world')).toBeVisible();
  const id = new URL(page.url()).hash.replace('#/w/', '');
  await gotoRoute(page, `#/w/${id}/code`);
  await expect(page.getByTestId('screen-code')).toBeVisible();
  await gotoRoute(page, `#/w/${id}/code/game.js`);
  await expect(page.getByTestId('screen-code')).toBeVisible();
});
