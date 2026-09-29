/**
 * Seam M5 + M2 (§8.6): Ask → change → robot test → new version card → footstep, in the world screen
 * itself. The student asks in the world's Ask card while playing; the AI's change is applied, robot-tested in
 * the spare frame (the game on screen keeps running), and waits as "New version ready" until the student
 * says **Play it now**; then the new version plays and the footstep carries their words and "tested".
 */
import { expect, openAmble, test } from '../helpers/app';
import { CLASS_CODE, mockAi } from '../helpers/mockAi';
import { firstFrames, footsteps, gameFrame, gameSource, JUMP_SUMMARY as SUMMARY, jumpPatch, openSeed, readGame, startGame } from '../journeys/journey';

const WORDS = 'let me jump three times';

test('a change asked in the world is robot-tested, waits as a new version, plays, and is a footstep', async ({ page }) => {
  test.setTimeout(240_000);
  const ai = await mockAi(page, { chunkDelayMs: 30 });
  await openAmble(page, { ai: 'mock', clean: true, prefs: { seen: { aiExplainer: Date.now() } } });
  const worldId = await openSeed(page, 'moon-king');
  ai.queue({ text: jumpPatch(await gameSource(page)) });

  // Playing: the game is running when the student asks.
  const frame = await gameFrame(page);
  await startGame(page, frame);
  const loadsBefore = await firstFrames(page);
  const card = page.getByTestId('ask-card');
  await card.getByTestId('ai-field').fill(WORDS);
  await card.getByTestId('ai-send').click();
  await expect(card.getByTestId('ai-progress')).toBeVisible();

  // Keep playing while the AI works (a key now and then), so the new version has to wait for the student.
  await page.locator('body').focus();
  const version = page.getByTestId('new-version');
  for (let i = 0; i < 90 && !(await version.isVisible()); i++) {
    await page.keyboard.press('ArrowLeft');
    await page.waitForTimeout(1000);
  }
  await expect(version).toContainText(`New version ready: ${SUMMARY}`);
  // The card has its corner to itself: a request tag waits until it is gone.
  await expect(page.getByTestId('request-tag')).toHaveCount(0);
  const outcome = await page.evaluate(() => (window as unknown as { __amble: { getState(): { ai: { lastOutcome: { kind: string; tested?: boolean } | null } } } }).__amble.getState().ai.lastOutcome);
  expect(outcome).toMatchObject({ kind: 'accepted', tested: true });

  // The toast that came with it (toasts go by themselves after a few seconds): its See the change shows
  // this change in the Footsteps sheet (as the footstep's link does), and goes.
  const toast = page.locator('.toast', { hasText: 'Amble changed your world' });
  await toast.getByRole('button', { name: 'See the change' }).click();
  await expect(page.getByTestId('diff-sheet')).toContainText(WORDS);
  await expect(page.getByTestId('diff-sheet')).toContainText('game.js');
  await expect(toast).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('diff-sheet')).toHaveCount(0);
  // The game on screen was not replaced while the change was tested.
  expect(await firstFrames(page)).toBe(loadsBefore);
  expect(await readGame(frame, (g) => g.state)).toBe('running');

  // Play it now: the new version loads and plays.
  await version.getByRole('button', { name: 'Play it now' }).click();
  await expect(version).toHaveCount(0);
  await expect.poll(() => firstFrames(page), { timeout: 60_000 }).toBeGreaterThan(loadsBefore);
  const after = await page.evaluate((id) => (window as unknown as { __amble: { store: { worlds: { get(id: string): Promise<{ code: Array<{ path: string; source: string; authors: Array<[string, number]> }>; steps: Array<{ kind: string; by: string; text: string; request?: string; tested?: boolean }> } | null> } } } }).__amble.store.worlds.get(id), worldId);
  const code = after?.code.find((f) => f.path === 'game.js');
  expect(code?.source).toContain('jumps: 3');
  expect(code?.authors.some(([who]) => who === 'ai')).toBe(true);
  expect(after?.steps.at(-1)).toMatchObject({ kind: 'ask', by: 'ai', text: SUMMARY, request: WORDS, tested: true });

  // The footstep: the AI's words, the student's, and ✓ tested.
  const step = footsteps(page).first();
  await expect(step).toContainText(SUMMARY);
  await expect(step).toContainText(`You asked: "${WORDS}"`);
  await expect(step).toContainText('tested');

  // One change request, the class code only in its header, never the student's name or drawings.
  const changes = ai.tasks('change');
  expect(changes).toHaveLength(1);
  expect(changes[0].headers['x-amble-class']).toBe(CLASS_CODE);
  expect(changes[0].raw).not.toContain(CLASS_CODE);
  expect(changes[0].body.store).toBe(false);
  expect(changes[0].userText).toContain(WORDS);
  expect(ai.errors).toEqual([]);
});
