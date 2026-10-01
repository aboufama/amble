import { expect, test } from '@playwright/test';

/**
 * Like Scratch, the whole editor fits common laptop windows without page scrolling, and a long
 * sprite list scrolls inside its own area, with the stage selector and add buttons in view.
 */

const SIZES: Array<[number, number]> = [
  [1280, 720],
  [1366, 768],
  [1440, 800],
  [1440, 900],
];

for (const [width, height] of SIZES) {
  test(`fits a ${width}x${height} window with 12 sprites`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.goto('/');
    await expect(page.locator('.sprite-tile')).toHaveCount(1);
    for (let i = 0; i < 11; i++) {
      await page.locator('.sprite-tile').first().click({ button: 'right' });
      await page.getByRole('menuitem', { name: 'duplicate' }).click();
    }
    await expect(page.locator('.sprite-tile')).toHaveCount(12);

    const layout = await page.evaluate(() => {
      const box = (selector: string) => {
        const r = document.querySelector(selector)!.getBoundingClientRect();
        return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, height: r.height };
      };
      const list = document.querySelector<HTMLElement>('.sprite-scroll')!;
      return {
        scrollWidth: document.documentElement.scrollWidth,
        scrollHeight: document.documentElement.scrollHeight,
        body: box('.gui-body'),
        stageSelector: box('.stage-selector'),
        addSprite: box('.add-sprite .action-main-button'),
        addBackdrop: box('.add-backdrop .action-main-button'),
        list: box('.sprite-scroll'),
        listScrolls: getComputedStyle(list).overflowY,
      };
    });
    // No page scrolling: everything is laid out inside the window.
    expect(layout.scrollWidth).toBeLessThanOrEqual(width);
    expect(layout.scrollHeight).toBeLessThanOrEqual(height);
    expect(layout.body.bottom).toBeLessThanOrEqual(height);
    for (const b of [layout.stageSelector, layout.addSprite, layout.addBackdrop, layout.list]) {
      expect(b.top).toBeGreaterThanOrEqual(0);
      expect(b.bottom).toBeLessThanOrEqual(height);
      expect(b.right).toBeLessThanOrEqual(width);
    }
    // At least a row of sprites shows, and the list scrolls to the last one.
    expect(layout.list.height).toBeGreaterThanOrEqual(100);
    expect(layout.listScrolls).toBe('auto');
    await page.locator('.sprite-scroll').evaluate((el) => (el.scrollTop = el.scrollHeight));
    const last = page.locator('.sprite-tile').last();
    await expect(last).toBeInViewport();
    const lastBox = (await last.boundingBox())!;
    expect(lastBox.y + lastBox.height).toBeLessThanOrEqual(layout.list.bottom + 1);
    // The last sprite can be selected there (the add button doesn't cover it).
    await last.click({ position: { x: 10, y: 10 } });
    await expect(last).toHaveClass(/selected/);
  });
}

test('the scripts stay where they were after visiting the Costumes and Sounds tabs', async ({ page }) => {
  await page.goto('/');
  const firstScript = page.locator('svg.blocklySvg .blocklyBlockCanvas > g').first();
  /** Where the first script sits once the code area has stopped moving. */
  const settled = async () => {
    let last = '';
    for (;;) {
      const box = (await firstScript.boundingBox())!;
      const at = `${Math.round(box.x)},${Math.round(box.y)}`;
      if (at === last) return box;
      last = at;
      await page.waitForTimeout(300);
    }
  };
  await expect(firstScript).toBeVisible();
  const before = await settled();
  await page.getByRole('tab', { name: /Costumes/ }).click();
  await expect(page.getByLabel('Costume name')).toBeVisible();
  await page.getByRole('tab', { name: /Sounds/ }).click();
  await expect(page.getByLabel('Sound name')).toBeVisible();
  await page.getByRole('tab', { name: /Code/ }).click();
  await expect(firstScript).toBeVisible();
  const after = await settled();
  expect(Math.abs(after.x - before.x)).toBeLessThan(1);
  expect(Math.abs(after.y - before.y)).toBeLessThan(1);
});
