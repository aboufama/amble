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

  // Replacing the project and switching to 3D ask; Cancel keeps everything.
  await page.getByRole('button', { name: /File/ }).click();
  await page.getByRole('menuitem', { name: 'New 2D game' }).click();
  const replace = page.getByRole('dialog', { name: 'Replace Project' });
  await expect(replace).toBeVisible();
  await expect(replace.getByRole('button', { name: 'Replace' })).toHaveClass(/danger/);
  await replace.getByRole('button', { name: 'Cancel' }).click();
  await expect(amble).toBeVisible();

  await page.getByRole('radio', { name: '3D' }).click();
  const switchDialog = page.getByRole('dialog', { name: 'Switch to 3D' });
  await expect(switchDialog).toBeVisible();
  await switchDialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('radio', { name: '2D' })).toHaveAttribute('aria-checked', 'true');

  // Blockly's own "Delete all 7 blocks?" as well.
  await page.locator('.blocklyMainBackground').click({ button: 'right', position: { x: 520, y: 620 } });
  await page.locator('.blocklyContextMenu .blocklyMenuItem', { hasText: /Delete \d+ Blocks/ }).click();
  await expect(page.getByRole('dialog', { name: 'Delete Blocks' })).toContainText(/Delete all \d+ blocks\?/);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Delete Blocks' })).toBeHidden();

  expect(native).toEqual([]);
});
