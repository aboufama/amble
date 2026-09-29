/**
 * Seam M9 + M2 (§8.6): Go back restores art in the running world. Footsteps' Go back takes the world to a
 * step's snapshot (code, drawings, dials), appends a step, and the world screen's game plays that version:
 * going back to before a drawing shows the member as just bones again; going back to the drawing's step
 * brings the very same drawing back into the game.
 */
import type { Page } from '@playwright/test';
import { expect, openAmble, test } from '../helpers/app';
import { deskReady, drawnIn, drawOnDesk, firstFrames, footsteps, gameFrame, keyOfRole, openSeed } from '../journeys/journey';

/** Goes back to the newest step of a kind ('start', 'draw'...), and waits for the game to reload. */
async function goBackTo(page: Page, kind: string): Promise<void> {
  const before = await firstFrames(page);
  const step = page.locator(`.footsteps__trail > .step[data-kind="${kind}"]`).first();
  await step.hover();
  await step.getByRole('button', { name: 'Go back to this step' }).click();
  // The game reloads with that step's world (a fresh realm).
  await expect.poll(() => firstFrames(page), { timeout: 60_000 }).toBeGreaterThan(before);
}

function slotArt(page: Page, key: string): Promise<string | null> {
  return page.evaluate((k) => (window as unknown as { __amble: { getState(): { session: { world: { cast: Record<string, { art: string | null }> } | null } } } }).__amble.getState().session.world?.cast[k]?.art ?? null, key);
}

test('Go back takes a drawing out of the running world and brings it back', async ({ page }) => {
  test.setTimeout(300_000);
  await openAmble(page, { clean: true });
  const worldId = await openSeed(page, 'moon-king');
  const boss = await keyOfRole(page, 'boss');

  await page.getByTestId(`cast-card-${boss.key}`).click();
  await expect(page).toHaveURL(new RegExp(`#/w/${worldId}/draw/${boss.key}$`), { timeout: 20_000 });
  await deskReady(page);
  await drawOnDesk(page);
  await page.getByTestId('bring-to-life').click();
  await page.waitForFunction((id) => location.hash === `#/w/${id}`, worldId, { timeout: 60_000 });
  let frame = await gameFrame(page);
  await expect.poll(() => drawnIn(frame, boss.key), { timeout: 30_000 }).toBe(true);
  const drawing = await slotArt(page, boss.key);
  expect(drawing).not.toBeNull();
  await expect(footsteps(page)).toHaveCount(2);
  await expect(footsteps(page).first()).toHaveAttribute('data-kind', 'draw');

  // Back to the start: the member is just bones again in the running game.
  await goBackTo(page, 'start');
  await expect(footsteps(page)).toHaveCount(3);
  await expect(footsteps(page).first()).toContainText('You went back to');
  expect(await slotArt(page, boss.key)).toBeNull();
  frame = await gameFrame(page);
  await expect.poll(() => drawnIn(frame, boss.key), { timeout: 30_000 }).toBe(false);

  // Back to the drawing's step: the same drawing plays again.
  await goBackTo(page, 'draw');
  await expect(footsteps(page)).toHaveCount(4);
  expect(await slotArt(page, boss.key)).toBe(drawing);
  frame = await gameFrame(page);
  await expect.poll(() => drawnIn(frame, boss.key), { timeout: 30_000 }).toBe(true);

  // Nothing was deleted, and the stored world agrees.
  const stored = await page.evaluate((id) => (window as unknown as { __amble: { store: { worlds: { get(id: string): Promise<{ steps: Array<{ kind: string }>; cast: Record<string, { art: string | null }> } | null> } } } }).__amble.store.worlds.get(id), worldId);
  expect(stored?.steps.map((s) => s.kind)).toEqual(['start', 'draw', 'goback', 'goback']);
  expect(stored?.cast[boss.key]?.art).toBe(drawing);
});
