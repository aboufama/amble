import { expect, test } from '@playwright/test';

/** Every question the editor asks uses Amble's own Scratch-style dialog, never the browser's. */
test("confirmations use Amble's dialog, never the browser's", async ({ page }) => {
  const native: string[] = [];
  page.on('dialog', (d) => {
    native.push(`${d.type()}: ${d.message()}`);
    void d.dismiss();
  });
  await page.goto('/');
  const amble = page.locator('.sprite-tile', { hasText: 'Amble' });
  await expect(amble).toBeVisible();

  // Deleting a sprite asks first; Esc keeps it.
  await amble.locator('.delete-button').click();
  const deleteDialog = page.getByRole('dialog', { name: 'Delete Sprite' });
  await expect(deleteDialog).toBeVisible();
  await expect(deleteDialog).toContainText('Delete the sprite "Amble"?');
  await expect(deleteDialog.getByRole('button', { name: 'Delete' })).toHaveClass(/danger/);
  await page.keyboard.press('Escape');
  await expect(deleteDialog).toBeHidden();
  await expect(amble).toBeVisible();

  // Enter deletes it; Edit > Restore Sprite brings it back.
  await amble.locator('.delete-button').click();
  await expect(deleteDialog).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.locator('.sprite-tile')).toHaveCount(0);
  await page.getByRole('button', { name: /Edit/ }).click();
  await page.getByRole('menuitem', { name: 'Restore Sprite' }).click();
  await expect(amble).toBeVisible();

  // The right-click menu's delete asks too.
  await amble.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'delete' }).click();
  await expect(deleteDialog).toBeVisible();
  await deleteDialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(amble).toBeVisible();

  // Replacing the project asks; Cancel keeps everything.
  await page.getByRole('button', { name: /File/ }).click();
  await page.getByRole('menuitem', { name: 'New game' }).click();
  const replace = page.getByRole('dialog', { name: 'Replace Project' });
  await expect(replace).toBeVisible();
  await expect(replace.getByRole('button', { name: 'Replace' })).toHaveClass(/danger/);
  await replace.getByRole('button', { name: 'Cancel' }).click();
  await expect(amble).toBeVisible();

  // Blockly's own "Delete all 7 blocks?" as well.
  await page.locator('.blocklyMainBackground').click({ button: 'right', position: { x: 520, y: 620 } });
  await page.locator('.blocklyContextMenu .blocklyMenuItem', { hasText: /Delete \d+ Blocks/ }).click();
  await expect(page.getByRole('dialog', { name: 'Delete Blocks' })).toContainText(/Delete all \d+ blocks\?/);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Delete Blocks' })).toBeHidden();

  expect(native).toEqual([]);
});

/** Settings starts with the account, in plain words; models and machinery wait under Advanced. */
test('Settings shows the account first and keeps the rest under Advanced', async ({ page }) => {
  // A computer without Codex: signing in can't work, so the account is an API key.
  await page.route('**/api/codex/status', (route) =>
    route.fulfill({ json: { installed: false, version: null, auth: 'none', login: { pending: false, url: null, error: null } } }),
  );
  await page.goto('/');
  await expect(page.locator('.blocklyMainBackground')).toBeVisible();

  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const settings = page.getByRole('dialog', { name: 'Settings' });
  await expect(settings.getByRole('heading', { level: 3 }).first()).toHaveText('Account');
  await expect(settings).toContainText('A key lets Amble build blocks written in your own words.');
  await settings.getByLabel('API key').fill('sk-test');

  // Model names and terminal commands only show once Advanced is opened.
  const model = settings.getByLabel(/^Model/);
  const install = settings.locator('code', { hasText: 'npm install -g @openai/codex' });
  await expect(model).toBeHidden();
  await expect(install).toBeHidden();
  await settings.locator('summary', { hasText: 'Advanced' }).click();
  await expect(model).toHaveValue('gpt-5');
  await expect(install).toBeVisible();
  await expect(settings.getByRole('button', { name: 'Test connection' })).toBeVisible();
  // Nor does the menu bar offer to sign in.
  await expect(page.locator('.menubar-account button')).toHaveCount(0);

  // Every setting still saves.
  await model.fill('gpt-5-mini');
  await settings.getByLabel(/^API base URL/).fill('https://example.test/v1');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('amble:settings') ?? '{}'))).toMatchObject({
    apiKey: 'sk-test',
    model: 'gpt-5-mini',
    baseUrl: 'https://example.test/v1',
  });
});
