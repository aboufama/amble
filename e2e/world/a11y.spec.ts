/**
 * The world screen's accessibility (§3.9): no WCAG 2.1 A/AA problems in Play, in Change mode with a thing
 * card open, or in the sheets; F6 reaches the Cast; the cast cards say what they are.
 */
import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { expect, test } from '../helpers/app';
import { openWorld } from './world';

async function axe(page: Page): Promise<string[]> {
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).exclude('iframe').analyze();
  return r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(' | ')}`);
}

test.describe('the world screen is accessible', () => {
  test('in Play, in Change mode with a card open, and in World info', async ({ page }) => {
    await openWorld(page);
    expect(await axe(page)).toEqual([]);

    await page.getByRole('radio', { name: 'Change' }).click();
    await page.getByTestId('tag-boss').click();
    await expect(page.getByTestId('thing-card')).toBeVisible();
    expect(await axe(page)).toEqual([]);
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');

    await page.getByRole('button', { name: 'More for this world' }).click();
    await page.getByRole('menuitem', { name: 'World info' }).click();
    await expect(page.getByRole('dialog', { name: 'World info' })).toBeVisible();
    expect(await axe(page)).toEqual([]);
  });

  test('F6 reaches the Cast, and its cards are a list of buttons', async ({ page }) => {
    await openWorld(page);
    await page.locator('body').focus();
    for (let i = 0; i < 4; i++) {
      await page.keyboard.press('F6');
      if (await page.evaluate(() => !!document.activeElement?.closest('[data-region="cast"]'))) break;
    }
    expect(await page.evaluate(() => !!document.activeElement?.closest('[data-region="cast"]'))).toBe(true);
    const list = page.getByRole('list', { name: 'Cast: the drawings this world needs' });
    await expect(list.getByRole('button', { name: /Moon King, Boss, not drawn yet\. Press Enter to draw\./ })).toBeVisible();
  });
});
