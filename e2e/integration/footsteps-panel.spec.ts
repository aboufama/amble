/**
 * Footsteps in a crowded notebook (§2.2, §2.9): in a 1366x657 tab, Change mode's Dials card and the Ask
 * field's scope chip make the notebook taller than the screen. The notebook scrolls (the page never does),
 * so nothing is cut off below the screen; the Footsteps panel keeps its newest step whole and never calls
 * its only step "1 more step".
 */
import { expect, test } from '../helpers/app';
import { openWorld } from '../world/world';

test.use({ viewport: { width: 1366, height: 657 } });

test('a crowded notebook scrolls; Footsteps keeps its only step whole, never "1 more step"', async ({ page }) => {
  await openWorld(page);
  await page.getByRole('radio', { name: 'Change' }).click();
  await expect(page.getByTestId('tune-card')).toBeVisible();
  await page.getByTestId('tag-moonKing').click();
  await expect(page.getByTestId('ask-card').getByText('About the Moon King')).toBeVisible();

  const notebook = page.locator('aside.notebook');
  expect(await notebook.evaluate((n) => n.scrollHeight > n.clientHeight)).toBe(true);
  expect(await page.evaluate(() => document.scrollingElement!.scrollHeight <= innerHeight)).toBe(true);
  await notebook.evaluate((n) => n.scrollTo(0, n.scrollHeight));
  const panel = (await page.locator('.panel.footsteps').boundingBox())!;
  expect(panel.y + panel.height).toBeLessThanOrEqual(657);

  const steps = page.locator('.footsteps__scroller .step');
  await expect(steps).toHaveCount(1);
  const sizes = await page.evaluate(() => ({
    list: document.querySelector('.footsteps__scroller')!.getBoundingClientRect().height,
    step: document.querySelector('.footsteps__scroller .step')!.getBoundingClientRect().height,
  }));
  test.info().annotations.push({ type: 'sizes', description: JSON.stringify(sizes) });
  expect(sizes.list).toBeGreaterThanOrEqual(sizes.step);
  await page.waitForTimeout(500);
  await expect(page.locator('.footsteps__more')).toHaveCount(0);
});
