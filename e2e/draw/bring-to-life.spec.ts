/**
 * Bring to life (§2.10, §8.4): a requested drawing goes into the running world by a hot swap (the game is
 * never restarted), in one commit with its world slot, then the Desk returns to the world.
 */
import { expect, openAmble, test } from '../helpers/app';
import { gameFrame, openWorld, readGame } from '../world/world';
import { boardSize, circle, drawOnBoard, openDesk, openStarterWorld, settle, tapOnBoard } from './desk';

type Amble = {
  services: { player: { swapArt(a: { key: string; rig?: unknown }): void; load(i: unknown): Promise<unknown> } };
  store: {
    worlds: { get(id: string): Promise<{ cast: Record<string, { art: string | null; madeBy: string | null }> } | null> };
    art: { get(id: string): Promise<{ export: { flat: string; sticker: string } | null; rigData: unknown; kind: string; rig: string } | null> };
    blobs: { get(ref: string): Promise<Blob | null> };
  };
};

test('a request, brought to life, is hot-swapped into the running world', async ({ page }) => {
  test.setTimeout(120_000);
  const world = await openWorld(page);
  // The world's game is running before the Desk opens: this game, created once.
  const before = await readGame(await gameFrame(page), (g) => ({ created: g.createCount, boss: !!g.find('boss')?.drawn }));
  expect(before.boss).toBe(false);

  await openDesk(page, `#/w/${world}/draw/boss`);
  // From here on, count what the Desk asks of the player.
  await page.evaluate(() => {
    const w = window as unknown as { __amble: Amble; __swaps: Array<{ key: string; rig: boolean }>; __loads: number };
    const p = w.__amble.services.player;
    w.__swaps = [];
    w.__loads = 0;
    const swap = p.swapArt.bind(p);
    const load = p.load.bind(p);
    p.swapArt = (a) => {
      w.__swaps.push({ key: a.key, rig: !!a.rig });
      swap(a);
    };
    p.load = (i) => {
      if (/draw/.test(location.hash)) w.__loads++;
      return load(i);
    };
  });

  const { w, h } = await boardSize(page);
  await drawOnBoard(page, circle(w / 2, h * 0.55, w * 0.25, 0, 360));
  await settle(page, 400);
  await page.getByTestId('desk-board').focus();
  await page.keyboard.press('g');
  await tapOnBoard(page, w / 2, h * 0.55);
  await settle(page, 600);

  await page.getByTestId('bring-to-life').click();
  await page.waitForFunction((id) => location.hash === `#/w/${id}`, world, { timeout: 30_000 });

  const seen = await page.evaluate(() => {
    const x = window as unknown as { __swaps: Array<{ key: string; rig: boolean }>; __loads: number };
    return { swaps: x.__swaps, loads: x.__loads };
  });
  // The drawing went into the running game with its bones; the Desk never started a new game.
  expect(seen.swaps.filter((s) => s.key === 'boss').pop()).toEqual({ key: 'boss', rig: true });
  expect(seen.loads).toBe(0);

  // One commit put the drawing and the world's slot in the store.
  const saved = await page.evaluate(async (id) => {
    const a = (window as unknown as { __amble: Amble }).__amble;
    const wld = await a.store.worlds.get(id);
    const slot = wld?.cast.boss;
    const rec = slot?.art ? await a.store.art.get(slot.art) : null;
    const flat = rec?.export ? await a.store.blobs.get(rec.export.flat) : null;
    const sticker = rec?.export ? await a.store.blobs.get(rec.export.sticker) : null;
    return { madeBy: slot?.madeBy ?? null, hasRig: !!rec?.rigData, flat: flat?.size ?? 0, sticker: sticker?.size ?? 0, kind: rec?.kind };
  }, world);
  expect(saved.madeBy).toBe('student');
  expect(saved.hasRig).toBe(true);
  expect(saved.flat).toBeGreaterThan(100);
  expect(saved.sticker).toBeGreaterThan(100);
  expect(saved.kind).toBe('character');

  // The world shows again, still the same game (not restarted), now with the drawing.
  await expect(page.getByTestId('screen-world')).toBeVisible();
  const frame = await gameFrame(page);
  await expect.poll(() => readGame(frame, (g) => !!g.find('boss')?.drawn), { timeout: 20_000 }).toBe(true);
  expect(await readGame(frame, (g) => g.createCount)).toBe(before.created);
});

test('an empty sheet says to draw first', async ({ page }) => {
  await openAmble(page);
  const world = await openStarterWorld(page);
  await openDesk(page, `#/w/${world}/draw/minion`);
  await page.getByTestId('bring-to-life').click();
  await expect(page.getByText('Draw something first!')).toBeVisible();
  expect(page.url()).toContain('/draw/minion');
});
