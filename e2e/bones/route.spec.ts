/** M4's routes render (FOUNDATION-STUB spec; M4 replaces it with bones.spec.ts). */
import { expect, gotoRoute, openAmble, test } from '../helpers/app';

test('Bones opens for a free drawing and for a cast member', async ({ page }) => {
  await openAmble(page, { route: '#/bones/a_test000001' });
  await expect(page.getByTestId('screen-bones')).toBeVisible();
  await gotoRoute(page, '#/starter/moon-king');
  await expect(page.getByTestId('screen-world')).toBeVisible();
  const id = new URL(page.url()).hash.replace('#/w/', '');
  await gotoRoute(page, `#/w/${id}/bones/hero`);
  await expect(page.getByTestId('screen-bones')).toBeVisible();
});
