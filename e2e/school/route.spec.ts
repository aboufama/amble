/** M7's routes render (FOUNDATION-STUB spec; M7 replaces it with class-link, teacher, gallery, handin and settings specs). */
import { expect, gotoRoute, openAmble, test } from '../helpers/app';

test('Settings, the Teacher desk, the in-app pages and Hand in render', async ({ page }) => {
  await openAmble(page);
  for (const hash of ['#/settings', '#/settings/ai', '#/teacher/link', '#/teacher/gallery']) {
    await gotoRoute(page, hash);
    await expect(page.getByTestId(hash.startsWith('#/settings') ? 'screen-settings' : 'screen-teacher'), hash).toBeVisible();
  }
  for (const p of ['privacy', 'terms', 'ai', 'it', 'parents', 'accessibility', 'poster', 'sent', 'whatsnew']) {
    await gotoRoute(page, `#/${p}`);
    await expect(page.locator(`[data-page="${p}"]`)).toBeVisible();
  }
  await gotoRoute(page, '#/starter/moon-king');
  await expect(page.getByTestId('screen-world')).toBeVisible();
  const id = new URL(page.url()).hash.replace('#/w/', '');
  await gotoRoute(page, `#/w/${id}/handin`);
  await expect(page.getByTestId('screen-handin')).toBeVisible();
});
