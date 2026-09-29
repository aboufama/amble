/**
 * Dials and twists matched on the device (§5.10): a wish that only moves a dial or flips a twist happens at
 * once with no request, and its toast offers Undo and Make a wish instead. When wishes rest, the box is one
 * quiet line: no field, no set-up button, no machine words; Dials and Twists still work.
 */
import { expect, openAmble, test } from '../helpers/app';
import { mockAi } from '../helpers/mockAi';
import { ask, mountHarness, openFixtureWorld, outcomeOf, type AmbleWindow } from './harness';

const dialOf = (page: import('@playwright/test').Page, key: string) =>
  page.evaluate((k) => (window as unknown as AmbleWindow).__amble.getState().session.world.dials[k] ?? null, key);

test('"make the jump higher" turns the dial with no request; Undo puts it back', async ({ page }) => {
  const ai = await mockAi(page, { patches: [] });
  await openAmble(page, { ai: 'mock', clean: true });
  await openFixtureWorld(page);
  await mountHarness(page);

  await ask(page, 'make the jump higher');
  const toast = page.getByTestId('ai-steer');
  await expect(toast).toContainText('Turned Jump power up to 860.');
  await expect(toast).not.toContainText(/\bAI\b/);
  expect(await dialOf(page, 'jump')).toBe(860);
  await expect(page.getByTestId('ai-field')).toHaveValue('');
  // Nothing opened and nothing was sent.
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(ai.requests).toHaveLength(0);

  await toast.getByRole('button', { name: 'Undo' }).click();
  await expect(toast).toBeHidden();
  expect(await dialOf(page, 'jump')).toBe(720);
});

test('a twist by name, and Make a wish instead sends the same words as a wish', async ({ page }) => {
  const ai = await mockAi(page, { patches: ['change-stomp.patch'] });
  await openAmble(page, { ai: 'mock', clean: true });
  const id = await openFixtureWorld(page);
  await mountHarness(page);

  await ask(page, 'turn on moon gravity');
  await expect(page.getByTestId('ai-steer')).toContainText('Switched on Moon gravity.');
  const twists = await page.evaluate(() => (window as unknown as AmbleWindow).__amble.getState().session.world.twists);
  expect(twists).toContain('moonGravity');

  await page.getByTestId('ai-steer').getByRole('button', { name: 'Make a wish instead' }).click();
  expect(await outcomeOf(page, id)).toBe('accepted');
  expect(ai.tasks('change')).toHaveLength(1);
  expect(ai.tasks('change')[0].userText).toContain('<<<\nturn on moon gravity\n>>>');
  const after = await page.evaluate(() => (window as unknown as AmbleWindow).__amble.getState().session.world.twists);
  expect(after).not.toContain('moonGravity');
});

test('with wishes off, the box is one quiet line: no field, no set-up button, no machine words', async ({ page }) => {
  await openAmble(page, { clean: true });
  await openFixtureWorld(page);
  await mountHarness(page);

  const box = page.getByTestId('ai-ask');
  await expect(box).toHaveAttribute('data-state', 'off');
  await expect(page.getByTestId('ai-status')).toHaveText('Wishes are resting right now. Dials and Twists still work.');
  await expect(page.getByTestId('ai-field')).toHaveCount(0);
  await expect(page.getByTestId('ai-send')).toHaveCount(0);
  await expect(page.getByTestId('wish-how')).toHaveCount(0);
  await expect(box.getByRole('button')).toHaveCount(0);
  await expect(box.getByRole('link')).toHaveCount(0);
  await expect(box).not.toContainText(/\bAI\b|set up/i);
});
