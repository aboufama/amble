/**
 * Drawings reach games already bound to their bones (§6.3, §6.5): the editor's rig worker makes the bake,
 * the game only unpacks it, and the player's runtime carries no binding code. A shared web page, which has
 * no editor, brings the binder along in its standalone script.
 */
import type { Frame, Page } from '@playwright/test';
import { expect, test } from '../helpers/app';
import { boardSize, circle, drawOnBoard, openDesk, settle, tapOnBoard } from '../draw/desk';
import { gameFrame, openWorld } from '../world/world';

type Win = Window & {
  __amble: {
    getState(): { session: { cast: Array<{ key: string; kind: string; rig: string; role: string; status: string; priority: number; onScreen: boolean }> } };
    services: {
      player: { on(type: 'warn', fn: (m: { message: string }) => void): () => void };
      store: { worlds: { get(id: string): Promise<unknown> } };
      files: { sharePage(w: unknown): Promise<Blob> };
    };
  };
  __warns: string[];
};

/** Is this key's character drawn with its bones (the rig mesh), not moving as one piece? */
function riggedIn(frame: Frame, key: string): Promise<boolean> {
  return frame.evaluate((k) => {
    const g = (window as unknown as { __ambleGame: { find(k: string): unknown } }).__ambleGame;
    const c = g.find(k) as { drawn?: boolean; visual?: { bound?: { rest?: ArrayLike<number> } } } | null;
    return !!(c?.drawn && c.visual?.bound?.rest && c.visual.bound.rest.length > 0);
  }, key);
}

/**
 * A character with bones that the game shows now, other than the hero: an undrawn one first, else one to
 * redraw (the fixture game's boss; in the real Moon King, whose seed comes drawn, the Moon King).
 */
function characterToDraw(page: Page): Promise<string> {
  return page.evaluate(() => {
    const cast = (window as unknown as Win).__amble.getState().session.cast;
    const pick = cast
      .filter((m) => m.kind === 'character' && m.rig !== 'none' && m.role !== 'hero' && m.status !== 'spare' && m.onScreen)
      .sort((a, b) => Number(a.status === 'drawn') - Number(b.status === 'drawn') || a.priority - b.priority)[0];
    if (!pick) throw new Error('This world shows no character to draw.');
    return pick.key;
  });
}

async function drawCharacter(page: Page, world: string, key: string): Promise<void> {
  await openDesk(page, `#/w/${world}/draw/${key}`);
  const { w, h } = await boardSize(page);
  await drawOnBoard(page, circle(w / 2, h * 0.55, w * 0.25, 0, 360));
  await settle(page, 400);
  await page.getByTestId('desk-board').focus();
  await page.keyboard.press('g');
  await tapOnBoard(page, w / 2, h * 0.55);
  await settle(page, 600);
}

test('a drawing brought to life plays with its bones from the bake, in the running world and after a reload', async ({ page }) => {
  test.setTimeout(150_000);
  const world = await openWorld(page);
  await page.evaluate(() => {
    const w = window as unknown as Win;
    w.__warns = [];
    w.__amble.services.player.on('warn', (m) => w.__warns.push(m.message));
  });
  const key = await characterToDraw(page);
  await drawCharacter(page, world, key);
  await page.getByTestId('bring-to-life').click();
  await page.waitForFunction((id) => location.hash === `#/w/${id}`, world, { timeout: 30_000 });

  let frame = await gameFrame(page);
  await expect.poll(() => riggedIn(frame, key), { timeout: 30_000 }).toBe(true);
  // The game never bound anything itself: the player's runtime has no binder.
  expect(await frame.evaluate(() => typeof (window as unknown as Record<string, unknown>).__ambleRigBinder)).toBe('undefined');
  expect(await page.evaluate(() => (window as unknown as Win).__warns.filter((m) => /bones/i.test(m)))).toEqual([]);

  // A fresh load of the world: the drawing arrives in the init message, baked.
  await page.reload();
  await expect(page.getByTestId('player-layer')).toHaveAttribute('data-first-frame', /^[1-9]\d*$/, { timeout: 45_000 });
  frame = await gameFrame(page);
  await expect.poll(() => riggedIn(frame, key), { timeout: 30_000 }).toBe(true);
});

test('a shared web page binds its drawings itself and plays them with their bones', async ({ page, context }) => {
  test.setTimeout(150_000);
  const world = await openWorld(page);
  const key = await characterToDraw(page);
  await drawCharacter(page, world, key);
  await page.getByTestId('bring-to-life').click();
  await page.waitForFunction((id) => location.hash === `#/w/${id}`, world, { timeout: 30_000 });
  const html = await page.evaluate(async (wid) => {
    const a = (window as unknown as Win).__amble;
    return (await a.services.files.sharePage(await a.services.store.worlds.get(wid))).text();
  }, world);

  const shared = await context.newPage();
  const requests: string[] = [];
  shared.on('request', (r) => {
    if (!/^(data|blob|about):/.test(r.url())) requests.push(r.url());
  });
  await shared.setContent(html);
  await shared.getByRole('button', { name: /Play/ }).click();
  await shared.waitForFunction(() => !!(window as unknown as { __ambleGame?: { game?: unknown } }).__ambleGame?.game, null, { timeout: 45_000 });
  await expect.poll(() => riggedIn(shared.mainFrame(), key), { timeout: 30_000 }).toBe(true);
  expect(await shared.evaluate(() => typeof (window as unknown as Record<string, unknown>).__ambleRigBinder)).toBe('function');
  expect(requests).toEqual([]);
  await shared.close();
});
