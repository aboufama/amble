import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';

/**
 * Block dropdowns list the project's real choices (like Scratch), follow renames, and
 * keep the values old projects saved.
 */

interface TestWorkspace {
  getBlocksByType(type: string): Array<{ getField(name: string): { getSvgRoot(): SVGElement; getText(): string }; getFieldValue(name: string): string }>;
  getFlyout(): { getWorkspace(): TestWorkspace };
}

async function fieldValue(page: Page, type: string, field: string, palette = false): Promise<string | null> {
  return page.evaluate(
    ({ type, field, palette }) => {
      const main = (window as unknown as { __ambleWorkspace: TestWorkspace }).__ambleWorkspace;
      const w = palette ? main.getFlyout().getWorkspace() : main;
      return w.getBlocksByType(type)[0]?.getFieldValue(field) ?? null;
    },
    { type, field, palette },
  );
}

/** Opens a block's dropdown on the code area and returns its options. */
async function openMenu(page: Page, type: string, field: string): Promise<string[]> {
  const at = await page.evaluate(
    ({ type, field }) => {
      const main = (window as unknown as { __ambleWorkspace: TestWorkspace }).__ambleWorkspace;
      const r = main.getBlocksByType(type)[0].getField(field).getSvgRoot().getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    },
    { type, field },
  );
  await page.mouse.click(at.x, at.y);
  const items = page.locator('.blocklyDropDownDiv .blocklyMenuItem');
  await expect(items.first()).toBeVisible();
  return (await items.allTextContents()).map((t) => t.trim());
}

async function rename(page: Page, tab: 'Costumes' | 'Sounds', from: string, to: string) {
  await page.getByRole('tab', { name: tab }).click();
  await page.locator('.asset-tile', { hasText: from }).click();
  const input = page.getByLabel(tab === 'Sounds' ? 'Sound name' : 'Costume name');
  await input.fill(to);
  await input.press('Enter');
  await page.getByRole('tab', { name: 'Code' }).first().click();
}

test('dropdowns list keys, sounds and costumes, and follow renames', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.blocklyMainBackground')).toBeVisible();

  // "when [space] key pressed": Scratch's keys.
  const keys = await openMenu(page, 'ev_key', 'KEY');
  expect(keys.slice(0, 6)).toEqual(['space', 'up arrow', 'down arrow', 'right arrow', 'left arrow', 'any']);
  expect(keys).toEqual(expect.arrayContaining(['a', 'z', '0', '9']));
  await page.keyboard.press('Escape');

  // "start sound [jump]": Amble's own sounds.
  expect(await openMenu(page, 'so_play', 'SOUND')).toEqual(['pop', 'jump']);
  await page.locator('.blocklyDropDownDiv .blocklyMenuItem', { hasText: 'pop' }).click();
  expect(await fieldValue(page, 'so_play', 'SOUND')).toBe('pop');

  // Renaming a sound renames it in the blocks that use it.
  await rename(page, 'Sounds', 'pop', 'boing');
  expect(await fieldValue(page, 'so_play', 'SOUND')).toBe('boing');
  expect(await openMenu(page, 'so_play', 'SOUND')).toEqual(['boing', 'jump']);
  await page.keyboard.press('Escape');

  // The palette's "switch costume to" offers the sprite's costumes (the second one first, like Scratch).
  expect(await fieldValue(page, 'lo_costume', 'COSTUME', true)).toBe('amble-b');
  await rename(page, 'Costumes', 'amble-b', 'walking');
  await expect.poll(() => fieldValue(page, 'lo_costume', 'COSTUME', true)).toBe('walking');
});

test('projects saved before dropdowns keep their values', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.blocklyMainBackground')).toBeVisible();

  // Save the starter project, then make it look like an old one: free-text values, no declared variables.
  await page.getByRole('button', { name: /File/ }).click();
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('menuitem', { name: 'Save to your computer' }).click()]);
  const project = JSON.parse(await readFile((await download.path())!, 'utf8'));
  delete project.variables;
  for (const s of project.sprites) delete s.variables;
  project.sprites[0].blocks.blocks.blocks.push(
    { type: 'lo_costume', id: 'old1', x: 420, y: 60, fields: { COSTUME: 'the happy one' } },
    { type: 'va_set', id: 'old2', x: 420, y: 160, fields: { VARIABLE: 'lives', VALUE: '3' } },
  );

  page.on('dialog', (d) => void d.accept());
  await page.getByRole('button', { name: /File/ }).click();
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('menuitem', { name: 'Load from your computer' }).click()]);
  await chooser.setFiles({ name: 'old.amble', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(project)) });

  // The old value stays on the block; the menu lists the sprite's real costumes.
  await expect.poll(() => fieldValue(page, 'lo_costume', 'COSTUME')).toBe('the happy one');
  expect(await openMenu(page, 'lo_costume', 'COSTUME')).toEqual(['amble-a', 'amble-b']);
  await page.locator('.blocklyDropDownDiv .blocklyMenuItem', { hasText: 'amble-a' }).click();
  expect(await fieldValue(page, 'lo_costume', 'COSTUME')).toBe('amble-a');

  // Variables of old projects come from the blocks that use them.
  const vars = await openMenu(page, 'va_set', 'VARIABLE');
  expect(vars).toEqual(['lives', 'Rename variable', 'Delete the "lives" variable']);
});
