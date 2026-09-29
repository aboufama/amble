/**
 * The degradation ladder (§5.9): a plan call that fails picks the closest starter locally; a build that
 * fails after its repairs ends as the plan's starter with the plan written in, playable, with a paper card.
 */
import { expect, openAmble, test } from '../helpers/app';
import { aiFixture, mockAi } from '../helpers/mockAi';
import { askState, mountHarness, outcomeOf, stepTexts, storedWorld, type AmbleWindow } from './harness';

const BROKEN = '@@amble-patch 1\n@@summary Broken.\n@@safety ok\n@@file game.js create\nclass Game extends Amble.Scene {\n  create() { this.oops( }\n}\n@@end\n';

test('a failed plan call starts from the closest starter', async ({ page }) => {
  await mockAi(page, { plan: { status: 403, body: { error: { message: 'Your class used its AI time for today.', type: 'insufficient_quota', code: 'insufficient_quota' } } } });
  await openAmble(page, { ai: 'mock', clean: true });
  const out = await page.evaluate(() =>
    (window as unknown as AmbleWindow).__amble.services.ai.plan('a boss fight with a giant robot king', { level: 'middle', hero: null, signal: new AbortController().signal, onProgress: () => undefined }),
  );
  expect(out.kind).toBe('fallback');
  expect(out.starter).toBe('moon-king');
  expect(out.message).toMatch(/^The AI helper can't answer right now\. Let's start from a world close to your idea: .+ \(.+\)\. You can change it later\.$/);
});

test('a build that fails after its repairs becomes the plan starter with the plan written in', async ({ page }) => {
  const ai = await mockAi(page, { patches: [{ text: BROKEN }, { text: BROKEN }, { text: BROKEN }] });
  await openAmble(page, { ai: 'mock', clean: true });
  const plan = JSON.parse(aiFixture('plan-snail.json'));
  const id = await page.evaluate(async (p) => {
    const a = (window as unknown as AmbleWindow).__amble;
    const url = '/src/screens/ai/harness.tsx';
    const harness = await import(/* @vite-ignore */ url);
    const world = await harness.planWorld(p);
    a.navigate({ name: 'world', id: world.id });
    void harness.buildPlanWorld(world, p);
    return world.id as string;
  }, plan);
  await mountHarness(page);

  expect(await outcomeOf(page, id, 120_000)).toBe('fallback');
  expect(ai.tasks('build')).toHaveLength(1);
  expect(ai.tasks('fix')).toHaveLength(2);

  const world = await storedWorld(page, id);
  const game = world.code.find((f: { path: string }) => f.path === 'game.js').source as string;
  expect(game).toContain("title: 'Shelly\\'s Big Rescue'");
  // Each plan member plays the Moon King slot it maps to, under the plan's name and ask; the plan's dial
  // label goes on the one starter dial that measures the same thing (Salt speed → orbSpeed).
  expect(game).toMatch(/moonKing: \{[^\n]*name: 'The Salt King'/);
  expect(game).toMatch(/grumble: \{[^\n]*ask: 'Draw a salt crumb'/);
  expect(game).toMatch(/star: \{[^\n]*name: 'Lettuce leaf'/);
  expect(game).toMatch(/orbSpeed: \{[^\n]*label: 'Salt speed'/);
  expect(Object.keys(world.cast)).toEqual(expect.arrayContaining(['hero', 'moonKing', 'grumble', 'star']));
  expect((await stepTexts(page, id)).at(-1)).toMatch(/^Amble started your world from .+ with your ideas\.$/);

  await expect(askState(page)).toContainText("Amble couldn't build all of it, so it started you from");
  await expect(askState(page)).toContainText('Your other characters are waiting on the cast line.');
  await expect(page.getByTestId('ai-build-pill')).toHaveText(/^Your world is ready/);
});
