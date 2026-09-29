/**
 * Seam M5 + M8 (§8.6): the ladder patches a starter. When a build fails after its repairs (§5.9), the
 * world becomes the plan's starter (M8's real Moon King, its own code and cast keys) with the plan written
 * in: the plan's title, and each plan member on the starter slot it `mapsTo` with its name and ask, keys
 * kept, so the student draws "the Salt King". The result validates and plays.
 */
import { expect, gotoRoute, openAmble, test } from '../helpers/app';
import { aiFixture, mockAi } from '../helpers/mockAi';
import { firstFrames, storedWorld } from '../journeys/journey';

const BROKEN = '@@amble-patch 1\n@@summary Broken.\n@@safety ok\n@@file game.js create\nclass Game extends Amble.Scene {\n  create() { this.oops( }\n}\n@@end\n';

test('a build that fails twice becomes the Moon King starter with the plan written in, and plays', async ({ page }) => {
  test.setTimeout(300_000);
  const ai = await mockAi(page, { plan: 'plan-snail.json', patches: [{ text: BROKEN }, { text: BROKEN }, { text: BROKEN }] });
  await openAmble(page, { ai: 'mock', clean: true, prefs: { seen: { aiExplainer: Date.now() } } });
  const plan = JSON.parse(aiFixture('plan-snail.json')) as { title: string; cast: Array<{ key: string; name: string; ask: string; mapsTo: string }> };

  // The idea, the plan card, Build it first.
  await gotoRoute(page, '#/new?idea=1');
  await page.getByTestId('idea-field').fill('a snail who rescues her friends from a grumpy salt king');
  await page.getByTestId('idea-go').click();
  await expect(page.getByTestId('plan-card')).toContainText(plan.title);
  const frames = await firstFrames(page);
  await page.getByTestId('plan-build').click();
  await expect(page).toHaveURL(/#\/w\/w_[A-Za-z0-9_-]+$/);
  const worldId = new URL(page.url()).hash.replace('#/w/', '');

  // The build and its two repairs fail: the ladder takes over.
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __amble: { getState(): { ai: { lastOutcome: { kind: string } | null } } } }).__amble.getState().ai.lastOutcome?.kind ?? null), { timeout: 180_000 })
    .toBe('fallback');
  expect(ai.tasks('build')).toHaveLength(1);
  expect(ai.tasks('fix')).toHaveLength(2);

  const world = (await storedWorld(page, worldId))!;
  const game = world.code.find((f) => f.path === 'game.js')!.source;
  const starter = await page.evaluate(async () => {
    const a = (window as unknown as { __amble: { services: { starters: { open(id: string, o: { withArt: boolean }): Promise<{ world: { code: Array<{ path: string; source: string }>; cast: Record<string, unknown> } }> } } } }).__amble;
    const { world: w } = await a.services.starters.open('moon-king', { withArt: false });
    return { files: w.code.map((f) => f.path), keys: Object.keys(w.cast) };
  });
  // The starter's own files, with the plan's title in its config.
  expect(world.code.map((f) => f.path).sort()).toEqual([...starter.files].sort());
  expect(game).toContain(`title: '${plan.title.replace(/'/g, "\\'")}'`);
  // Every plan member that maps to a starter key plays that slot, under the plan's name and ask.
  for (const c of plan.cast.filter((m) => m.mapsTo && starter.keys.includes(m.mapsTo))) {
    const line = game.split('\n').find((l) => new RegExp(`^\\s*${c.mapsTo}: \\{`).test(l)) ?? '';
    expect(line, c.mapsTo).toContain(`name: '${c.name.replace(/'/g, "\\'")}'`);
    expect(line, c.mapsTo).toContain(`ask: '${c.ask.replace(/'/g, "\\'")}'`);
    expect(Object.keys(world.cast)).toContain(c.mapsTo);
  }
  // The patched starter validates with no errors, and it plays.
  const errors = await page.evaluate(async (code) => {
    const url = '/src/cores/ai.ts';
    const core = (await import(/* @vite-ignore */ url)) as { validateGame(f: unknown, o: unknown): { errors: Array<{ message: string }> }; kitManifest(): unknown; sourceFilesOf(c: unknown): unknown };
    return core.validateGame(core.sourceFilesOf(code), { manifest: core.kitManifest(), fix: false }).errors.map((e) => e.message);
  }, world.code);
  expect(errors).toEqual([]);
  await expect(page.getByTestId('cast-line')).toContainText('The Salt King');
  await expect.poll(() => firstFrames(page), { timeout: 60_000 }).toBeGreaterThan(frames);
  expect(ai.errors).toEqual([]);
});
