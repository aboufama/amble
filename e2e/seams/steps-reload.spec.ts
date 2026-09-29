/**
 * Seam M6 + M9 (§8.6): steps survive a reload. The footsteps a student leaves (a dial, a twist) are in
 * the world's record and their snapshots in the store's `steps`, both in IndexedDB: after a reload the
 * Footsteps panel lists the same steps, and Go back still reaches a snapshot taken before the reload.
 */
import { expect, openAmble, test, waitForApp } from '../helpers/app';
import { firstFrames, footsteps, gameFrame, keyOfRole, openSeed, readGame, storedWorld, worldReady } from '../journeys/journey';

test('footsteps and their snapshots survive a reload, and Go back still works', async ({ page }) => {
  test.setTimeout(240_000);
  await openAmble(page, { clean: true });
  const worldId = await openSeed(page, 'moon-king');
  let frame = await gameFrame(page);

  // Change mode: the hero's card, one of its dials turned by the arrow keys (one footstep once it rests),
  // then a twist.
  await page.getByRole('radio', { name: 'Change' }).click();
  const hero = await keyOfRole(page, 'hero');
  await page.getByTestId(`tag-${hero.key}`).click();
  const card = page.getByTestId('thing-card');
  await expect(card).toBeVisible();
  const { key, label } = await page.evaluate((k) => {
    const s = (window as unknown as { __amble: { getState(): { session: { manifest: { dials: Array<{ key: string; label: string; for?: string; live: boolean }> } | null } } } }).__amble.getState().session;
    const d = s.manifest?.dials.find((x) => x.for === k && x.live);
    return { key: d?.key ?? null, label: d?.label ?? '' };
  }, hero.key);
  expect(key).not.toBeNull();
  const dial = page.getByRole('slider', { name: label });
  const start = await frame.evaluate((k) => (window as unknown as { __ambleGame: { dial(n: string): number | undefined } }).__ambleGame.dial(k!), key);
  await dial.focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => page.evaluate(() => (window as unknown as { __amble: { getState(): { session: { world: { steps: Array<{ kind: string }> } | null } } } }).__amble.getState().session.world?.steps.at(-1)?.kind), { timeout: 10_000 }).toBe('dials');
  const turned = await frame.evaluate((k) => (window as unknown as { __ambleGame: { dial(n: string): number | undefined } }).__ambleGame.dial(k!), key);
  expect(turned).not.toBe(start);

  await page.keyboard.press('Escape');
  await expect(card).toHaveCount(0);
  const tune = page.getByTestId('tune-card');
  await tune.getByRole('radio', { name: 'Twists' }).click();
  const twist = page.getByRole('switch').first();
  await twist.click();
  await expect(twist).toHaveAttribute('aria-checked', 'true');
  await expect.poll(() => page.evaluate(() => (window as unknown as { __amble: { getState(): { session: { world: { steps: Array<{ kind: string }> } | null } } } }).__amble.getState().session.world?.steps.at(-1)?.kind)).toBe('twists');
  await page.keyboard.press('Escape');
  const kept = (await storedWorld(page, worldId))!;
  expect(kept.steps.map((s) => s.kind)).toEqual(['start', 'dials', 'twists']);

  // Reload: the world opens again with every step, and every step's snapshot is in the store.
  await page.reload();
  await waitForApp(page);
  await worldReady(page);
  await expect(footsteps(page)).toHaveCount(3);
  await expect(footsteps(page).first()).toHaveAttribute('data-kind', 'twists');
  const snapshots = await page.evaluate(async (ids) => {
    const store = (window as unknown as { __amble: { store: { steps: { get(id: string): Promise<{ dials: Record<string, number>; twists: string[] } | null> } } } }).__amble.store;
    return Promise.all(ids.map(async (id) => !!(await store.steps.get(id))));
  }, kept.steps.map((s) => s.id));
  expect(snapshots).toEqual([true, true, true]);

  // Go back to the dial's step (a snapshot from before the reload): the twist goes, the dial stays.
  const frames = await firstFrames(page);
  const step = page.locator('.footsteps__trail > .step[data-kind="dials"]').first();
  await step.hover();
  await step.getByRole('button', { name: 'Go back to this step' }).click();
  await expect.poll(() => firstFrames(page), { timeout: 60_000 }).toBeGreaterThan(frames);
  frame = await gameFrame(page);
  await expect.poll(() => frame.evaluate((k) => (window as unknown as { __ambleGame: { dial(n: string): number | undefined } }).__ambleGame.dial(k!), key)).toBe(turned);
  expect(await readGame(frame, (g) => g.twists())).toEqual([]);
  const after = (await storedWorld(page, worldId))!;
  expect(after.steps.map((s) => s.kind)).toEqual(['start', 'dials', 'twists', 'goback']);
  expect(after.twists).toEqual([]);
  expect(after.dials[key!]).toBe(turned);
});
