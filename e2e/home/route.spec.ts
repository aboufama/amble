/** M1's routes render (FOUNDATION-STUB spec; M1 replaces it with first-page, trail and plan specs). */
import { expect, gotoRoute, openAmble, test } from '../helpers/app';

test('Home, the First page, the Trail, New world and the plan card render', async ({ page }) => {
  await openAmble(page);
  await expect(page.getByTestId('screen-home')).toHaveAttribute('data-home', /first|trail/);
  for (const [hash, id] of [
    ['#/first', 'screen-first'],
    ['#/trail', 'screen-trail'],
    ['#/trail/list', 'screen-trail'],
    ['#/trail/lost', 'screen-trail'],
    ['#/new', 'screen-new'],
    ['#/plan', 'screen-plan'],
  ]) {
    await gotoRoute(page, hash);
    await expect(page.getByTestId(id), hash).toBeVisible();
  }
});

test('a clean profile picks the First page', async ({ page }) => {
  await openAmble(page, { clean: true });
  await expect(page.getByTestId('screen-home')).toHaveAttribute('data-home', 'first');
});
