/**
 * The starter worlds in the app (§9, §8.5 M8). Each starter opens at `#/starter/<id>` as the student's own
 * world and reaches its first frame with its example drawings, its "your turn" member left as a
 * placeholder; each passes the robot test with 0 errors, as a starter and as a seed; a seed shows every
 * member but the hero as just bones, each kind with its name tag. The hidden Parade opens and plays too.
 */
import type { Frame, Page } from '@playwright/test';
import { expect, gotoRoute, openAmble, test } from '../helpers/app';

// Software GL (SwiftShader) paints the page, the visible game and the robot's game on one CPU: the cast
// line's marching placeholder outlines (a seed shows many) would starve the robot of frames. Calm motion
// stills them; the robot's own game is unaffected (it runs on its own clock and prefs).
test.use({ reducedMotion: 'reduce' });

const STARTERS = [
  { id: 'moon-king', name: 'Moon King', hero: 'hero', yourTurn: 'grumble', drawn: ['hero', 'moonKing', 'star', 'sky'] },
  { id: 'sky-run', name: 'Sky Run', hero: 'hero', yourTurn: 'bloop', drawn: ['hero', 'glim', 'portal', 'sky'] },
  { id: 'wobble-tower', name: 'Wobble Tower', hero: 'wobbles', yourTurn: 'crate', drawn: ['wobbles', 'dummy', 'ball', 'city'] },
  { id: 'lantern-maze', name: 'Lantern Maze', hero: 'hero', yourTurn: 'boo', drawn: ['hero', 'lantern', 'key', 'wall'] },
  { id: 'clanks-climb', name: "Clank's Climb", hero: 'hero', yourTurn: 'spiky', drawn: ['hero', 'gear', 'rocket', 'goo'] },
] as const;

interface Obj {
  key: string | null;
  label: string;
  drawn: boolean;
}

interface ArtEntry {
  key: string;
  kind: string;
  drawn: boolean;
}

interface AppWindow {
  __amble: {
    services: {
      starters: { open(id: string, o: { withArt: boolean }): Promise<{ world: { id: string } }> };
      store: { commit(c: { worlds: unknown[] }): Promise<void> };
      player: {
        player: { iframe: HTMLIFrameElement | null } | null;
        robot(init: unknown): Promise<{ raw: { errors: unknown[]; frames: number }; verdict: { pass: boolean; reasons: string[] } }>;
        pause(): void;
        resume(): void;
      };
    };
    getState(): { session: { world: ({ id: string; cast: Record<string, { art: string | null }> } & Record<string, unknown>) | null }; prefs: unknown };
    navigate(r: { name: 'world'; id: string }): void;
  };
}

interface GameWindow {
  __ambleGame: {
    game: { textures: { exists(key: string): boolean } } | null;
    errors: unknown[];
    objects(): Obj[];
    manifest(): { art: ArtEntry[] };
  };
}

/** How many games have reached their first frame on this page (the player layer counts them). */
async function firstFrames(page: Page): Promise<number> {
  const layer = page.getByTestId('player-layer');
  return (await layer.count()) ? Number((await layer.getAttribute('data-first-frame')) ?? 0) : 0;
}

/** Waits for the world screen and a game's first frame after the `after`th one. */
async function firstFrame(page: Page, after = 0): Promise<void> {
  await expect(page).toHaveURL(/#\/w\/[A-Za-z0-9_-]+$/);
  await expect(page.getByTestId('screen-world')).toBeVisible();
  await expect.poll(() => firstFrames(page), { timeout: 60_000 }).toBeGreaterThan(after);
}

/** The visible game's frame, once its game is up. */
async function gameFrame(page: Page): Promise<Frame> {
  const handle = await page.evaluateHandle(() => (window as unknown as AppWindow).__amble.services.player.player?.iframe ?? null);
  const frame = await handle.asElement()?.contentFrame();
  if (!frame) throw new Error('No game frame.');
  await frame.waitForFunction(() => !!(window as unknown as GameWindow).__ambleGame?.game);
  return frame;
}

/** Opens a starter as a seed ("give my hero a world") with no drawings at all, and waits for its first frame. */
async function openSeed(page: Page, id: string): Promise<void> {
  const before = await firstFrames(page);
  const worldId = await page.evaluate(async (starter) => {
    const a = (window as unknown as AppWindow).__amble;
    const { world } = await a.services.starters.open(starter, { withArt: false });
    await a.services.store.commit({ worlds: [world] });
    a.navigate({ name: 'world', id: world.id });
    return world.id;
  }, id);
  await expect(page).toHaveURL(new RegExp(`#/w/${worldId}$`));
  await firstFrame(page, before);
  await expect.poll(() => page.evaluate(() => (window as unknown as AppWindow).__amble.getState().session.world?.id)).toBe(worldId);
}

/** The robot test (6 s of game time, the automatic bot) on the open world, in the player's spare frame. */
async function robot(page: Page): Promise<{ pass: boolean; reasons: string[]; errors: unknown[]; frames: number }> {
  return page.evaluate(async () => {
    const a = (window as unknown as AppWindow).__amble;
    const world = a.getState().session.world;
    if (!world) throw new Error('No world is open.');
    const initUrl = '/src/world/init.ts';
    const prefsUrl = '/src/app/player/prefs.ts';
    const { toInitMessage } = (await import(/* @vite-ignore */ initUrl)) as { toInitMessage(w: unknown, o: unknown): Promise<unknown> };
    const { playerPrefsFrom } = (await import(/* @vite-ignore */ prefsUrl)) as { playerPrefsFrom(p: unknown): Record<string, unknown> };
    const init = await toInitMessage(world, { mode: 'robot', prefs: { ...playerPrefsFrom(a.getState().prefs), muted: true }, robot: { gameMs: 6000, seed: 1, bot: 'auto' }, autostart: true });
    // The visible game sleeps meanwhile, so the robot has the (software) GPU to itself.
    a.services.player.pause();
    try {
      const r = await a.services.player.robot(init);
      return { pass: r.verdict.pass, reasons: r.verdict.reasons, errors: r.raw.errors, frames: r.raw.frames };
    } finally {
      a.services.player.resume();
    }
  });
}

const artOf = (frame: Frame) => frame.evaluate(() => (window as unknown as GameWindow).__ambleGame.manifest().art.map((a) => ({ key: a.key, kind: a.kind, drawn: a.drawn })));
const objectsOf = (frame: Frame) => frame.evaluate(() => (window as unknown as GameWindow).__ambleGame.objects().map((o) => ({ key: o.key, label: o.label, drawn: o.drawn })));
const hasTag = (frame: Frame, key: string) => frame.evaluate((k) => !!(window as unknown as GameWindow).__ambleGame.game?.textures.exists(`~tag:${k}`), key);

for (const s of STARTERS) {
  test(`${s.name} opens with its drawings and plays, and its seed plays as just bones`, async ({ page }) => {
    test.setTimeout(300_000);
    await openAmble(page);

    // The starter world: the example drawings, the "your turn" member left as a placeholder.
    await gotoRoute(page, `#/starter/${s.id}`);
    await firstFrame(page);
    let frame = await gameFrame(page);
    const art = await artOf(frame);
    for (const key of s.drawn) expect(art.find((a) => a.key === key), key).toMatchObject({ drawn: true });
    expect(art.find((a) => a.key === s.yourTurn), s.yourTurn).toMatchObject({ drawn: false });
    const cast = await page.evaluate(() => (window as unknown as AppWindow).__amble.getState().session.world?.cast ?? {});
    expect(cast[s.yourTurn]?.art ?? null).toBeNull();
    for (const key of s.drawn) expect(cast[key]?.art, key).toBeTruthy();
    expect(await frame.evaluate(() => (window as unknown as GameWindow).__ambleGame.errors)).toEqual([]);
    const asStarter = await robot(page);
    expect(asStarter.reasons).toEqual([]);
    expect(asStarter.errors).toEqual([]);
    expect(asStarter.pass).toBe(true);

    // The seed: nothing drawn; every member on screen is just bones, each character with its name tag.
    await openSeed(page, s.id);
    frame = await gameFrame(page);
    const seedArt = await artOf(frame);
    expect(seedArt.filter((a) => a.drawn)).toEqual([]);
    const objects = await objectsOf(frame);
    expect(objects.length).toBeGreaterThan(0);
    for (const o of objects) expect(o.drawn, `${o.key}`).toBe(false);
    const characters = new Set(seedArt.filter((a) => a.kind === 'character').map((a) => a.key));
    const shown = new Set(objects.map((o) => o.key).filter((k): k is string => !!k && characters.has(k)));
    expect(shown.size).toBeGreaterThan(0);
    for (const key of shown) expect(await hasTag(frame, key), `name tag of ${key}`).toBe(true);
    const asSeed = await robot(page);
    expect(asSeed.reasons).toEqual([]);
    expect(asSeed.errors).toEqual([]);
    expect(asSeed.pass).toBe(true);
  });
}

test('the Parade opens for old imports and plays', async ({ page }) => {
  test.setTimeout(180_000);
  await openAmble(page);
  await openSeed(page, 'parade');
  const frame = await gameFrame(page);
  const keys = (await artOf(frame)).map((a) => a.key);
  for (const key of ['hero', 'pal1', 'pal7']) expect(keys).toContain(key);
  const r = await robot(page);
  expect(r.reasons).toEqual([]);
  expect(r.errors).toEqual([]);
  expect(r.pass).toBe(true);
});
