/**
 * The shared components (tests/ui/gallery: every component in every state, on the page and on the top
 * bar) pass axe in Original and High contrast, with their dialog, sheet, menu and popover open, and keep
 * Scratch's shapes (LOOK-BRIEF.md): 4 px, 8 px or round corners only, and nothing tilted.
 */
import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { expect, test } from '../helpers/app';

const GALLERY = '/tests/ui/gallery/index.html';

async function axe(page: Page, where: string): Promise<string[]> {
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  return r.violations.map((v) => `${where} → ${v.id}: ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(' | ')}`);
}

for (const theme of ['original', 'contrast'] as const) {
  test(`every shared component passes axe in ${theme === 'original' ? 'the Original colours' : 'High contrast'}`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto(`${GALLERY}?theme=${theme}`);
    await expect(page.locator('.gallery')).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    const found = await axe(page, 'gallery');

    for (const [open, name] of [
      ['dialog', 'Put away the Moon King?'],
      ['sheet', 'Sounds'],
      ['sheet-right', 'Sounds'],
    ] as const) {
      await page.locator(`[data-open="${open}"]`).click();
      await expect(page.getByRole('dialog', { name })).toBeVisible();
      found.push(...(await axe(page, open)));
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog', { name })).toHaveCount(0);
    }
    await page.getByRole('button', { name: 'More', exact: true }).click();
    await expect(page.getByRole('menu', { name: 'More' })).toBeVisible();
    found.push(...(await axe(page, 'menu')));
    await page.keyboard.press('Escape');
    await page.locator('[data-open="popover"]').click();
    await expect(page.getByRole('dialog', { name: 'The Moon King' })).toBeVisible();
    found.push(...(await axe(page, 'popover')));
    await page.keyboard.press('Escape');
    expect(found).toEqual([]);
  });
}

test('the shared components keep 4 px, 8 px or round corners and nothing tilted', async ({ page }) => {
  await page.goto(GALLERY);
  await expect(page.locator('.gallery')).toBeVisible();
  const odd = await page.evaluate(() => {
    const bad: string[] = [];
    for (const el of document.querySelectorAll<HTMLElement>('.gallery *')) {
      if (el instanceof SVGElement) continue;
      const s = getComputedStyle(el);
      const name = `${el.tagName.toLowerCase()}.${[...el.classList].join('.')}`;
      for (const corner of [s.borderTopLeftRadius, s.borderTopRightRadius, s.borderBottomLeftRadius, s.borderBottomRightRadius]) {
        const px = parseFloat(corner);
        if (!(px === 0 || px === 4 || px === 8 || px >= 999 || corner.endsWith('%'))) bad.push(`${name}: radius ${corner}`);
      }
      if (s.rotate !== 'none' || /matrix\((?!1, 0, 0, 1)/.test(s.transform)) bad.push(`${name}: rotate ${s.rotate} transform ${s.transform}`);
      if (/gradient\(/.test(s.backgroundImage)) bad.push(`${name}: ${s.backgroundImage}`);
    }
    return bad;
  });
  expect(odd).toEqual([]);
});
