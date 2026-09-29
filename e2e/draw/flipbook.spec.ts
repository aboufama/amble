/**
 * Flipbook moves (§7.12): pages drawn in the Desk's Flipbook, picked for a move, go into the game with the
 * drawing (`DrawnArt.frames`), and the game plays on without errors.
 */
import { expect, test } from '../helpers/app';
import { gameFrame, openWorld, readGame } from '../world/world';
import { boardSize, circle, drawOnBoard, openDesk, settle } from './desk';

test('pages for a move travel with the drawing into the game', async ({ page }) => {
  test.setTimeout(120_000);
  const world = await openWorld(page);
  await openDesk(page, `#/w/${world}/draw/hero`);
  await page.getByRole('radio', { name: 'Freehand' }).click();
  const { w, h } = await boardSize(page);
  // Page 1: a figure.
  await drawOnBoard(page, circle(w / 2, h * 0.35, w * 0.12, 0, 360));
  await drawOnBoard(page, [
    [w / 2, h * 0.47],
    [w / 2, h * 0.7],
  ]);
  await drawOnBoard(page, [
    [w / 2, h * 0.7],
    [w * 0.4, h * 0.86],
  ]);
  await settle(page, 300);
  // Page 2: a copy, with the other leg forward.
  await page.getByRole('button', { name: 'Add a page' }).click();
  await expect(page.getByRole('button', { name: 'Page 2' })).toHaveAttribute('aria-current', 'true');
  await drawOnBoard(page, [
    [w / 2, h * 0.7],
    [w * 0.6, h * 0.86],
  ]);
  await settle(page, 300);
  // The pages are for Walk.
  await page.getByRole('button', { name: 'No move yet' }).click();
  await page.getByRole('menuitem', { name: 'Walk' }).click();
  await expect(page.getByRole('button', { name: 'Walk' })).toBeVisible();

  await page.getByTestId('bring-to-life').click();
  await page.waitForFunction((id) => location.hash === `#/w/${id}`, world, { timeout: 30_000 });

  const saved = await page.evaluate(async (id) => {
    type A = { store: { worlds: { get(id: string): Promise<{ cast: Record<string, { art: string | null }> } | null> }; art: { get(id: string): Promise<{ export: { frames: { move: string; fps: number; json: string } | null } | null } | null> } } };
    const a = (window as unknown as { __amble: A }).__amble;
    const art = (await a.store.worlds.get(id))?.cast.hero?.art;
    const rec = art ? await a.store.art.get(art) : null;
    const f = rec?.export?.frames;
    return f ? { move: f.move, fps: f.fps, pages: (JSON.parse(f.json) as { frames: unknown[] }).frames.length } : null;
  }, world);
  expect(saved).toEqual({ move: 'walk', fps: 8, pages: 2 });

  // The game has the drawing, and nothing went wrong in it.
  const frame = await gameFrame(page);
  await expect.poll(() => readGame(frame, (g) => !!g.find('hero')?.drawn), { timeout: 20_000 }).toBe(true);
  expect(await readGame(frame, (g) => g.errors.length)).toBe(0);
  // The kit made the flipbook's pages into a texture for the hero's visual.
  const pages = await readGame(frame, (g) => (g.game as { textures: { getTextureKeys(): string[] } }).textures.getTextureKeys().filter((k) => k.startsWith('~flip:')).length);
  expect(pages).toBeGreaterThan(0);
});
