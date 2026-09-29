/**
 * Local steering (§5.10): an Ask that only moves a dial or flips a twist is answered on the device with no
 * AI call and the steer toast (Undo, Ask the AI instead); with the AI off the matcher still works, and
 * anything else says it needs the AI helper.
 */
import { expect, openAmble, test } from '../helpers/app';
import { mockAi } from '../helpers/mockAi';
import { ask, mountHarness, openFixtureWorld, outcomeOf, skipExplainer, type AmbleWindow } from './harness';

const dialOf = (page: import('@playwright/test').Page, key: string) =>
  page.evaluate((k) => (window as unknown as AmbleWindow).__amble.getState().session.world.dials[k] ?? null, key);

test('"make the jump higher" turns the dial with no AI call; Undo puts it back', async ({ page }) => {
  const ai = await mockAi(page, { patches: [] });
  await openAmble(page, { ai: 'mock', clean: true });
  await openFixtureWorld(page);
  await mountHarness(page);

  await ask(page, 'make the jump higher');
  const toast = page.getByTestId('ai-steer');
  await expect(toast).toHaveText(/Turned Jump power up to 860\. No AI needed\./);
  expect(await dialOf(page, 'jump')).toBe(860);
  await expect(page.getByTestId('ai-field')).toHaveValue('');
  // No explainer, no request: nothing went to the AI helper.
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(ai.requests).toHaveLength(0);

  await toast.getByRole('button', { name: 'Undo' }).click();
  await expect(toast).toBeHidden();
  expect(await dialOf(page, 'jump')).toBe(720);
});

test('a twist by name, and Ask the AI instead sends the same words as a change', async ({ page }) => {
  const ai = await mockAi(page, { patches: ['change-stomp.patch'] });
  await openAmble(page, { ai: 'mock', clean: true });
  const id = await openFixtureWorld(page);
  await mountHarness(page);
  await skipExplainer(page);

  await ask(page, 'turn on moon gravity');
  await expect(page.getByTestId('ai-steer')).toHaveText(/Switched on Moon gravity\. No AI needed\./);
  const twists = await page.evaluate(() => (window as unknown as AmbleWindow).__amble.getState().session.world.twists);
  expect(twists).toContain('moonGravity');

  await page.getByTestId('ai-steer').getByRole('button', { name: 'Ask the AI instead' }).click();
  expect(await outcomeOf(page, id)).toBe('accepted');
  expect(ai.tasks('change')).toHaveLength(1);
  expect(ai.tasks('change')[0].userText).toContain('<<<\nturn on moon gravity\n>>>');
  const after = await page.evaluate(() => (window as unknown as AmbleWindow).__amble.getState().session.world.twists);
  expect(after).not.toContain('moonGravity');
});

test('with the AI off, dials still turn; other wishes say they need the AI helper', async ({ page }) => {
  await openAmble(page, { clean: true });
  await openFixtureWorld(page);
  await mountHarness(page);

  await expect(page.getByTestId('ai-ask')).toHaveAttribute('data-state', 'off');
  await expect(page.getByTestId('ai-status')).toContainText('The AI helper is off here. You can still draw, turn the Dials, flip Twists and change the code (⋯ → Look inside).');
  await ask(page, 'make the jump a lot higher');
  await expect(page.getByTestId('ai-steer')).toHaveText(/Turned Jump power up to 1000\. No AI needed\./);
  await ask(page, 'add lava that rises');
  await expect(page.getByText('That needs the AI helper. You can change it in Look inside, or try a twist.')).toBeVisible();
});
