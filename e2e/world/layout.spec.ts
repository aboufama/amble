/**
 * The world at the four sizes (§2.2): 1366x768 (full), 1366x657 (a Chrome tab), 1280x800 (touch) and
 * 1280x600 (small): the page never scrolls, and the world view, Play | Change and the Cast are on screen.
 */
import { expect, test } from '../helpers/app';
import { openWorld } from './world';

const SIZES = [
  { name: '1366x768 full', width: 1366, height: 768, touch: false, view: { x: 20, y: 66, width: 880, height: 495 } },
  { name: '1366x657 tab', width: 1366, height: 657, touch: false, view: { x: 20, y: 66, width: 777, height: 437 } },
  { name: '1280x800 touch', width: 1280, height: 800, touch: true, view: { x: 16, y: 66, width: 792, height: 446 } },
  { name: '1280x600 small', width: 1280, height: 600, touch: false, view: null },
] as const;

for (const size of SIZES) {
  test.describe(size.name, () => {
    test.use({ viewport: { width: size.width, height: size.height }, hasTouch: size.touch });

    test('fits without page scroll, with the game, Play | Change and the Cast on screen', async ({ page }) => {
      await openWorld(page);
      expect(await page.evaluate(() => document.scrollingElement!.scrollHeight <= innerHeight && document.scrollingElement!.scrollWidth <= innerWidth)).toBe(true);
      const view = (await page.getByTestId('world-slot').boundingBox())!;
      if (size.view) {
        expect(Math.abs(view.x - size.view.x)).toBeLessThanOrEqual(1);
        expect(Math.abs(view.y - size.view.y)).toBeLessThanOrEqual(1);
        expect(Math.abs(view.width - size.view.width)).toBeLessThanOrEqual(1.5);
        expect(Math.abs(view.height - size.view.height)).toBeLessThanOrEqual(1.5);
      }
      expect(view.y + view.height).toBeLessThanOrEqual(size.height);
      for (const el of [page.getByRole('radio', { name: 'Play' }), page.getByRole('radio', { name: 'Change' }), page.getByTestId('cast-line')]) {
        const b = (await el.boundingBox())!;
        expect(b.y + b.height).toBeLessThanOrEqual(size.height + 12);
        expect(b.x + b.width).toBeLessThanOrEqual(size.width);
      }
      if (size.width >= 1280 && size.height >= 620) await expect(page.getByTestId('ask-card')).toBeVisible();
      else await expect(page.getByTestId('world-drawer-open')).toBeVisible();
    });
  });
}
