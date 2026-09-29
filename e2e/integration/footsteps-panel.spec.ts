/**
 * Footsteps in a short notebook (§2.9): Change mode's Dials card leaves the panel shorter than one step
 * plus the "more steps" button, and the only step it shows is not "1 more step".
 */
import { expect, test } from '../helpers/app';
import { openWorld } from '../world/world';

test.use({ viewport: { width: 1366, height: 657 } });

test('a short Footsteps panel never calls its only step "1 more step"', async ({ page }) => {
  await openWorld(page);
  await page.getByRole('radio', { name: 'Change' }).click();
  await expect(page.getByTestId('tune-card')).toBeVisible();
  const steps = page.locator('.footsteps__scroller .step');
  await expect(steps).toHaveCount(1);
  // The case in question: the list is shorter than one step and the button's 34 px band under it.
  const sizes = await page.evaluate(() => ({
    list: document.querySelector('.footsteps__scroller')!.getBoundingClientRect().height,
    step: document.querySelector('.footsteps__scroller .step')!.getBoundingClientRect().height,
  }));
  test.info().annotations.push({ type: 'sizes', description: JSON.stringify(sizes) });
  expect(sizes.list).toBeLessThan(sizes.step + 34);
  await page.waitForTimeout(500);
  await expect(page.locator('.footsteps__more')).toHaveCount(0);
});
