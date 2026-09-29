/**
 * The production build (§8.3 step 2, §10.2 `prod @prod`): served from a sub-path (`/amble/`), it loads
 * under its Content Security Policy with `no-referrer`, violates nothing, and makes no outside request.
 * Runs in the `prod` project (`E2E_PROD=1` or `--project prod`); the dev server has no CSP, so `dev` skips it.
 */
import { expect, test } from '../helpers/app';

test('the build loads from a sub-path under its CSP @prod', async ({ page }, info) => {
  test.skip(info.project.name !== 'prod', 'Build only: the dev server serves no CSP.');
  const violations: string[] = [];
  page.on('console', (m) => {
    if (/Content Security Policy|Refused to/i.test(m.text())) violations.push(m.text());
  });
  await page.goto('./');
  await expect(page.locator('[data-testid^="screen-"]').first()).toBeVisible();
  expect(new URL(page.url()).pathname).toBe('/amble/');
  const csp = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content');
  expect(csp).toContain("default-src 'self'");
  expect(csp).toContain("frame-src 'self'");
  expect(csp).toContain("object-src 'none'");
  await expect(page.locator('meta[name="referrer"]')).toHaveAttribute('content', 'no-referrer');
  // No test hook in production builds.
  expect(await page.evaluate(() => 'undefined' !== typeof (window as unknown as { __amble?: unknown }).__amble)).toBe(false);
  await page.evaluate(() => {
    location.hash = '#/trail';
  });
  await expect(page.getByTestId('screen-trail')).toBeVisible();
  // A starter plays: the built runtime loads from the sub-path and its bootstrap passes the CSP by hash.
  await page.evaluate(() => {
    location.hash = '#/starter/moon-king';
  });
  await expect(page.getByTestId('screen-world')).toBeVisible();
  await expect(page.getByTestId('player-layer')).toHaveAttribute('data-first-frame', /^[1-9]\d*$/, { timeout: 45_000 });
  expect(violations).toEqual([]);
});
