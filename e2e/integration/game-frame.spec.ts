/**
 * The running game's frame, across the player and the kit: a game torn down mid-run leaves no page error
 * (its closed audio stays quiet), a robot test in the spare holds the frozen-game watchdog and leaves the
 * visible game running, the title card's keys never count as the game's controls, and a heal right after
 * a hit leaves the heart full.
 */
import type { Frame, Page } from '@playwright/test';
import { expect, test } from '../helpers/app';
import { gameFrame, openWorld, startGame } from '../world/world';

interface PlayerLike {
  send(msg: { type: 'dispose' }): void;
  errors: Array<{ phase: string; message: string }>;
  state: string;
  watch: { held: boolean };
}

interface HostLike {
  player: PlayerLike | null;
  robot(init: unknown): Promise<{ verdict: { pass: boolean } }>;
}

type Win = Window & { __amble: { services: { player: HostLike } } };

/** Runs `fn` (source text of a function of the kit's scene) in the game frame. */
function inScene<T>(frame: Frame, fn: string): Promise<T> {
  return frame.evaluate(`((scene) => (${fn})(scene))(window.__ambleGame.scene)`) as Promise<T>;
}

async function playerState(page: Page): Promise<{ state: string; frozen: number }> {
  return page.evaluate(() => {
    const p = (window as unknown as Win).__amble.services.player.player;
    return { state: p?.state ?? 'none', frozen: (p?.errors ?? []).filter((e) => e.phase === 'frozen').length };
  });
}

/** The hearts row (drawn by the kit's HUD scene): each heart's alpha and whether a tween still runs on it. */
const HEARTS = `(s) => s.game.scene.getScenes(true).flatMap((scene) => scene.children.list
  .filter((o) => o.texture && o.texture.key === 'amble-fx' && o.frame && o.frame.name === 'heart')
  .map((o) => ({ alpha: Math.round(o.alpha * 100) / 100, tweens: scene.tweens.getTweensOf(o).length })))`;

test('a game torn down mid-run leaves no page error: its closed audio stays quiet', async ({ page }) => {
  await openWorld(page);
  const frame = await gameFrame(page);
  expect(await frame.evaluate(() => document.querySelectorAll('canvas').length)).toBeGreaterThan(0);
  // What the editor sends a frame it drops (a load that replaced it, leaving the world), with the frame kept
  // alive long enough for Phaser to finish its own teardown, which suspends the shared, now closed, context.
  await page.evaluate(() => (window as unknown as Win).__amble.services.player.player?.send({ type: 'dispose' }));
  await expect.poll(() => frame.evaluate(() => document.querySelectorAll('canvas').length), { timeout: 15_000 }).toBe(0);
  await page.waitForTimeout(500);
  // The test fixture fails on any uncaught page error ("Cannot suspend a closed AudioContext").
});

test('a robot test in the spare holds the watchdog, and the visible game keeps running', async ({ page }) => {
  test.setTimeout(150_000);
  await openWorld(page);
  const frame = await gameFrame(page);
  await startGame(page, frame);
  const held = await page.evaluate(async () => {
    const host = (window as unknown as Win).__amble.services.player;
    const { FIXTURES } = await import(/* @vite-ignore */ `${location.origin}/src/runtime/fixtures/index.ts`);
    const { DEFAULT_PREFS } = await import(/* @vite-ignore */ `${location.origin}/src/play/protocol.ts`);
    const init = {
      type: 'init', mode: 'robot', files: [{ name: 'game.js', source: FIXTURES.runner }], art: [], sounds: [], fonts: [], dials: {}, twists: [], storage: {},
      prefs: DEFAULT_PREFS, autostart: true, robot: { gameMs: 6000, seed: 1, bot: 'auto' },
    };
    const run = host.robot(init);
    await new Promise((r) => setTimeout(r, 50));
    const during = host.player?.watch.held ?? false;
    await run.catch(() => undefined);
    return { during, after: host.player?.watch.held ?? true };
  });
  expect(held).toEqual({ during: true, after: false });
  expect(await playerState(page)).toEqual({ state: 'running', frozen: 0 });
  await page.waitForTimeout(2000);
  expect(await playerState(page)).toEqual({ state: 'running', frozen: 0 });
});

test("the title card's keys never count as the game's controls", async ({ page }) => {
  await openWorld(page);
  const frame = await gameFrame(page);
  // The title card reads jump, fire and action every frame; play reads the pause key every frame.
  await page.waitForTimeout(1000);
  const atTitle = await inScene<string[]>(frame, '(s) => s.usedActions()');
  for (const a of ['jump', 'fire', 'action', 'pause']) expect(atTitle, a).not.toContain(a);
  await startGame(page, frame);
  await expect.poll(() => inScene<string[]>(frame, '(s) => s.usedActions()')).toContain('jump');
  const playing = await inScene<string[]>(frame, '(s) => s.usedActions()');
  expect(playing).not.toContain('action');
  expect(playing).not.toContain('pause');
});

test('a heal right after a hit leaves the heart full', async ({ page }) => {
  await openWorld(page);
  const frame = await gameFrame(page);
  await startGame(page, frame);
  const before = await inScene<Array<{ alpha: number; tweens: number }>>(frame, HEARTS);
  expect(before.length).toBeGreaterThanOrEqual(3);
  expect(before.map((h) => h.alpha)).toEqual(before.map(() => 1));
  // A hit, then a heal while the lost heart is still fading (its fade takes 300 ms).
  const fading = await inScene<number>(
    frame,
    `(s) => new Promise((done) => {
      const hero = s.__kit.hero;
      const hud = s.game.scene.getScenes(true).find((scene) => scene.children.list.some((o) => o.texture && o.texture.key === 'amble-fx' && o.frame && o.frame.name === 'heart'));
      const icons = hud.children.list.filter((o) => o.texture && o.texture.key === 'amble-fx' && o.frame && o.frame.name === 'heart');
      hero.invulnUntil = 0;
      hero.damage(1);
      const lost = icons[hero.hp];
      const t0 = performance.now();
      const wait = () => {
        const n = hud.tweens.getTweensOf(lost).length;
        if (n > 0 || performance.now() - t0 > 3000) {
          hero.heal(1);
          done(n);
        } else setTimeout(wait, 5);
      };
      wait();
    })`,
  );
  expect(fading, 'the heart was still fading when the heal came').toBeGreaterThan(0);
  await expect.poll(async () => (await inScene<Array<{ tweens: number }>>(frame, HEARTS)).every((h) => h.tweens === 0), { timeout: 15_000 }).toBe(true);
  expect((await inScene<Array<{ alpha: number }>>(frame, HEARTS)).map((h) => h.alpha)).toEqual(before.map(() => 1));
});
