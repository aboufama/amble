/**
 * Reduced motion (§3.6, §6.10, §10.2 `motion`): with the system asking for reduced motion, nothing on the
 * Trail keeps animating after a second, games get `reducedMotion` (the kit's `fx.motion` is 0.25), and a
 * game that asks for a 10 Hz strobe gets at most 2 flashes in any second.
 */
import { expect, gotoRoute, openAmble, test } from '../helpers/app';
import { firstFrames, gameFrame, openStarter, startGame, worldReady } from './journey';

test.use({ reducedMotion: 'reduce' });

const STROBE = `// Asks for a flash every frame (the flash limiter keeps it safe).
class Game extends Amble.Scene {
  static config = { physics: 'none', background: '#000000' };
  create() { this.add.text(480, 270, 'STROBE', { fontSize: '48px', color: '#888888' }).setOrigin(0.5); }
  update() { this.cameras.main.flash(40, 255, 255, 255, true); this.fx.flash(0xffffff, 60, 1); }
}
`;

test('reduced motion: a still Trail, calm games and at most 2 flashes a second', async ({ page }) => {
  test.setTimeout(180_000);
  await openAmble(page, { clean: true, route: '#/trail' });
  await expect(page.getByTestId('screen-trail')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.dataset.motion ?? matchMedia('(prefers-reduced-motion: reduce)').matches)).toBeTruthy();
  // After a second, nothing keeps animating: an animation counts only if it is still running half a
  // second later (a one-shot entrance that a busy main thread started late is not motion that goes on).
  await page.waitForTimeout(1000);
  const running = await page.evaluate(async () => {
    const frames = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    await frames();
    const first = new Set(document.getAnimations().filter((a) => a.playState === 'running'));
    await new Promise((r) => setTimeout(r, 500));
    await frames();
    return document
      .getAnimations()
      .filter((a) => a.playState === 'running' && first.has(a))
      .map((a) => `${(a as CSSAnimation).animationName ?? (a as CSSTransition).transitionProperty ?? 'animation'} on ${((a.effect as KeyframeEffect | null)?.target as Element | null)?.className ?? '?'}`);
  });
  expect(running).toEqual([]);

  // A starter: the game is told, and its effects move a quarter as much.
  await openStarter(page, 'moon-king');
  const frame = await gameFrame(page);
  expect(await frame.evaluate(() => (window as unknown as { __ambleGame: { prefs(): { reducedMotion: boolean } } }).__ambleGame.prefs().reducedMotion)).toBe(true);
  expect(await frame.evaluate(() => (window as unknown as { __ambleGame: { scene: { fx?: { motion: number } } | null } }).__ambleGame.scene?.fx?.motion)).toBe(0.25);

  // A game asking for a flash every frame gets at most 2 in any second.
  const id = await page.evaluate(async (code) => {
    const a = (window as unknown as { __amble: { services: { starters: { open(id: string, o: { withArt: boolean }): Promise<{ world: Record<string, unknown> & { id: string } }> }; store: { commit(c: unknown): Promise<void> } } } }).__amble;
    const { world } = await a.services.starters.open('moon-king', { withArt: false });
    const w = { ...world, title: 'Strobe', code: [{ path: 'game.js', source: code, authors: [['student', code.split('\n').length]], locked: [] }], cast: {} };
    await a.services.store.commit({ worlds: [w] });
    return w.id;
  }, STROBE);
  const before = await firstFrames(page);
  await gotoRoute(page, `#/w/${id}`);
  await worldReady(page, before);
  const strobe = await gameFrame(page);
  await startGame(page, strobe);
  await page.waitForTimeout(3000);
  const flashes = await strobe.evaluate(() => (window as unknown as { __ambleGame: { flashes(): number[] } }).__ambleGame.flashes());
  expect(flashes.length).toBeGreaterThan(0);
  const worst = Math.max(...flashes.map((t) => flashes.filter((u) => u >= t && u < t + 1000).length));
  expect(worst).toBeLessThanOrEqual(2);
});
