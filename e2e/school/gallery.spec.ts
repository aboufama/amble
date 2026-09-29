/**
 * The class gallery (§2.14): open a Classroom folder of real `.amble` files, cards with who made them and
 * what went wrong, filters, the detail panel's checklist with what Amble found in the code, feedback that
 * stays on this Chromebook, and the Feedback CSV.
 */
import { expect, gotoRoute, openAmble, test } from '../helpers/app';
import { fakePickers, putClassFolder, savedText, saves } from './school';

test('a Classroom folder becomes cards, checks and feedback', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await fakePickers(page);
  await openAmble(page, { clean: true });
  await putClassFolder(
    page,
    [
      { name: 'Moon Slime Rumble - J.R.amble', title: 'Moon Slime Rumble', madeBy: 'J.R.' },
      { name: 'Robo vs Goo - A.M.amble', title: '=Robo vs Goo', madeBy: 'A.M.', broken: true },
    ],
    [
      { name: 'untitled - L.V.amble', text: 'not a zip' },
      { name: 'notes.txt', text: 'hello' },
    ],
  );

  await gotoRoute(page, '#/teacher/gallery');
  const gallery = page.getByTestId('teacher-gallery');
  await gallery.getByTestId('open-folder').click();
  await expect(gallery.getByTestId('gallery-card')).toHaveCount(3);
  await expect(gallery).toContainText('Boss Battle Week');
  await expect(gallery).toContainText('Classroom folder · 3 files');
  await expect(gallery).toContainText('Nothing is uploaded');
  const errors = gallery.getByRole('button', { name: /^Errors/ });
  await expect(errors).toContainText('2');

  // The broken file's card says why; the world with a typo counts as an error.
  await errors.click();
  await expect(gallery.getByTestId('gallery-card')).toHaveCount(2);
  await gallery.getByRole('button', { name: /^All/ }).click();

  await gallery.getByTestId('gallery-card').filter({ hasText: 'Moon Slime Rumble' }).click();
  const detail = page.getByTestId('gallery-detail');
  await expect(detail.getByRole('heading', { name: /Moon Slime Rumble/ })).toContainText('by J.R.');
  const attacks = detail.locator('.gchecks__row').filter({ hasText: 'Boss has 2+ attacks' });
  await expect(attacks).toContainText('4 found in code');
  await expect(detail.locator('.gchecks__row').filter({ hasText: 'Hero drawn by the student' })).toContainText('just bones');
  const twist = detail.getByRole('checkbox', { name: 'A creative twist' });
  await twist.check();
  await expect(twist).toBeChecked();

  await detail.getByPlaceholder('Write feedback, then copy it into Classroom.').fill('Great boss! Try a third attack.');
  await detail.getByTestId('copy-feedback').click();
  await expect(page.getByText('Copied. Paste it in Classroom as a private comment.')).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('Great boss! Try a third attack.');

  // Feedback and checks stay with the file on this Chromebook.
  await gotoRoute(page, '#/teacher/help');
  await gotoRoute(page, '#/teacher/gallery');
  await expect(page.getByTestId('gallery-detail').getByPlaceholder('Write feedback, then copy it into Classroom.')).toHaveValue('Great boss! Try a third attack.');

  await page.getByTestId('feedback-csv').click();
  await expect(page.getByText(/^Saved Feedback - Boss Battle Week\.csv\./)).toBeVisible();
  expect(await saves(page)).toContain('Feedback - Boss Battle Week.csv');
  const csv = await savedText(page, 'Feedback - Boss Battle Week.csv');
  expect(csv).toContain('Great boss! Try a third attack.');
  // A title that starts like a formula is written as text.
  expect(csv).toContain("'=Robo vs Goo");
});
