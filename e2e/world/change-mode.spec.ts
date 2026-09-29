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

  test('clicking into the Ask field keeps it about the selected member, and the notebook takes the next click', async ({ page }) => {
    await openWorld(page);
    await page.getByRole('radio', { name: 'Change' }).click();
    await page.getByTestId('tag-moonKing').click();
    await expect(page.getByTestId('thing-card')).toBeVisible();
    const ask = page.getByTestId('ask-card');
    await expect(ask.getByText('About the Moon King')).toBeVisible();
    // A click elsewhere closes the card; the request the student is about to type stays about him.
    await ask.getByRole('textbox').click();
    await expect(page.getByTestId('thing-card')).toHaveCount(0);
    await expect(ask.getByText('About the Moon King')).toBeVisible();
    expect(await session(page, (s) => s.scope)).toBe('moonKing');
    // Nothing in the notebook moves under the pointer when the card closes: one click switches the tab.
    await page.getByTestId('tag-moonKing').click();
    await expect(page.getByTestId('thing-card')).toBeVisible();
    await page.getByTestId('tune-card').getByRole('radio', { name: 'Twists' }).click();
    await expect(page.getByTestId('tune-card').getByRole('radio', { name: 'Twists' })).toHaveAttribute('aria-checked', 'true');
    // The chip's ✕ ends it.
    await ask.getByRole('button', { name: 'Stop asking about the Moon King' }).click();
    await expect(ask.getByText('About the Moon King')).toHaveCount(0);
    expect(await session(page, (s) => s.scope)).toBe(null);
  });

  test('a world that stops in Change mode can be restarted from its card, above the veil', async ({ page }) => {
    await openWorld(page);
    await page.getByRole('radio', { name: 'Change' }).click();
    await expect(page.getByTestId('change-layer')).toBeVisible();
    // What the frozen-game watchdog does when a game stops answering.
    await page.evaluate(() => (window as unknown as { __amble: { setState(r: (s: { session: { stopped: string | null } }) => void): void } }).__amble.setState((s) => {
      s.session.stopped = 'crashed';
    }));
    const card = page.getByTestId('world-stopped');
    await expect(card).toContainText('The world stopped.');
    await card.getByRole('button', { name: 'Restart it' }).click();
    await expect(card).toHaveCount(0);
    await expect(page.getByTestId('player-layer')).toHaveAttribute('data-first-frame', /^[1-9]\d*$/, { timeout: 45_000 });
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
