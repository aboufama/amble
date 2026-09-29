/** M8's starting point (FOUNDATION-STUB spec; M8 replaces it with starters.spec.ts): every starter opens as a world. */
import { expect, gotoRoute, openAmble, test } from '../helpers/app';

for (const id of ['moon-king', 'sky-run', 'wobble-tower', 'lantern-maze', 'clanks-climb']) {
  test(`#/starter/${id} opens a new world`, async ({ page }) => {
    await openAmble(page);
    await gotoRoute(page, `#/starter/${id}`);
    await expect(page).toHaveURL(/#\/w\/[A-Za-z0-9_-]+$/);
    await expect(page.getByTestId('screen-world')).toBeVisible();
  });
}
