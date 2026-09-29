/**
 * The running game's frame, across the player and the kit: a game torn down mid-run leaves no page error
 * (its closed audio stays quiet), a robot test in the spare holds the frozen-game watchdog and leaves the
 * visible game running, the title card's keys never count as the game's controls, a heal right after
 * a hit leaves the heart full, a level restart keeps its level and skips the title card once the game has
 * started, and a shake's camera kick keeps the game's turn.
 */
import type { Frame, Page } from '@playwright/test';
import { expect, gotoRoute, openAmble, test } from '../helpers/app';
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

/**
 * The hearts row (the kit's HUD: plain hearts, or crops of the hero's head when it was drawn on the bones):
 * each heart's alpha and whether a tween still runs on it.
 */
const HEARTS = `(s) => {
  const ui = s.__kit.ui;
  const bar = ui.bars.find((b) => b.kind === 'hearts');
  return (bar ? bar.icons : []).map((o) => ({ alpha: Math.round(o.alpha * 100) / 100, tweens: ui.s.tweens.getTweensOf(o).length }));
}`;

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

test('Sky Run, a runner that never shoots, shows only its jump key', async ({ page }) => {
  await openAmble(page);
  await gotoRoute(page, '#/starter/sky-run');
  await expect(page).toHaveURL(/#\/w\/[A-Za-z0-9_-]+$/);
  await expect(page.getByTestId('player-layer')).toHaveAttribute('data-first-frame', /^[1-9]\d*$/, { timeout: 45_000 });
  const frame = await gameFrame(page);
  // The title card has been reading its keys for a while, and the delayed manifest has gone out.
  await page.waitForTimeout(3000);
  expect(await frame.evaluate(() => (window as unknown as { __ambleGame: { state: string } }).__ambleGame.state)).toBe('title');
  const keys = page.getByRole('list', { name: 'Keys for this game' }).getByRole('listitem');
  await expect(keys).toHaveCount(1);
  await expect(keys.first()).toContainText('jump');
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
      const ui = s.__kit.ui;
      const icons = ui.bars.find((b) => b.kind === 'hearts').icons;
      hero.invulnUntil = 0;
      hero.damage(1);
      const lost = icons[hero.hp];
      const t0 = performance.now();
      const wait = () => {
        const n = ui.s.tweens.getTweensOf(lost).length;
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

test('a level restart keeps the level setLevel chose, and playing again after a win starts at level 1', async ({ page }) => {
  test.setTimeout(150_000);
  await openWorld(page);
  // A game that notes the level each create() builds (its own fields live on through a level restart): level 1,
  // then setLevel(2) and restart(), then a win and restart() (play again). It reports what it saw as an error,
  // which the robot test collects.
  const LEVELS = `class Game extends Amble.Scene {
  static config = { physics: 'none' };
  create() {
    this.seen = [...(this.seen || []), this.levelNumber];
    if (this.seen.length === 1) this.after(50, () => { this.setLevel(2); this.restart(); });
    else if (this.seen.length === 2) this.after(50, () => { this.win(); this.after(50, () => this.restart()); });
    else throw new Error('levels ' + this.seen.join(' '));
  }
}
`;
  expect(await robotErrors(page, LEVELS)).toContainEqual(expect.stringContaining('levels 1 2 1'));
});

test('once the game has started, a level restart plays at once: no title card between levels', async ({ page }) => {
  test.setTimeout(150_000);
  await openWorld(page);
  const frame = await gameFrame(page);
  const state = () => frame.evaluate(() => (window as unknown as { __ambleGame: { state: string } }).__ambleGame.state);
  const creates = () => frame.evaluate(() => (window as unknown as { __ambleGame: { createCount: number } }).__ambleGame.createCount);
  expect(await state()).toBe('title');
  await startGame(page, frame);
  const before = await creates();
  // Level 2 the documented way; the game's own "LEVEL 2" banner is the title the student sees.
  await inScene(frame, '(s) => { s.setLevel(2); s.restart(); }');
  await expect.poll(creates, { timeout: 20_000 }).toBeGreaterThan(before);
  await expect.poll(state, { timeout: 20_000 }).toBe('running');
  expect(await inScene<number>(frame, '(s) => s.levelNumber')).toBe(2);
});

test("a big shake kicks the camera and eases back to the game's own turn, so a flipped screen stays flipped", async ({ page }) => {
  test.setTimeout(150_000);
  await openWorld(page);
  // The game turns the screen upside down, then a big shake (0.014 and up) kicks the camera. The game reports
  // whether the kick moved the camera, and where the camera came to rest.
  const FLIPPED = `class Game extends Amble.Scene {
  static config = { physics: 'none' };
  create() {
    const cam = this.cameras.main;
    cam.setRotation(Math.PI);
    this.after(50, () => {
      this.fx.shake(0.02, 180);
      const kicked = Math.abs(cam.rotation - Math.PI) > 0.001;
      this.after(900, () => { throw new Error('camera ' + kicked + ' ' + cam.rotation.toFixed(2)); });
    });
  }
}
`;
  expect(await robotErrors(page, FLIPPED)).toContainEqual(expect.stringContaining('camera true 3.14'));
});

/** Runs `source` as the open world's game in a robot test (no autopilot) and returns the errors it reported. */
async function robotErrors(page: Page, source: string): Promise<string[]> {
  return page.evaluate(async (source) => {
    type Amble = { getState(): { session: { world: object | null }; prefs: unknown }; services: { player: { robot(init: unknown): Promise<{ raw: { errors: Array<{ message: string }> } }> } } };
    const a = (window as unknown as { __amble: Amble }).__amble;
    const initUrl = '/src/world/init.ts';
    const prefsUrl = '/src/app/player/prefs.ts';
    const { toInitMessage } = (await import(/* @vite-ignore */ initUrl)) as { toInitMessage(w: unknown, o: unknown): Promise<unknown> };
    const { playerPrefsFrom } = (await import(/* @vite-ignore */ prefsUrl)) as { playerPrefsFrom(p: unknown): Record<string, unknown> };
    const world = { ...a.getState().session.world, code: [{ path: 'game.js', source, authors: [], locked: [] }] };
    const init = await toInitMessage(world, { mode: 'robot', prefs: { ...playerPrefsFrom(a.getState().prefs), muted: true }, robot: { gameMs: 3000, seed: 1, bot: 'none' }, autostart: true });
    const r = await a.services.player.robot(init);
    return r.raw.errors.map((e) => e.message);
  }, source);
}
