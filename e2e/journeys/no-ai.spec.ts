/**
 * Everything works with no AI (§1.5, §5.15, §10.2 `no-ai`): with nothing configured, every starter and
 * every world type (each starter's seed, the Parade, a plan's Warm-up) plays 6 s under the robot with 0
 * errors; a seed's placeholders report `drawn: false` with name tags; a dial changes the running game; a
 * twist toggles; the Ask card says the AI is off; Look inside: a changed number runs, and a syntax error
 * shows on its line while the world keeps its last version. Not one request leaves the app.
 */
import type { Page } from '@playwright/test';
import { expect, gotoRoute, openAmble, test } from '../helpers/app';
import { aiFixture } from '../helpers/mockAi';
import { firstFrames, gameFrame, keyOfRole, openSeed, outsideRequests, readGame, storedWorld } from './journey';

interface RobotResult {
  name: string;
  pass: boolean;
  reasons: string[];
  errors: unknown[];
}

test('every starter and every world type plays under the robot with 0 errors', async ({ page, guards, baseURL }) => {
  test.setTimeout(420_000);
  await openAmble(page, { clean: true });
  expect(await page.evaluate(() => (window as unknown as { __amble: { services: { ai: { status(): string } } } }).__amble.services.ai.status())).toBe('off');
  const plan = JSON.parse(aiFixture('plan-snail.json')) as unknown;
  const results = await page.evaluate(async (planReply) => {
    type World = { id: string };
    const a = (window as unknown as {
      __amble: {
        getState(): { prefs: unknown };
        services: {
          starters: { list(): Array<{ id: string }>; open(id: string, o: { withArt: boolean }): Promise<{ world: World; art: unknown[]; blobs: Blob[] }> };
          store: { commit(c: unknown): Promise<void> };
          player: { robot(init: unknown): Promise<{ raw: { errors: unknown[] }; verdict: { pass: boolean; reasons: string[] } }> };
        };
      };
    }).__amble;
    const urls = ['/src/world/init.ts', '/src/app/player/prefs.ts', '/src/world/warmup.ts'];
    const [{ toInitMessage }, { playerPrefsFrom }, { warmupCode }] = (await Promise.all(urls.map((u) => import(/* @vite-ignore */ u)))) as [{ toInitMessage(w: unknown, o: unknown): Promise<unknown> }, { playerPrefsFrom(p: unknown): Record<string, unknown> }, { warmupCode(p: unknown): unknown }];
    const out: RobotResult[] = [];
    const robot = async (name: string, world: unknown) => {
      const init = await toInitMessage(world, { mode: 'robot', prefs: { ...playerPrefsFrom(a.getState().prefs), muted: true }, robot: { gameMs: 6000, seed: 1, bot: 'auto' }, autostart: true });
      const r = await a.services.player.robot(init);
      out.push({ name, pass: r.verdict.pass, reasons: r.verdict.reasons, errors: r.raw.errors });
    };
    for (const s of a.services.starters.list()) {
      const full = await a.services.starters.open(s.id, { withArt: true });
      await a.services.store.commit({ worlds: [full.world], art: full.art, blobs: full.blobs });
      await robot(`${s.id} starter`, full.world);
      await robot(`${s.id} seed`, (await a.services.starters.open(s.id, { withArt: false })).world);
    }
    await robot('parade', (await a.services.starters.open('parade', { withArt: false })).world);
    const seed = (await a.services.starters.open('moon-king', { withArt: false })).world;
    await robot('warm-up', { ...seed, code: warmupCode(planReply), cast: {} });
    return out;
  }, plan);
  expect(results.length).toBeGreaterThanOrEqual(12);
  for (const r of results) expect({ name: r.name, pass: r.pass, reasons: r.reasons, errors: r.errors }).toEqual({ name: r.name, pass: true, reasons: [], errors: [] });
  expect(outsideRequests(guards.egress, new URL(baseURL!).origin)).toEqual([]);
});

test('a seed plays as just bones; dials, twists and the off Ask card work with no AI', async ({ page, guards, baseURL }) => {
  test.setTimeout(180_000);
  await openAmble(page, { clean: true });
  await openSeed(page, 'moon-king');
  const frame = await gameFrame(page);

  // Placeholders: nothing is drawn, and every character on screen wears its name tag.
  const seen = await frame.evaluate(() => {
    const g = (window as unknown as { __ambleGame: { objects(): Array<{ key: string | null; drawn: boolean }>; manifest(): { art: Array<{ key: string; kind: string }> }; game: { textures: { exists(k: string): boolean } } } }).__ambleGame;
    const characters = new Set(g.manifest().art.filter((x) => x.kind === 'character').map((x) => x.key));
    const objects = g.objects();
    const shown = [...new Set(objects.map((o) => o.key).filter((k): k is string => !!k && characters.has(k)))];
    return { objects: objects.length, drawn: objects.filter((o) => o.drawn).map((o) => o.key), shown, untagged: shown.filter((k) => !g.game.textures.exists(`~tag:${k}`)) };
  });
  expect(seen.objects).toBeGreaterThan(0);
  expect(seen.drawn).toEqual([]);
  expect(seen.shown.length).toBeGreaterThan(0);
  expect(seen.untagged).toEqual([]);

  // The Ask card says the AI is off, and points at what still works.
  await expect(page.getByTestId('ask-card')).toContainText('The AI helper is off here.');

  // A dial changes the running game at once.
  await page.getByRole('radio', { name: 'Change' }).click();
  const hero = await keyOfRole(page, 'hero');
  await page.getByTestId(`tag-${hero.key}`).click();
  const dial = await page.evaluate((k) => {
    const d = (window as unknown as { __amble: { getState(): { session: { manifest: { dials: Array<{ key: string; label: string; for?: string; live: boolean; step: number; current: number }> } | null } } } }).__amble
      .getState()
      .session.manifest?.dials.find((x) => x.for === k && x.live);
    return d ? { key: d.key, label: d.label, step: d.step, current: d.current } : null;
  }, hero.key);
  expect(dial).not.toBeNull();
  const inGame = () => frame.evaluate((k) => (window as unknown as { __ambleGame: { dial(n: string): number | undefined } }).__ambleGame.dial(k), dial!.key);
  await page.getByRole('slider', { name: dial!.label }).focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await expect.poll(inGame).toBe(dial!.current + 2 * dial!.step);
  await page.keyboard.press('Escape');

  // A twist switches on in the running game, and off again.
  const tune = page.getByTestId('tune-card');
  await tune.getByRole('radio', { name: 'Twists' }).click();
  const twist = tune.getByRole('switch').first();
  await twist.click();
  await expect(twist).toHaveAttribute('aria-checked', 'true');
  await expect.poll(() => readGame(frame, (g) => g.twists().length)).toBe(1);
  await twist.click();
  await expect.poll(() => readGame(frame, (g) => g.twists().length)).toBe(0);
  expect(outsideRequests(guards.egress, new URL(baseURL!).origin)).toEqual([]);
});

/** Scrolls the editor until a line with `text` is rendered (CodeMirror draws only what is in view). */
async function revealLine(page: Page, text: string) {
  const line = page.locator('.cm-line', { hasText: text });
  if (!(await line.count())) {
    await page.locator('.cm-content').focus();
    await page.keyboard.press('Control+f');
    await page.keyboard.type(text);
    await page.keyboard.press('Enter');
    await page.keyboard.press('Escape');
  }
  await expect(line.first()).toBeVisible();
  return line.first();
}

test('Look inside: a changed number runs; a syntax error shows on its line and the world keeps its version', async ({ page }) => {
  test.setTimeout(180_000);
  await openAmble(page, { clean: true });
  const worldId = await openSeed(page, 'moon-king');
  const source = (await storedWorld(page, worldId))!.code.find((f) => f.path === 'game.js')!.source;
  expect(source).toContain('gravity: 1500');
  await gotoRoute(page, `#/w/${worldId}/code`);
  await expect(page.locator('.cm-content')).toBeVisible();
  const runBar = page.getByTestId('run-bar');
  await expect(runBar).toContainText('This is the code your world is running.');

  // Change a number and run it: the world plays the change.
  const frames = await firstFrames(page);
  await (await revealLine(page, 'gravity: 1500')).getByText('1500', { exact: true }).dblclick();
  await page.keyboard.type('1200');
  await expect(runBar).toContainText('You changed game.js. Press Run it to play it.');
  await page.getByTestId('run-it').click();
  await expect(runBar).toContainText('Your changes are running!');
  await expect.poll(() => firstFrames(page), { timeout: 60_000 }).toBeGreaterThan(frames);
  const frame = await gameFrame(page);
  await expect.poll(() => frame.evaluate(() => (window as unknown as { __ambleGame: { scene: { physics?: { world: { gravity: { y: number } } } } | null } }).__ambleGame.scene?.physics?.world.gravity.y ?? null)).toBe(1200);
  const ran = (await storedWorld(page, worldId))!;
  expect(ran.code.find((f) => f.path === 'game.js')!.source).toContain('gravity: 1200');
  expect(ran.steps.at(-1)?.text).toBe('You changed game.js');

  // A syntax error: a diagnostic on its line; Run it refuses and nothing changes.
  const line = ran.code.find((f) => f.path === 'game.js')!.source.split('\n').findIndex((l) => l.includes('gravity: 1200')) + 1;
  await (await revealLine(page, 'gravity: 1200')).click();
  await page.keyboard.press('End');
  await page.keyboard.type(' )(');
  await expect(page.locator('.problem--error').first()).toContainText(new RegExp(`line ${line}(?!\\d)`, 'i'));
  const framesBefore = await firstFrames(page);
  await page.getByTestId('run-it').click();
  await expect(runBar).toContainText(new RegExp(`Not running your changes yet: \\d+ problems? on line ${line}( of game\\.js)?\\.`));
  const kept = (await storedWorld(page, worldId))!;
  expect(kept.code).toEqual(ran.code);
  expect(kept.steps).toEqual(ran.steps);
  expect(await firstFrames(page)).toBe(framesBefore);
});
