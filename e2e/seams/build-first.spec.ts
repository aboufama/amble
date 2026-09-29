/**
 * Build it first (§2.5): the world opens in its Warm-up while Amble builds, and when the build is accepted
 * the student, still in the world, gets the real game: at once, or "New version ready" at the next pause
 * (§2.6), never the Warm-up forever.
 */
import { expect, gotoRoute, openAmble, test } from '../helpers/app';
import { mockAi } from '../helpers/mockAi';
import { worldReady } from '../journeys/journey';

test('a build that lands while the student is in the world replaces its Warm-up', async ({ page }) => {
  test.setTimeout(420_000);
  await mockAi(page, { plan: 'plan-snail.json', patches: ['build-moon-king.patch'], chunkDelayMs: 20 });
  await openAmble(page, { ai: 'mock', clean: true, prefs: { seen: { aiExplainer: Date.now() } } });
  await page.evaluate(() => {
    // What the player is asked to run from here on (the first line of each game.js).
    const w = window as unknown as { __amble: { services: { player: { load(i: unknown): Promise<unknown> } } }; __loads: string[] };
    const p = w.__amble.services.player;
    const load = p.load.bind(p);
    w.__loads = [];
    p.load = (init: unknown) => {
      const game = (init as { files: Array<{ name: string; source: string }> }).files.find((f) => f.name === 'game.js');
      w.__loads.push(game?.source.split('\n')[0] ?? '');
      return load(init);
    };
  });

  await gotoRoute(page, '#/new?idea=1');
  await page.getByTestId('idea-field').fill('a snail who rescues her friends from a grumpy salt king');
  await page.getByTestId('idea-go').click();
  await expect(page.getByTestId('plan-card')).toBeVisible({ timeout: 90_000 });
  await page.getByTestId('plan-build').click();
  await expect(page).toHaveURL(/#\/w\/w_[A-Za-z0-9_-]+$/);
  await worldReady(page);

  // The build lands while the student stays in the world (tested, or on the ladder when it can't be).
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __amble: { getState(): { ai: { lastOutcome: { kind: string } | null } } } }).__amble.getState().ai.lastOutcome?.kind ?? null), { timeout: 240_000 })
    .toMatch(/^(accepted|fallback)$/);
  // The real game comes: loaded at once, or offered as a new version that loads when played.
  const offer = page.getByTestId('new-version');
  await expect
    .poll(
      async () => {
        if (await offer.isVisible().catch(() => false)) return 'offered';
        const loads = await page.evaluate(() => (window as unknown as { __loads: string[] }).__loads);
        return loads.some((l) => l.includes('MOON KING')) ? 'loaded' : 'warm-up';
      },
      { timeout: 60_000 },
    )
    .not.toBe('warm-up');
});
