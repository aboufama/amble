/**
 * The Teacher desk (§2.14): make a class link (live test of the class code, QR code, Copy link), open it as
 * a student would, make an assignment and put it in the link, the What students see preview, Help &
 * letters, and Present mode.
 */
import { expect, gotoRoute, openAmble, test, waitForApp } from '../helpers/app';
import { AI_BASE, CLASS_CODE, mockAi } from '../helpers/mockAi';

test('a class link: live test, QR code, Copy link, and a student joins with it', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await mockAi(page);
  await openAmble(page, { clean: true, route: '#/teacher/link' });
  const tab = page.getByTestId('teacher-classlink');
  await tab.getByLabel('AI address').fill(AI_BASE);
  await tab.getByLabel('Class code').fill(CLASS_CODE);
  await expect(tab.getByText(/works · \d+\.\d s/)).toBeVisible();
  await tab.getByLabel('Name students see').fill('Room 12 · Period 3');
  await expect(tab.getByRole('img', { name: /QR code/ })).toBeVisible();
  await expect(tab.getByText('Join Room 12 · Period 3?')).toBeVisible();

  await tab.getByTestId('copy-link').click();
  await expect(page.getByText('Link copied. Paste it in Google Classroom.')).toBeVisible();
  const href = await page.evaluate(() => navigator.clipboard.readText());
  expect(href).toMatch(/#class=[A-Za-z0-9_-]+$/);

  // The live test is logged exactly as sent, without the class code.
  await gotoRoute(page, '#/sent');
  await expect(page.getByTestId('sent-entry')).toHaveCount(1);
  await expect(page.getByTestId('sent-entry')).not.toContainText(CLASS_CODE);

  // A student opens it.
  const student = await context.newPage();
  await mockAi(student);
  await student.goto(href);
  await waitForApp(student);
  await expect(student.getByRole('dialog').getByRole('heading', { name: 'Join Room 12 · Period 3?' })).toBeVisible();
  await student.getByRole('dialog').getByRole('button', { name: 'Join', exact: true }).click();
  await student.waitForFunction((base) => (window as any).__amble.getState().config.ai?.baseUrl === base, AI_BASE);
  await student.close();
});

test('an assignment goes into the class link', async ({ page }) => {
  await openAmble(page, { clean: true, route: '#/teacher/assignments' });
  await page.getByRole('button', { name: 'New assignment' }).first().click();
  const editor = page.getByTestId('assignment-editor');
  await editor.getByLabel('Title').fill('Boss Battle Week');
  await editor.getByLabel('Instructions').fill('Draw your own hero and boss, then give the boss two attacks.');
  await editor.getByLabel('Due', { exact: true }).fill('Friday');
  // The cast offers characters to draw, not tiles or shots.
  await expect(editor.getByRole('checkbox', { name: /^Pip/ })).toBeVisible();
  await expect(editor.getByRole('checkbox', { name: /^Moon rock/ })).toHaveCount(0);
  await editor.getByRole('checkbox', { name: /^The Moon King/ }).check();
  await editor.getByRole('checkbox', { name: /^Boss has 2\+ attacks/ }).check();
  await editor.getByPlaceholder('A creative twist (you decide)').fill('A surprise in phase two');
  await editor.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(editor).toContainText('A surprise in phase two');
  await editor.getByRole('radio', { name: 'Explain only' }).click();
  await page.getByRole('button', { name: 'Put it in the class link' }).click();

  await expect(page.getByTestId('teacher-classlink')).toBeVisible();
  await expect(page.getByLabel('Assignment').locator('option:checked')).toHaveText('Boss Battle Week');
  await gotoRoute(page, '#/teacher/assignments');
  const list = page.getByTestId('teacher-assignments');
  await expect(list).toContainText('Boss Battle Week');
  await expect(list).toContainText('2 goals');
});

test('Help & letters opens every page, and Present hides names', async ({ page }) => {
  await openAmble(page, { clean: true, route: '#/teacher/help' });
  const help = page.getByTestId('teacher-help');
  await help.getByRole('link', { name: /Letter for families/ }).click();
  await expect(page.locator('[data-page="parents"]')).toBeVisible();
  await expect(page.locator('[data-page="parents"]')).toContainText('Every picture in your child');
  await page.goBack();
  await expect(help).toBeVisible();
  await help.getByText("Can Amble see my students' work?").click();
  await expect(help.getByText('No. Amble has no server.', { exact: false })).toBeVisible();

  await gotoRoute(page, '#/teacher/present');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'day');
  await expect(page.getByRole('switch', { name: 'Show names' })).not.toBeChecked();
  await page.getByRole('link', { name: 'Back to the gallery' }).click();
  await expect(page.locator('html')).not.toHaveAttribute('data-theme', 'day');
});
