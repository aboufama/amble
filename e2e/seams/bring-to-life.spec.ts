/**
 * Seam M3 + M2 (§8.6): Bring to life hot-swaps into the running world, with no restart. A "just bones"
 * member lifted from the running game onto the Desk comes back drawn, with its bones, by one `swapArt` into
 * the same game (its scene is never created again and the player never loads a new game), the game goes on,
 * and the drawing is one footstep.
 */
import { expect, openAmble, test } from '../helpers/app';
import { deskReady, drawnIn, drawOnDesk, footsteps, gameFrame, keyOfRole, openSeed, readGame, startGame } from '../journeys/journey';

test('a drawing brought to life drops into the running game without a restart', async ({ page }) => {
  test.setTimeout(240_000);
  await openAmble(page, { clean: true });
  const worldId = await openSeed(page, 'moon-king');
  const frame = await gameFrame(page);
  await startGame(page, frame);
  const boss = await keyOfRole(page, 'boss');
  expect(await drawnIn(frame, boss.key)).toBe(false);
  const created = await readGame(frame, (g) => g.createCount);
  const swaps = await readGame(frame, (g) => g.swaps);
  const steps = (await page.evaluate(() => (window as unknown as { __amble: { getState(): { session: { world: { steps: unknown[] } | null } } } }).__amble.getState().session.world?.steps.length)) ?? 0;

  // Count what the Desk asks of the player from here on.
  await page.evaluate(() => {
    const w = window as unknown as { __amble: { services: { player: { swapArt(a: { key: string; rig?: unknown }): void; load(i: unknown): Promise<unknown> } } }; __seen: { swaps: Array<{ key: string; rig: boolean }>; loads: number } };
    const p = w.__amble.services.player;
    const swap = p.swapArt.bind(p);
    const load = p.load.bind(p);
    w.__seen = { swaps: [], loads: 0 };
    p.swapArt = (a) => {
      w.__seen.swaps.push({ key: a.key, rig: !!a.rig });
      swap(a);
    };
    p.load = (i) => {
      w.__seen.loads++;
      return load(i);
    };
  });

  // The cast card lifts the member onto the Desk (the game pauses under it).
  await page.getByTestId(`cast-card-${boss.key}`).click();
  await expect(page).toHaveURL(new RegExp(`#/w/${worldId}/draw/${boss.key}$`), { timeout: 20_000 });
  await deskReady(page);
  await expect.poll(() => readGame(frame, (g) => g.state)).toBe('paused');
  await drawOnDesk(page);
  await page.getByTestId('bring-to-life').click();
  await page.waitForFunction((id) => location.hash === `#/w/${id}`, worldId, { timeout: 60_000 });
  await expect(page.getByTestId('screen-world')).toBeVisible();

  // The same game, now with the drawing and its bones; it plays on.
  await expect.poll(() => drawnIn(frame, boss.key), { timeout: 30_000 }).toBe(true);
  await expect.poll(() => readGame(frame, (g) => g.state), { timeout: 20_000 }).toBe('running');
  expect(await readGame(frame, (g) => g.createCount)).toBe(created);
  expect(await readGame(frame, (g) => g.swaps)).toBeGreaterThan(swaps);
  const seen = await page.evaluate(() => (window as unknown as { __seen: { swaps: Array<{ key: string; rig: boolean }>; loads: number } }).__seen);
  expect(seen.loads).toBe(0);
  expect(seen.swaps.filter((s) => s.key === boss.key).at(-1)).toEqual({ key: boss.key, rig: true });

  // One commit: the drawing, its slot and one footstep.
  const saved = await page.evaluate(
    async ({ id, key }) => {
      const a = (window as unknown as { __amble: { store: { worlds: { get(id: string): Promise<{ cast: Record<string, { art: string | null; madeBy: string | null }>; steps: Array<{ kind: string; text: string }> } | null> }; art: { get(id: string): Promise<{ rigData: unknown; export: unknown } | null> } } } }).__amble;
      const w = await a.store.worlds.get(id);
      const art = w?.cast[key]?.art ? await a.store.art.get(w.cast[key].art!) : null;
      return { madeBy: w?.cast[key]?.madeBy ?? null, rig: !!art?.rigData, exported: !!art?.export, steps: w?.steps ?? [] };
    },
    { id: worldId, key: boss.key },
  );
  expect(saved).toMatchObject({ madeBy: 'student', rig: true, exported: true });
  expect(saved.steps).toHaveLength(steps + 1);
  expect(saved.steps.at(-1)?.kind).toBe('draw');
  await expect(footsteps(page).first()).toContainText(boss.name);
});
