/** M3's routes render (FOUNDATION-STUB spec; M3 replaces it with desk, on-the-bones and bring-to-life specs). */
import { expect, gotoRoute, openAmble, test } from '../helpers/app';

test('the Desk opens for a free drawing and for a cast member', async ({ page }) => {
  await openAmble(page, { route: '#/draw/new' });
  await expect(page.getByTestId('screen-draw')).toBeVisible();
  await gotoRoute(page, '#/starter/moon-king');
  await expect(page.getByTestId('screen-world')).toBeVisible();
  const id = new URL(page.url()).hash.replace('#/w/', '');
  await gotoRoute(page, `#/w/${id}/draw/moonKing`);
  await expect(page.getByTestId('screen-draw')).toBeVisible();
});
