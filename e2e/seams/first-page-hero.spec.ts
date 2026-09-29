/**
 * Seam M1 + M3 (§8.6): the First page's doodle is the hero of the chosen seed. The creature brought to
 * life on the paper (M3's `bringToLife`: export, bones, one commit) is the drawing the new world's hero
 * slot points at, and the very picture and bones the game gets for its hero.
 */
import { expect, openAmble, test } from '../helpers/app';
import { drawnIn, drawPerson, gameFrame, worldReady } from '../journeys/journey';

interface Loaded {
  key: string;
  bytes: number;
  rig: boolean;
}

test('the doodle brought to life on the First page plays the hero of the seed', async ({ page }) => {
  test.setTimeout(240_000);
  await openAmble(page, { clean: true });
  await expect(page.getByTestId('screen-home')).toHaveAttribute('data-home', 'first');
  await drawPerson(page, page.getByTestId('first-board'));
  await page.getByTestId('bring-to-life').click();
  await expect(page.getByTestId('screen-first')).toHaveAttribute('data-awake', 'true', { timeout: 90_000 });

  // The drawing M3 saved: its record, its flat picture and its bones.
  const doodle = await page.evaluate(async () => {
    const a = (window as unknown as { __amble: { getState(): { library: { characters: Array<{ id: string; name: string }> } }; store: { art: { get(id: string): Promise<{ export: { flat: string } | null; rigData: unknown } | null> }; blobs: { get(r: string): Promise<Blob | null> } } } }).__amble;
    const c = a.getState().library.characters[0];
    const rec = await a.store.art.get(c.id);
    const flat = rec?.export ? await a.store.blobs.get(rec.export.flat) : null;
    return { id: c.id, name: c.name, flat: flat?.size ?? 0, rig: !!rec?.rigData };
  });
  expect(doodle.flat).toBeGreaterThan(100);
  expect(doodle.rig).toBe(true);

  // What the player is asked to load from here on.
  await page.evaluate(() => {
    const w = window as unknown as { __amble: { services: { player: { load(i: unknown): Promise<unknown> } } }; __loaded: Loaded[][] };
    const p = w.__amble.services.player;
    const load = p.load.bind(p);
    w.__loaded = [];
    p.load = (init: unknown) => {
      const art = (init as { art: Array<{ key: string; image: Blob; rig?: unknown }> }).art;
      w.__loaded.push(art.map((x) => ({ key: x.key, bytes: x.image instanceof Blob ? x.image.size : 0, rig: !!x.rig })));
      return load(init);
    };
  });

  // The first world type on the First page, with the creature in it.
  const seed = page.getByTestId('first-column').getByRole('button', { name: new RegExp(`with ${doodle.name}`) }).first();
  await seed.click();
  const worldId = await worldReady(page);
  const opened = await page.evaluate(async (id) => {
    const a = (window as unknown as { __amble: { store: { worlds: { get(id: string): Promise<{ cast: Record<string, { art: string | null; madeBy: string | null }>; origin: Record<string, unknown> } | null> } }; getState(): { session: { cast: Array<{ key: string; role: string }> } } } }).__amble;
    const w = await a.store.worlds.get(id);
    const hero = a.getState().session.cast.find((m) => m.role === 'hero')?.key ?? 'hero';
    return { hero, slot: w?.cast[hero] ?? null, origin: w?.origin ?? null };
  }, worldId);
  expect(opened.origin).toMatchObject({ kind: 'starter', withArt: false });
  expect(opened.slot).toMatchObject({ art: doodle.id, madeBy: 'student' });

  // The game got the doodle itself as its hero (same picture, with its bones), and nothing else is drawn.
  const loads = await page.evaluate(() => (window as unknown as { __loaded: Loaded[][] }).__loaded);
  const last = loads.at(-1) ?? [];
  expect(last).toEqual([{ key: opened.hero, bytes: doodle.flat, rig: true }]);
  const frame = await gameFrame(page);
  await expect.poll(() => drawnIn(frame, opened.hero), { timeout: 30_000 }).toBe(true);
});
