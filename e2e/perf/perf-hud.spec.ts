/**
 * The Desk's hidden timings (§7.8): `?perf=1` shows input to pixels and the work per frame after each
 * stroke, as data attributes too (the performance checks read them on a production build). Without it,
 * nothing shows.
 */
import { circle, drawOnBoard, openDesk, settle } from '../draw/desk';
import { expect, test, waitForApp } from '../helpers/app';

test('?perf=1 shows the Desk timings after a stroke, and nothing shows without it', async ({ page }) => {
  await page.goto('./?perf=1');
  await waitForApp(page);
  await openDesk(page, '#/draw/new');
  const hud = page.getByTestId('perf-hud');
  await expect(hud).toBeVisible();
  await drawOnBoard(page, circle(300, 300, 120));
  await settle(page);
  await expect(hud).not.toHaveAttribute('data-latency-n', '0');
  const n = Number(await hud.getAttribute('data-latency-n'));
  const p95 = Number(await hud.getAttribute('data-latency-p95'));
  expect(n).toBeGreaterThan(10);
  expect(p95).toBeGreaterThan(0);
  expect(Number(await hud.getAttribute('data-work-p95'))).toBeGreaterThan(0);

  await page.goto('./');
  await waitForApp(page);
  await openDesk(page, '#/draw/new');
  await expect(page.getByTestId('perf-hud')).toHaveCount(0);
});
