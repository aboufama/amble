/**
 * Creating a world with the AI, end to end (§2.5, §5, §10.2 `ai-create`), against the mocked class AI
 * service: an idea → the plan card → **Draw Shelly while I build** → the Desk with the build pill while
 * the build runs → the build is robot-tested and accepted → the Desk's preview plays the real game → Bring
 * to life → the world plays with Shelly in it. Every request carries the class code in its header and
 * `store: false`, and never the student's name or their footsteps; What Amble sends lists exactly them.
 */
import { expect, gotoRoute, openAmble, test } from '../helpers/app';
import { CLASS_CODE, mockAi } from '../helpers/mockAi';
import { deskReady, drawnIn, drawOnDesk, gameFrame, worldReady } from './journey';

const IDEA = 'a snail who rescues her friends from a grumpy salt king';

test('idea → plan → draw while it builds → tested build → Bring to life → the world plays', async ({ page }) => {
  test.setTimeout(300_000);
  const ai = await mockAi(page, { plan: 'plan-snail.json', patches: ['build-moon-king.patch'], chunkDelayMs: 20 });
  await openAmble(page, { ai: 'mock', clean: true, prefs: { seen: { aiExplainer: Date.now() } } });
  await page.evaluate(() => {
    // What the player is asked to run from here on (the first line of each game.js).
    const w = window as unknown as { __amble: { services: { player: { load(i: unknown): Promise<unknown> } } }; __loads: string[] };
    const p = w.__amble.services.player;
    const load = p.load.bind(p);
    w.__loads = [];
    p.load = (init: unknown) => {
      const game = (init as { files: Array<{ name: string; source: string }> }).files.find((f) => f.name === 'game.js');
      w.__loads.push(game?.source.split('\n')[0] ?? '');
      return load(init);
    };
  });

  await gotoRoute(page, '#/new?idea=1');
  await page.getByTestId('idea-field').fill(IDEA);
  await page.getByTestId('idea-go').click();
  const card = page.getByTestId('plan-card');
  await expect(card).toContainText("Shelly's Big Rescue");
  await expect(card).toContainText('The Salt King');

  // Draw Shelly while Amble builds: the Desk opens on the hero, with the build pill.
  await page.getByTestId('plan-draw').click();
  await expect(page).toHaveURL(/#\/w\/w_[A-Za-z0-9_-]+\/draw\/hero$/);
  const worldId = /#\/w\/(w_[A-Za-z0-9_-]+)\//.exec(page.url())![1];
  await deskReady(page);
  const pill = page.getByTestId('ai-build-pill');
  await expect(pill).toBeVisible();

  // The build is robot-tested and accepted while the student draws.
  await drawOnDesk(page);
  await expect(pill).toHaveAttribute('data-state', 'ready', { timeout: 180_000 });
  await expect(pill).toHaveText('Your world is ready · tested');
  const built = await page.evaluate((id) => (window as unknown as { __amble: { store: { worlds: { get(id: string): Promise<{ code: Array<{ path: string; source: string }>; steps: Array<{ by: string; kind: string }> } | null> } } } }).__amble.store.worlds.get(id), worldId);
  expect(built?.code.find((f) => f.path === 'game.js')?.source.startsWith('// MOON KING')).toBe(true);
  expect(built?.steps.at(-1)).toMatchObject({ by: 'ai', kind: 'ask' });

  // The preview plays the real game (not the Warm-up) with the drawing in it.
  const loadsBefore = await page.evaluate(() => (window as unknown as { __loads: string[] }).__loads.length);
  const toWorld = page.locator('.preview__switch');
  if (await toWorld.isVisible()) await toWorld.click();
  await expect(page.getByTestId('desk-preview-slot')).toBeVisible();
  await expect.poll(() => page.evaluate((n) => (window as unknown as { __loads: string[] }).__loads.slice(n), loadsBefore), { timeout: 60_000 }).toContainEqual(expect.stringContaining('MOON KING'));

  // Bring to life: back in the world, which plays with Shelly as its hero.
  await page.getByTestId('bring-to-life').click();
  await page.waitForFunction((id) => location.hash === `#/w/${id}`, worldId, { timeout: 60_000 });
  await worldReady(page);
  const frame = await gameFrame(page);
  await expect.poll(() => drawnIn(frame, 'hero'), { timeout: 30_000 }).toBe(true);

  // Over the wire: the plan and the build, each with the class code in its header and store: false; never
  // the class's name, a drawing, or the world's footsteps.
  const sent = ai.requests.filter((r) => r.kind === 'plan' || r.kind === 'patch');
  expect(sent.map((r) => (r.kind === 'plan' ? 'plan' : r.task))).toEqual(['plan', 'build']);
  for (const r of sent) {
    expect(r.headers['x-amble-class']).toBe(CLASS_CODE);
    expect(r.raw).not.toContain(CLASS_CODE);
    expect(r.body.store).toBe(false);
    expect(r.raw).not.toContain('Test class');
    expect(r.raw).not.toMatch(/data:image|a_[a-z0-9]{10}/);
    expect(r.raw).not.toContain('You started');
  }
  expect(ai.errors).toEqual([]);

  // What Amble sends lists exactly those requests.
  await gotoRoute(page, '#/sent');
  const items = page.getByTestId('ai-sent-item');
  await expect(items).toHaveCount(sent.length);
  expect((await items.evaluateAll((els) => els.map((e) => e.getAttribute('data-kind')))).sort()).toEqual(['build', 'plan']);
});
