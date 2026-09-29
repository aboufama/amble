/**
 * The world in Play (§2.6): the running game at the world slot with the controls row, the Cast line and
 * the notebook; keys typed on the page play the game; renaming; Restart; the ⋯ menu and World info; the
 * request tag at a pause (and Later); full screen; nothing leaves the app.
 */
import { expect, test } from '../helpers/app';
import { gameFrame, openWorld, readGame, session, startGame } from './world';

test.describe('the world in Play', () => {
  test('shows the game, the controls row, the Cast line and the notebook', async ({ page }) => {
    await openWorld(page);
    const slot = page.getByTestId('world-slot');
    await expect(slot).toHaveAttribute('id', 'game');
    const layer = page.getByTestId('player-layer');
    await expect(layer).toHaveAttribute('data-slot', 'world');
    const [a, b] = await Promise.all([slot.boundingBox(), layer.boundingBox()]);
    expect(Math.abs(a!.x - b!.x)).toBeLessThan(2);
    expect(Math.abs(a!.width - b!.width)).toBeLessThan(2);
    expect(a).toMatchObject({ x: 20, y: 66, width: 880, height: 495 });

    await expect(page.getByTestId('world-name')).toContainText('Moon King');
    await expect(page.getByTestId('save-state')).toBeVisible();
    await expect(page.getByRole('radiogroup', { name: 'Play or change the world' })).toBeVisible();
    await expect(page.getByRole('radio', { name: 'Play' })).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByRole('list', { name: 'Keys for this game' })).toContainText('jump');

    const cast = page.getByTestId('cast-line');
    await expect(cast).toContainText('Cast');
    const hero = page.getByTestId('cast-card-hero');
    await expect(hero).toHaveAttribute('data-status', 'needed');
    await expect(hero).toHaveClass(/cast-card--glow/);
    await expect(hero).toHaveAccessibleName('Pip, Hero, not drawn yet. Press Enter to draw.');
    await expect(page.getByTestId('cast-add')).toBeVisible();
    await expect(page.getByTestId('ask-card')).toContainText('Change your world');
    await expect(page.locator('.skip-link')).toHaveText('Skip to the game');
    // The page never scrolls.
    expect(await page.evaluate(() => document.scrollingElement!.scrollHeight <= innerHeight)).toBe(true);
  });

  test('an arrow shows when Cast cards are out of view, and brings Add someone into view', async ({ page }) => {
    await openWorld(page);
    const more = page.getByTestId('cast-more');
    await expect(more).toBeVisible();
    await more.click();
    await expect
      .poll(
        async () => {
          const [add, row] = await Promise.all([page.getByTestId('cast-add').boundingBox(), page.locator('.cast-line__cards').boundingBox()]);
          return add!.x + add!.width <= row!.x + row!.width + 1;
        },
        { timeout: 15_000 },
      )
      .toBe(true);
    await expect(more).toHaveCount(0);
    await expect(page.locator('.cast-line__more--before')).toBeVisible();
  });

  test('keys typed on the page play the game; Restart restarts the level', async ({ page }) => {
    await openWorld(page);
    const frame = await gameFrame(page);
    await startGame(page, frame);
    const x0 = await readGame(frame, (g) => (g.find('hero') as unknown as { x: number }).x);
    await page.keyboard.down('ArrowRight');
    await expect.poll(() => readGame(frame, (g) => (g.find('hero') as unknown as { x: number }).x), { timeout: 15_000 }).toBeGreaterThan(x0 + 5);
    await page.keyboard.up('ArrowRight');
    const creates = await readGame(frame, (g) => g.createCount);
    await page.getByTestId('world-restart').click();
    await expect.poll(() => readGame(frame, (g) => g.createCount)).toBeGreaterThan(creates);
  });

  test('renames the world inline and keeps the name', async ({ page }) => {
    const id = await openWorld(page);
    await page.getByTestId('world-name').click();
    const input = page.getByTestId('world-name-input');
    await input.fill('Pizza Moon');
    await input.press('Enter');
    await expect(page.getByTestId('world-name')).toContainText('Pizza Moon');
    await expect
      .poll(() => page.evaluate(async (wid) => (await (window as unknown as { __amble: { store: { worlds: { get(id: string): Promise<{ title: string } | null> } } } }).__amble.store.worlds.get(wid))?.title, id))
      .toBe('Pizza Moon');
  });

  test('the ⋯ menu opens World info with the credits line', async ({ page }) => {
    await openWorld(page);
    await page.getByRole('button', { name: 'More for this world' }).click();
    const menu = page.getByRole('menu');
    for (const item of ['Look inside', 'Sounds', 'Controls', 'Problems', 'Share as a web page', 'Make a copy', 'World info', 'Help']) {
      await expect(menu.getByRole('menuitem', { name: item })).toBeVisible();
    }
    await menu.getByRole('menuitem', { name: 'World info' }).click();
    const info = page.getByRole('dialog', { name: 'World info' });
    await expect(info).toContainText('Art by you · Code by the AI helper and you · Starter:');
    await page.keyboard.press('Escape');
    await expect(info).toHaveCount(0);
  });

  test('the request tag asks for a drawing at a pause, and Later snoozes it', async ({ page }) => {
    await openWorld(page);
    const frame = await gameFrame(page);
    await startGame(page, frame);
    await page.keyboard.press('p');
    const tag = page.getByTestId('request-tag');
    await expect(tag).toBeVisible({ timeout: 15_000 });
    await expect(tag).toContainText('is only bones.');
    await tag.getByRole('button', { name: 'Later' }).click();
    await expect(tag).toHaveCount(0);
    const snoozed = await session(page, (s) => {
      const w = s.world as unknown as { cast: Record<string, { laterUntil: number }> };
      return Object.values(w.cast).filter((c) => c.laterUntil > Date.now()).length;
    });
    expect(snoozed).toBe(1);
  });

  test('full screen shows only the game, with an Exit button; Esc leaves it', async ({ page }) => {
    await openWorld(page);
    await page.getByTestId('world-fullscreen').click();
    await expect(page.getByTestId('world-view')).toHaveAttribute('data-player-fullscreen', '');
    await expect(page.getByTestId('world-exit-fullscreen')).toBeVisible();
    const layer = await page.getByTestId('player-layer').boundingBox();
    expect(layer!.width).toBeGreaterThan(1300);
    await page.getByTestId('world-exit-fullscreen').click();
    await expect(page.getByTestId('world-view')).not.toHaveAttribute('data-player-fullscreen', '');
  });
});
