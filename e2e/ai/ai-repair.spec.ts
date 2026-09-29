/**
 * The robot test and the repair loop (§5.8) in the real player: a change whose boss.js throws on line 3 is
 * caught by the robot test and repaired once; two failed repairs end in Failed with the world untouched
 * and the details (file and line) for the curious.
 */
import { expect, openAmble, test } from '../helpers/app';
import { FIXTURE_FACTS, mockAi } from '../helpers/mockAi';
import { ask, askState, mountHarness, openStarterWorld, outcomeOf, skipExplainer, storedWorld } from './harness';

/** boss.js again, still throwing on line 3. */
const STILL_BROKEN = `@@amble-patch 1
@@summary I tried to fix the stomp.
@@safety ok
@@file boss.js replace
// The Moon King's stomp: the ground shakes when he lands.
function moonKingStomp(scene, boss) {
  const power = boss.stompPower.amount + 1;
  if (scene.clock % 3000 < 20) scene.fx.shake(power);
}
@@end
`;

test('a runtime error found by the robot test is repaired once', async ({ page }) => {
  const ai = await mockAi(page, { patches: ['change-throws.patch', 'fix-ok.patch'] });
  await openAmble(page, { ai: 'mock', clean: true });
  const id = await openStarterWorld(page);
  await mountHarness(page);
  await skipExplainer(page);

  await ask(page, 'make the moon king stomp');
  expect(await outcomeOf(page, id)).toBe('accepted');

  const fixes = ai.tasks('fix');
  expect(fixes).toHaveLength(1);
  const { file, line } = FIXTURE_FACTS.throwsAt;
  expect(fixes[0].userText).toMatch(/^Task: fix\n/);
  expect(fixes[0].userText).toContain(`- ${file}:${line}:`);
  expect(fixes[0].userText).toMatch(/>\s*3 \| {3}const power = boss\.stompPower\.amount;/);
  expect(fixes[0].body.max_completion_tokens).toBe(6000);

  const outcome = await page.evaluate(() => (window as unknown as { __amble: { getState(): { ai: { lastOutcome: { repairs: number; tested: boolean } } } } }).__amble.getState().ai.lastOutcome);
  expect(outcome).toMatchObject({ repairs: 1, tested: true });
  const boss = (await storedWorld(page, id)).code.find((f: { path: string }) => f.path === 'boss.js');
  expect(boss.source).toContain('boss.stompPower ? boss.stompPower.amount : 4');
  expect(ai.errors).toEqual([]);
});

test('two failed repairs: Failed, the world just like before, and the details', async ({ page }) => {
  // Each repair changes boss.js, and each version still throws on line 3.
  const ai = await mockAi(page, { patches: ['change-throws.patch', { text: STILL_BROKEN }, { text: STILL_BROKEN.replace('amount + 1', 'amount + 2') }] });
  await openAmble(page, { ai: 'mock', clean: true });
  const id = await openStarterWorld(page);
  await mountHarness(page);
  await skipExplainer(page);
  const before = (await storedWorld(page, id)).code;

  await ask(page, 'make the moon king stomp');
  expect(await outcomeOf(page, id, 120_000)).toBe('failed');
  expect(ai.tasks('fix')).toHaveLength(2);

  await expect(askState(page)).toHaveAttribute('data-state', 'failed');
  await expect(page.getByTestId('ai-failed')).toContainText("Amble couldn't make that work this time. Your world is just like before.");
  await expect(page.getByTestId('ai-field')).toHaveValue('make the moon king stomp');
  await page.getByRole('button', { name: 'Details' }).click();
  await expect(page.getByTestId('ai-details')).toContainText('boss.js line 3');
  expect((await storedWorld(page, id)).code).toEqual(before);
});
