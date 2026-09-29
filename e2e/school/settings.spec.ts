/**
 * Settings (§2.15): reading choices that last, a grown-up's own AI address with Test connection, What Amble
 * sends, and Delete everything Amble keeps on this Chromebook. Plus every in-app page renders.
 */
import { expect, gotoRoute, openAmble, test, waitForApp } from '../helpers/app';
import { AI_BASE, mockAi } from '../helpers/mockAi';

test('reading choices apply at once and last', async ({ page }) => {
  await openAmble(page, { clean: true, route: '#/settings/reading' });
  const settings = page.getByTestId('screen-settings');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'original');
  await expect(settings.getByRole('radio', { name: 'Original colours' })).toBeChecked();
  await settings.getByRole('radio', { name: 'High contrast' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'contrast');
  await settings.getByRole('radio', { name: '130%' }).click();
  await expect.poll(() => page.evaluate(async () => (await (window as any).__amble.services.store.settings.get('prefs'))?.textScale)).toBe(1.3);
  await page.reload();
  await waitForApp(page);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'contrast');
  await expect(page.getByTestId('screen-settings').getByRole('radio', { name: 'High contrast' })).toBeChecked();
  await expect(page.getByTestId('screen-settings').getByRole('radio', { name: '130%' })).toBeChecked();
});

test('a grown-up’s AI address: test, save, and every request in What Amble sends', async ({ page }) => {
  await mockAi(page);
  await openAmble(page, { clean: true, route: '#/settings/ai' });
  const settings = page.getByTestId('screen-settings');
  await expect(page.getByTestId('ai-status')).toContainText('Off');
  await settings.getByText('Set up AI (for grown-ups)').click();
  await settings.getByLabel('Base URL').fill(AI_BASE);
  await settings.getByRole('textbox', { name: 'Model', exact: true }).fill('test-model');
  await settings.getByRole('button', { name: 'Test connection' }).click();
  await expect(settings.getByText(/It works · \d+\.\d s/)).toBeVisible();
  await settings.getByRole('button', { name: 'Save', exact: true }).click();
  await page.waitForFunction((base) => (window as any).__amble.getState().config.ai?.baseUrl === base, AI_BASE);

  await gotoRoute(page, '#/sent');
  const entry = page.getByTestId('sent-entry');
  await expect(entry).toHaveCount(1);
  await expect(entry).toContainText('ai.test');
  // The entry lines up with the Clear row above it.
  const clear = (await page.getByRole('button', { name: 'Clear' }).boundingBox())!;
  const card = (await entry.boundingBox())!;
  expect(Math.abs(card.x + card.width - (clear.x + clear.width))).toBeLessThanOrEqual(1);
  await page.getByRole('button', { name: 'Clear' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Clear' }).click();
  await expect(entry).toHaveCount(0);
});

test('Delete everything empties Amble after typing DELETE', async ({ page }) => {
  await openAmble(page, { clean: true });
  await gotoRoute(page, '#/starter/moon-king');
  await expect(page).toHaveURL(/#\/w\//);
  await expect.poll(() => page.evaluate(async () => (await (window as any).__amble.services.store.worlds.list()).length)).toBe(1);

  await gotoRoute(page, '#/settings/storage');
  await page.getByTestId('delete-everything').click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Type DELETE').fill('delete');
  // A destructive button, not the lantern (§3.1: --warn is for destructive actions).
  await expect(dialog.getByRole('button', { name: 'Delete everything' })).toHaveClass(/\bbtn--danger\b/);
  await dialog.getByRole('button', { name: 'Delete everything' }).click();
  await page.waitForURL(/#\/$/);
  await waitForApp(page);
  await expect.poll(() => page.evaluate(async () => (await (window as any).__amble.services.store.worlds.list()).length)).toBe(0);
});

test('Settings, the Teacher desk and every in-app page render', async ({ page }) => {
  await openAmble(page, { clean: true });
  for (const hash of ['#/settings/ai', '#/settings/sound', '#/settings/reading', '#/settings/drawing', '#/settings/keys', '#/settings/storage', '#/settings/about']) {
    await gotoRoute(page, hash);
    await expect(page.getByTestId('screen-settings'), hash).toBeVisible();
  }
  for (const hash of ['#/teacher/link', '#/teacher/assignments', '#/teacher/gallery', '#/teacher/help']) {
    await gotoRoute(page, hash);
    await expect(page.getByTestId('screen-teacher'), hash).toBeVisible();
  }
  for (const p of ['privacy', 'terms', 'ai', 'it', 'parents', 'accessibility', 'poster', 'sent', 'whatsnew']) {
    await gotoRoute(page, `#/${p}`);
    await expect(page.locator(`[data-page="${p}"]`), p).toBeVisible();
    await expect(page.locator(`[data-page="${p}"] h1`), p).toBeVisible();
  }
});
