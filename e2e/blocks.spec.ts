import { expect, test, type Page } from '@playwright/test';

/**
 * Amble's own blocks in the editor: characters you drag into slots, variables and skills
 * that appear in the palette once made.
 */

interface TestBlock {
  type: string;
  id: string;
  getFieldValue(name: string): string;
  getInput(name: string): { connection: { targetBlock(): TestBlock | null } } | null;
  getSvgRoot(): SVGElement;
  isShadow(): boolean;
}
interface TestWorkspace {
  getBlocksByType(type: string): TestBlock[];
  getAllBlocks(ordered: boolean): TestBlock[];
  getFlyout(): { getWorkspace(): TestWorkspace };
}

/** Where a block is on screen: in the palette or in the code area. */
async function blockCenter(page: Page, where: 'palette' | 'code', find: { type: string; field?: string; value?: string; id?: string }) {
  return page.evaluate(
    ({ where, find }) => {
      const main = (window as unknown as { __ambleWorkspace: TestWorkspace }).__ambleWorkspace;
      const ws = where === 'palette' ? main.getFlyout().getWorkspace() : main;
      const block = ws
        .getAllBlocks(false)
        .find((b) => b.type === find.type && (!find.id || b.id === find.id) && (!find.field || b.getFieldValue(find.field) === find.value));
      if (!block) return null;
      const r = block.getSvgRoot().getBoundingClientRect();
      return { x: r.x + Math.min(20, r.width / 2), y: r.y + Math.min(14, r.height / 2), id: block.id };
    },
    { where, find },
  );
}

async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 10, from.y + 10, { steps: 4 });
  await page.mouse.move(to.x, to.y, { steps: 12 });
  await page.mouse.up();
}

/** Opens a category and waits for the palette to finish scrolling to it. */
async function openCategory(page: Page, name: string) {
  // The palette refreshes shortly after the project changes; that would stop the scrolling.
  await page.waitForTimeout(400);
  await page.locator('.blocklyToolboxCategory', { hasText: name }).click();
  const state = () =>
    page.evaluate(() => {
      const flyout = (window as unknown as { __ambleWorkspace: { getFlyout(): { scrollTarget?: number; getWorkspace(): { scrollY: number } } } }).__ambleWorkspace.getFlyout();
      return { animating: flyout.scrollTarget !== undefined, y: flyout.getWorkspace().scrollY };
    });
  let last = NaN;
  for (let i = 0; i < 50; i++) {
    await page.waitForTimeout(100);
    const now = await state();
    if (!now.animating && now.y === last) return;
    last = now.y;
  }
}

test('drag a character into "go to ( )"', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.blocklyMainBackground')).toBeVisible();
  // A second sprite to point at.
  await page.locator('.sprite-tile').first().click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'duplicate' }).click();
  await expect(page.locator('.sprite-tile')).toHaveCount(2);
  await page.locator('.sprite-tile', { hasText: /^Amble$/ }).first().click();

  // "go to ( )" from the palette into the code area.
  await openCategory(page, 'Motion');
  const goTo = (await blockCenter(page, 'palette', { type: 'mv_goto' }))!;
  await drag(page, goTo, { x: 700, y: 700 });
  const placed = await page.evaluate(() => {
    const ws = (window as unknown as { __ambleWorkspace: TestWorkspace }).__ambleWorkspace;
    const b = ws.getBlocksByType('mv_goto')[0];
    return { id: b.id, who: b.getInput('WHO')!.connection.targetBlock()!.getFieldValue('NAME') };
  });
  expect(placed.who).toBe('random');

  // The palette has a block for each character, with its picture.
  await openCategory(page, 'Characters');
  const amble2 = (await blockCenter(page, 'palette', { type: 'char_ref', field: 'NAME', value: 'Amble2' }))!;
  expect(amble2).not.toBeNull();
  await expect(page.locator('.blocklyFlyout image[href^="data:image/svg+xml"]').first()).toBeAttached();

  // Drop it on the slot.
  const slot = await page.evaluate((id) => {
    const ws = (window as unknown as { __ambleWorkspace: TestWorkspace }).__ambleWorkspace;
    const b = ws.getAllBlocks(false).find((x) => x.id === id)!;
    const r = b.getInput('WHO')!.connection.targetBlock()!.getSvgRoot().getBoundingClientRect();
    return { x: r.x + 6, y: r.y + r.height / 2 };
  }, placed.id);
  await drag(page, amble2, slot);
  await expect
    .poll(() =>
      page.evaluate((id) => {
        const ws = (window as unknown as { __ambleWorkspace: TestWorkspace }).__ambleWorkspace;
        const target = ws.getAllBlocks(false).find((x) => x.id === id)!.getInput('WHO')!.connection.targetBlock();
        return target && !target.isShadow() ? `${target.type}:${target.getFieldValue('NAME')}` : null;
      }, placed.id),
    )
    .toBe('char_ref:Amble2');

  // Renaming the sprite renames it on the block.
  await page.locator('.sprite-tile', { hasText: 'Amble2' }).click();
  const name = page.getByLabel('Sprite name');
  await name.fill('Fox');
  await name.press('Enter');
  await page.locator('.sprite-tile', { hasText: /^Amble$/ }).first().click();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const ws = (window as unknown as { __ambleWorkspace: TestWorkspace }).__ambleWorkspace;
        return ws.getBlocksByType('char_ref').map((b) => b.getFieldValue('NAME'));
      }),
    )
    .toEqual(['Fox']);
});

test('variables and skills appear in the palette once made', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.blocklyMainBackground')).toBeVisible();

  await openCategory(page, 'Memory');
  await page.locator('.blocklyFlyoutButton', { hasText: 'Make a Variable' }).click();
  const dialog = page.getByRole('dialog', { name: 'New Variable' });
  await dialog.getByRole('textbox').fill('lives');
  await dialog.getByRole('button', { name: 'OK' }).click();
  await expect.poll(async () => (await blockCenter(page, 'palette', { type: 'mem_var', field: 'VARIABLE', value: 'lives' })) !== null).toBe(true);

  await openCategory(page, 'Skills');
  await page.locator('.blocklyFlyoutButton', { hasText: 'Make a Skill' }).click();
  const skill = page.getByRole('dialog', { name: 'Make a Skill' });
  await skill.getByRole('textbox').fill('hop');
  await skill.getByRole('button', { name: 'OK' }).click();
  await expect.poll(async () => (await blockCenter(page, 'code', { type: 'pr_define', field: 'NAME', value: 'hop' })) !== null).toBe(true);
  await expect.poll(async () => (await blockCenter(page, 'palette', { type: 'pr_call', field: 'NAME', value: 'hop' })) !== null).toBe(true);
});
