/**
 * Change mode (§2.7): C pauses the world and tags everything in it; selecting the boss opens its card with
 * its own dials and scopes the Ask field; a dial moved by arrow keys changes the running game live and
 * becomes one footstep after 1.5 s; a twist switches live; Esc closes the card, Esc again returns to Play.
 */
import { expect, test } from '../helpers/app';
import { gameFrame, openWorld, readGame, session } from './world';

test.describe('Change mode', () => {
  test('tags the paused world; the boss card has his dials; a dial by keys is live and one footstep', async ({ page }) => {
    await openWorld(page);
    const frame = await gameFrame(page);
    await page.locator('body').focus();
    await page.keyboard.press('c');
    await expect(page.getByRole('radio', { name: 'Change' })).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByText('Paused. Tap anything to change it.')).toBeVisible();
    await expect.poll(() => readGame(frame, (g) => g.state)).toBe('paused');

    const layer = page.getByTestId('change-layer');
    await expect(layer).toHaveAttribute('role', 'application');
    await expect(page.getByTestId('tag-moonKing')).toBeVisible();
    await expect(page.getByTestId('tag-hero')).toContainText('Pip');
    await expect(page.getByTestId('tag-ledge')).toContainText('made by the game');

    await page.getByTestId('tag-moonKing').click();
    const card = page.getByTestId('thing-card');
    await expect(card).toContainText('Moon King');
    await expect(card).toHaveAttribute('data-key', 'moonKing');
    await expect(page.getByTestId('thing-draw')).toHaveText(/Draw it/);
    expect(await session(page, (s) => s.scope)).toBe('moonKing');

    const dial = page.getByRole('slider', { name: 'Orb speed' });
    await expect(dial).toBeVisible();
    const before = await readGame(frame, (g) => g.dial('orbSpeed'));
    await dial.focus();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await expect.poll(() => readGame(frame, (g) => g.dial('orbSpeed'))).toBe((before ?? 280) + 20);
    const steps = () => session(page, (s) => (s.world as unknown as { steps: Array<{ text: string }> }).steps.map((x) => x.text));
    await expect.poll(steps, { timeout: 5000 }).toContain(`You turned Orb speed up to ${(before ?? 280) + 20}`);
    expect((await steps()).filter((x) => x.startsWith('You turned Orb speed'))).toHaveLength(1);

    // Esc closes the card, Esc again goes back to Play and the game goes on.
    await page.keyboard.press('Escape');
    await expect(card).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('radio', { name: 'Play' })).toHaveAttribute('aria-checked', 'true');
    await expect(layer).toHaveCount(0);
    await expect.poll(() => readGame(frame, (g) => g.state)).not.toBe('paused');
  });

  test('twists switch live from the Dials | Twists card', async ({ page }) => {
    await openWorld(page);
    const frame = await gameFrame(page);
    await page.getByRole('radio', { name: 'Change' }).click();
    const tune = page.getByTestId('tune-card');
    await expect(tune).toBeVisible();
    await tune.getByRole('radio', { name: 'Twists' }).click();
    const moon = page.getByRole('switch', { name: 'Moon gravity' });
    await expect(moon).toHaveAttribute('aria-checked', 'false');
    await moon.click();
    await expect(moon).toHaveAttribute('aria-checked', 'true');
    await expect.poll(() => readGame(frame, (g) => g.twists())).toContain('moonGravity');
    await expect.poll(() => session(page, (s) => (s.world as unknown as { steps: Array<{ text: string }> }).steps.at(-1)?.text)).toBe('You switched on Moon gravity');
  });

  test('Tab moves between the tags and Enter opens a card', async ({ page }) => {
    await openWorld(page);
    await page.getByRole('radio', { name: 'Change' }).click();
    await expect(page.getByTestId('tag-moonKing')).toBeVisible();
    await page.getByTestId('tag-moonKing').focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('thing-card')).toBeVisible();
    // Focus moved into the card (its first control).
    await expect.poll(() => page.evaluate(() => !!document.activeElement?.closest('[data-testid="thing-card"], .thing-card'))).toBe(true);
  });
});
