/**
 * Touch at 1280x800 (§2.2, §6.8, §7.5, §10.2 `touch`): the game's on-screen controls appear with the first
 * touch and JUMP makes the hero jump; the Desk draws with a finger and pans with two.
 */
import type { Page } from '@playwright/test';
import { expect, gotoRoute, openAmble, test } from '../helpers/app';
import { deskReady, deskState, drawOnBoard, gameFrame, openStarter, readGame } from './journey';

test.use({ viewport: { width: 1280, height: 800 }, hasTouch: true });

/** Two fingers down on the page at `a` and `b`, moved together by (dx, dy), then lifted. */
async function twoFingerPan(page: Page, a: { x: number; y: number }, b: { x: number; y: number }, dx: number, dy: number): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  const points = (t: number) => [
    { x: a.x + dx * t, y: a.y + dy * t, id: 1, radiusX: 6, radiusY: 6, force: 0.5 },
    { x: b.x + dx * t, y: b.y + dy * t, id: 2, radiusX: 6, radiusY: 6, force: 0.5 },
  ];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: points(0) });
  for (let i = 1; i <= 12; i++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: points(i / 12) });
    await page.waitForTimeout(16);
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
}

test('touch: the controls appear on the first touch, JUMP jumps, and the Desk draws and pans by touch', async ({ page }) => {
  test.setTimeout(180_000);
  await openAmble(page, { clean: true });
  const id = await openStarter(page, 'moon-king');
  const frame = await gameFrame(page);
  const overlay = frame.locator('.amble-touch');
  await expect(overlay).not.toHaveClass(/\bon\b/);

  // The first touch starts the game and shows the controls.
  const slot = (await page.getByTestId('world-slot').boundingBox())!;
  await page.touchscreen.tap(slot.x + slot.width * 0.5, slot.y + 90);
  await expect(overlay).toHaveClass(/\bon\b/);
  await expect.poll(() => readGame(frame, (g) => g.state), { timeout: 20_000 }).toBe('running');

  // JUMP: the hero leaves the ground.
  const jump = frame.locator('.amble-touch .t-btn', { hasText: 'JUMP' });
  await expect(jump).toBeVisible();
  const heroY = () => readGame(frame, (g) => (g.find('hero') as { y?: number } | null)?.y ?? 0);
  await expect.poll(async () => {
    const a = await heroY();
    await page.waitForTimeout(300);
    return Math.abs((await heroY()) - a);
  }, { timeout: 15_000 }).toBeLessThan(1);
  const ground = await heroY();
  await jump.tap();
  await expect.poll(heroY, { timeout: 10_000 }).toBeLessThan(ground - 20);

  // The Desk: a finger draws; two fingers pan the sheet.
  await gotoRoute(page, `#/w/${id}/draw/grumble`);
  await deskReady(page);
  const board = page.getByTestId('desk-board');
  const inked = () => page.evaluate(() => (window as unknown as { __ambleDesk: { getSnapshot(): { inked: number } } }).__ambleDesk.getSnapshot().inked);
  const { w, h } = (await deskState(page)).board;
  await drawOnBoard(page, [[w * 0.35, h * 0.5], [w * 0.42, h * 0.55], [w * 0.5, h * 0.58], [w * 0.58, h * 0.55], [w * 0.65, h * 0.5]], 'touch');
  await expect.poll(inked, { timeout: 10_000 }).toBeGreaterThan(0);
  const view = () => page.evaluate(() => (window as unknown as { __ambleDesk: { surface: { view(): { panX: number; panY: number } } } }).__ambleDesk.surface.view());
  const before = await view();
  const box = (await board.boundingBox())!;
  const inkBefore = await inked();
  await twoFingerPan(page, { x: box.x + box.width * 0.4, y: box.y + box.height * 0.5 }, { x: box.x + box.width * 0.6, y: box.y + box.height * 0.5 }, 90, 60);
  await expect.poll(async () => {
    const v = await view();
    return Math.hypot(v.panX - before.panX, v.panY - before.panY);
  }).toBeGreaterThan(30);
  // Panning never draws.
  expect(await inked()).toBe(inkBefore);
});
