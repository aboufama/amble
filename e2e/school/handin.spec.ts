/**
 * Hand in (§2.13): the checklist with what Amble found, initials (never a full name) in the file name, Save
 * to Drive through the save picker, the Classroom steps, and "I turned it in" remembered on the world.
 */
import { expect, gotoRoute, openAmble, test } from '../helpers/app';
import { mockAi } from '../helpers/mockAi';
import { fakePickers, saves, worldWithAssignment } from './school';

test('checklist, initials, Save to Drive and I turned it in', async ({ page }) => {
  await mockAi(page);
  await fakePickers(page);
  await openAmble(page, { clean: true, ai: 'mock' });
  const id = await worldWithAssignment(page);
  await gotoRoute(page, `#/w/${id}/handin`);
  await expect(page).toHaveURL(new RegExp(`#/w/${id}/handin$`));

  await expect(page.getByTestId('screen-handin')).toBeVisible();
  const sheet = page.getByRole('dialog', { name: /^Hand in your world/ });
  await expect(sheet.getByRole('heading', { name: /^Hand in your world/ })).toBeVisible();
  await expect(sheet).toContainText('Boss Battle Week');
  await expect(sheet).toContainText('Your hero is still just bones.');
  await expect(sheet.getByRole('link', { name: 'Draw it' }).first()).toBeVisible();
  await expect(sheet).toContainText('Amble found 4 in your code');

  const initials = sheet.getByLabel('Your initials');
  await initials.fill('J.R.');
  await expect(sheet.getByLabel('File name')).toHaveValue('Moon King - J.R.amble');

  await sheet.getByTestId('save-drive').click();
  await expect.poll(() => saves(page)).toEqual(['Moon King - J.R.amble']);

  await sheet.getByTestId('turned-in').click();
  await page.waitForFunction(async (wid) => {
    const w = await (window as any).__amble.services.store.worlds.get(wid);
    return Boolean(w?.handIn?.turnedInAt) && w.credits.madeBy === 'J.R.' && w.handIn.fileName === 'Moon King - J.R.amble';
  }, id);
});
