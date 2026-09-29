/**
 * The production build on its sub-path (§6.2, §10.2 `prod @prod`): after `npm run build`, served by
 * `vite preview --base /amble/`, Amble loads from /amble/ under its Content Security Policy (with
 * frame-src 'self', so a game can't leave for another site, and no-referrer), no policy is ever violated
 * (in the page or in the game frames), the test hooks are gone, a starter plays with all its drawings, and
 * the service worker installs. Runs in the `prod` project (`--project prod` or E2E_PROD=1).
 */
import { expect, test } from '../helpers/app';

test('the build loads from its sub-path under its CSP, plays a starter and installs its worker @prod', async ({ page, guards }, info) => {
  test.skip(info.project.name !== 'prod', 'Build only: the dev server serves no CSP.');
  test.setTimeout(180_000);
  const violations: string[] = [];
  page.on('console', (m) => {
    if (/Content Security Policy|Refused to/i.test(m.text())) violations.push(m.text());
  });
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (e) => console.error(`Refused to (CSP ${e.violatedDirective}): ${e.blockedURI}`));
  });
  await page.goto('./');
  await expect(page.locator('[data-testid^="screen-"]').first()).toBeVisible();
  expect(new URL(page.url()).pathname).toBe('/amble/');

  const csp = (await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content')) ?? '';
  for (const rule of ["default-src 'self'", "frame-src 'self'", "object-src 'none'", "base-uri 'self'"]) expect(csp).toContain(rule);
  expect(csp).not.toMatch(/script-src[^;]*'unsafe-eval'/);
  await expect(page.locator('meta[name="referrer"]')).toHaveAttribute('content', 'no-referrer');
  expect(await page.evaluate(() => ['__amble', '__ambleDesk'].filter((k) => k in window))).toEqual([]);

  // A starter plays, its drawings coming from the sub-path.
  await page.evaluate(() => {
    location.hash = '#/starter/moon-king';
  });
  await expect(page).toHaveURL(/#\/w\/[A-Za-z0-9_-]+$/);
  await expect(page.getByTestId('player-layer')).toHaveAttribute('data-first-frame', /^[1-9]\d*$/, { timeout: 60_000 });
  await expect(page.getByTestId('cast-card-moonKing')).toHaveAttribute('data-status', 'drawn');
  expect(guards.egress.requests.filter((r) => /\/starters\//.test(r.url)).every((r) => new URL(r.url).pathname.startsWith('/amble/starters/'))).toBe(true);

  // The service worker takes over the page on its first install.
  await page.waitForFunction(async () => (await navigator.serviceWorker.getRegistration())?.active?.state === 'activated', null, { timeout: 60_000 });
  expect(await page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.scope)).toMatch(/\/amble\/$/);

  // Walk a few screens so their chunks load under the policy too.
  for (const hash of ['#/trail', '#/settings', '#/teacher/link', '#/privacy']) {
    await page.evaluate((h) => {
      location.hash = h;
    }, hash);
    await expect(page.locator('[data-testid^="screen-"]').first()).toBeVisible();
  }
  expect(violations).toEqual([]);
});
