/**
 * The first five minutes, with no AI (§10.2 `first-five`): a clean profile opens on the First page; pen
 * strokes; **Bring it to life**; the creature moves; it becomes a person with a name; **Boss fight** opens
 * a world where the doodle is the hero and the boss is just bones; the arrow keys move the hero; tapping the
 * boss's placeholder lifts it onto the Desk on the bones; drawn and brought to life, it drops into the same
 * running game (no restart) and a footstep says so. Nothing ever leaves the app.
 */
import { expect, openAmble, test } from '../helpers/app';
import { deskReady, deskState, drawnIn, drawOnDesk, drawPerson, footsteps, gameFrame, keyOfRole, outsideRequests, readGame, startGame, tapObject, worldReady } from './journey';

test('a clean profile: draw, bring it to life, name it, play Boss fight, draw the boss into the running world', async ({ page, guards, baseURL }) => {
  test.setTimeout(300_000);
  await openAmble(page, { clean: true });
  await expect(page.getByTestId('screen-home')).toHaveAttribute('data-home', 'first');
  const first = page.getByTestId('screen-first');
  await expect(first.getByRole('heading', { name: 'Draw a creature.' })).toBeVisible();

  // Pen strokes on the paper; Bring it to life wakes up once there is ink.
  const board = page.getByTestId('first-board');
  await expect(board.locator('canvas').first()).toBeVisible();
  const bring = page.getByTestId('bring-to-life');
  await expect(bring).toHaveAttribute('aria-disabled', 'true');
  await drawPerson(page, board);
  await expect(bring).not.toHaveAttribute('aria-disabled', 'true');
  await bring.click();
  await expect(first).toHaveAttribute('data-awake', 'true', { timeout: 90_000 });

  // It's alive: the rig preview's canvas changes between frames.
  const alive = page.getByTestId('alive-canvas');
  await expect(alive).toBeVisible();
  const moving = await alive.evaluate(async (c: HTMLCanvasElement) => {
    const before = c.toDataURL();
    for (let i = 0; i < 16; i++) {
      await new Promise((r) => setTimeout(r, 150));
      if (c.toDataURL() !== before) return true;
    }
    return false;
  });
  expect(moving, 'the creature moves').toBe(true);

  // The kind chip makes it a person; the name chip names it.
  const kindChip = page.getByTestId('kind-chip');
  await kindChip.getByRole('button').click();
  await page.getByRole('radio', { name: /person/i }).click();
  await expect(kindChip).toContainText('A person');
  await page.keyboard.press('Escape');
  await page.getByTestId('name-chip').click();
  await page.getByTestId('name-input').fill('Sir Hops');
  await page.getByTestId('name-input').press('Enter');
  await expect(page.getByTestId('name-chip')).toContainText('Sir Hops');
  const doodle = await page.evaluate(() => (window as unknown as { __amble: { getState(): { library: { characters: Array<{ id: string; rig: string; name: string }> } } } }).__amble.getState().library.characters[0]);
  await expect.poll(async () => page.evaluate(() => (window as unknown as { __amble: { getState(): { library: { characters: Array<{ rig: string }> } } } }).__amble.getState().library.characters[0]?.rig), { timeout: 30_000 }).toBe('biped');

  // Boss fight, with Sir Hops as its hero.
  await page.getByRole('button', { name: /^Boss fight with Sir Hops/ }).click();
  const worldId = await worldReady(page);
  const frame = await gameFrame(page);
  const hero = await keyOfRole(page, 'hero');
  const boss = await keyOfRole(page, 'boss');
  const stored = await page.evaluate((id) => (window as unknown as { __amble: { store: { worlds: { get(id: string): Promise<{ cast: Record<string, { art: string | null }> } | null> } } } }).__amble.store.worlds.get(id), worldId);
  expect(stored?.cast[hero.key]?.art).toBe(doodle.id);
  await expect.poll(() => drawnIn(frame, hero.key), { timeout: 30_000 }).toBe(true);
  expect(boss.status).not.toBe('drawn');
  expect(await drawnIn(frame, boss.key)).toBe(false);

  // The arrow keys move the hero.
  await startGame(page, frame);
  const heroX = () => readGame(frame, (g) => (g.find('hero') as { x?: number } | null)?.x ?? 0);
  const x0 = await heroX();
  await page.keyboard.down('ArrowRight');
  await expect.poll(heroX, { timeout: 20_000 }).toBeGreaterThan(x0 + 5);
  await page.keyboard.up('ArrowRight');
  const created = await readGame(frame, (g) => g.createCount);

  // Tapping the boss's placeholder lifts it onto the Desk, on the bones.
  await tapObject(page, frame, boss.key);
  await expect(page).toHaveURL(new RegExp(`#/w/${worldId}/draw/${boss.key}$`), { timeout: 20_000 });
  await deskReady(page);
  expect((await deskState(page)).mode).toBe('bones');
  await drawOnDesk(page);

  // Bring to life: back in the same running game, the boss is drawn, nothing restarted.
  await page.getByTestId('bring-to-life').click();
  await page.waitForFunction((id) => location.hash === `#/w/${id}`, worldId, { timeout: 60_000 });
  await expect(page.getByTestId('screen-world')).toBeVisible();
  await expect.poll(() => drawnIn(frame, boss.key), { timeout: 30_000 }).toBe(true);
  expect(await readGame(frame, (g) => g.createCount)).toBe(created);

  // A footstep printed for the drawing.
  await expect(footsteps(page).first()).toContainText(boss.name, { timeout: 15_000 });

  // Nothing left the app: no request to any other origin at all (there is no AI here).
  expect(outsideRequests(guards.egress, new URL(baseURL!).origin)).toEqual([]);
});
