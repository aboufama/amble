/**
 * Slow, filtering school networks (§5.2): a 429 with Retry-After says "Lots of wishes right now" and goes
 * through; a first byte after 120 s still succeeds (no first-byte cutoff); a stall after bytes is cut off
 * after 90 s and continued once; a plain JSON body answering a stream request works; a CORS failure rests
 * the box in one plain line with Try again, which sends the same words. Long waits run on Playwright's clock.
 */
import { expect, openAmble, test } from '../helpers/app';
import { mockAi } from '../helpers/mockAi';
import { ask, askState, mountHarness, openFixtureWorld, outcomeOf, pauseGame, storedWorld } from './harness';

async function ready(page: import('@playwright/test').Page): Promise<string> {
  const id = await openFixtureWorld(page);
  await mountHarness(page);
  return id;
}

test('429 with Retry-After: "Lots of wishes right now", then the wish goes through', async ({ page }) => {
  const ai = await mockAi(page, { patches: [{ status: 429, retryAfter: 3 }, 'change-stomp.patch'] });
  await openAmble(page, { ai: 'mock', clean: true });
  const id = await ready(page);

  await ask(page, 'let me stomp on the minions');
  await expect(page.getByTestId('ai-wait')).toHaveText('Lots of wishes right now. Yours is next in a few seconds.');
  expect(await outcomeOf(page, id)).toBe('accepted');
  expect(ai.tasks('change')).toHaveLength(2);
});

test('a first byte after 120 s still succeeds', async ({ page }) => {
  await page.clock.install();
  const ai = await mockAi(page, { patches: ['change-stomp.patch'], firstByteDelayMs: 120_000 });
  await openAmble(page, { ai: 'mock', clean: true });
  const id = await ready(page);
  await pauseGame(page);

  await ask(page, 'let me stomp on the minions');
  await expect.poll(() => ai.tasks('change').length).toBe(1);
  await expect(askState(page)).toHaveAttribute('data-state', 'working');
  await page.clock.fastForward(119_000);
  await expect(askState(page)).toHaveAttribute('data-state', 'working');
  await page.clock.fastForward(2_000);
  expect(await outcomeOf(page, id)).toBe('accepted');
  expect(ai.tasks('change')).toHaveLength(1);
});

test('a stall after the first bytes is cut off after 90 s and continued once', async ({ page }) => {
  await page.clock.install();
  const ai = await mockAi(page, { patches: ['change-stomp.patch', 'change-stomp.patch'], stallAfterChars: 260 });
  await openAmble(page, { ai: 'mock', clean: true });
  const id = await ready(page);
  await pauseGame(page);

  await ask(page, 'let me stomp on the minions');
  await expect.poll(() => ai.tasks('change').length).toBe(1);
  await expect(page.getByTestId('ai-progress')).toHaveAttribute('data-phase', 'writing');
  ai.set({ stallAfterChars: undefined });
  await page.clock.fastForward(91_000);
  expect(await outcomeOf(page, id)).toBe('accepted');
  expect(ai.tasks('continue')).toHaveLength(1);
  expect(ai.tasks('continue')[0].userText).toMatch(/^Task: continue\n/);
  const game = (await storedWorld(page, id)).code.find((f: { path: string }) => f.path === 'game.js');
  expect(game.source).toContain('stomp: true');
});

test('a plain JSON body answering a stream request is read as the whole reply', async ({ page }) => {
  const ai = await mockAi(page, { patches: ['change-stomp.patch'], jsonForStream: true });
  await openAmble(page, { ai: 'mock', clean: true });
  const id = await ready(page);

  await ask(page, 'let me stomp on the minions');
  expect(await outcomeOf(page, id)).toBe('accepted');
  expect(ai.tasks('change')[0].stream).toBe(true);
});

test('a CORS failure rests the box in one plain line, and Try again sends the same words', async ({ page }) => {
  await page.clock.install();
  const ai = await mockAi(page, { patches: ['change-stomp.patch'], networkError: true });
  await openAmble(page, { ai: 'mock', clean: true });
  const id = await ready(page);
  await pauseGame(page);

  await ask(page, 'let me stomp on the minions');
  // The transport retries network errors (2 s, 5 s, 12 s, with jitter) before it gives up.
  for (let i = 0; i < 8; i++) {
    if (await page.getByTestId('ai-status').isVisible()) break;
    await page.clock.fastForward(20_000);
    await page.waitForTimeout(300);
  }
  expect(await outcomeOf(page, id)).toBe('unavailable');
  await expect(askState(page)).toHaveAttribute('data-state', 'blocked');
  await expect(page.getByTestId('ai-status')).toContainText("Wishes can't get through right now. Dials and Twists still work.");
  await expect(page.getByTestId('ai-field')).toHaveCount(0);
  expect(ai.errors).toEqual([]);

  // The filter lets it through again: Try again sends the words the student wrote.
  ai.set({ networkError: false });
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect.poll(() => ai.tasks('change').length, { timeout: 30_000 }).toBeGreaterThan(0);
  expect(ai.tasks('change').at(-1)!.userText).toContain('<<<\nlet me stomp on the minions\n>>>');
  expect(await outcomeOf(page, id)).toBe('accepted');
});
