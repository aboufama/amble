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
    // The one to draw next is the picked tile: Your turn, Scratch's selection edge, and Draw me.
    const hero = page.getByTestId('cast-card-hero');
    await expect(hero).toHaveAttribute('data-status', 'needed');
    await expect(hero).toHaveClass(/cast-card--turn/);
    await expect(hero).toHaveClass(/cast-card--picked/);
    await expect(hero).toContainText('Your turn');
    await expect(hero).toContainText('Draw me');
    await expect(hero).toHaveAccessibleName('Pip, Hero, not drawn yet. Your turn! Press Enter to draw.');
    await expect(page.locator('.cast-card--picked')).toHaveCount(1);
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
    // The click gave the keys back to the game: Space starts it again, it does not press Restart again.
    await expect(page.getByTestId('world-slot')).toBeFocused();
    const restarted = await readGame(frame, (g) => g.createCount);
    await page.keyboard.press('Space');
    await page.waitForTimeout(1500);
    expect(await readGame(frame, (g) => g.createCount)).toBe(restarted);
  });

  test('after a click on Play the arrows go to the game, not the Play | Change switch', async ({ page }) => {
    await openWorld(page);
    await page.getByRole('radio', { name: 'Change' }).click();
    await expect.poll(() => session(page, (s) => s.mode)).toBe('change');
    const play = page.getByRole('radio', { name: 'Play' });
    await play.click();
    await expect.poll(() => session(page, (s) => s.mode)).toBe('play');
    // Under the pointer, the chosen option keeps the words it has when the pointer is away.
    const underPointer = await play.evaluate((el) => getComputedStyle(el).color);
    await page.mouse.move(2, 400);
    await expect.poll(() => play.evaluate((el) => getComputedStyle(el).color)).toBe(underPointer);
    // The keys went back to the game: → is the hero's, it no longer flips the switch back to Change.
    await expect(page.getByTestId('world-slot')).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await expect(play).toHaveAttribute('aria-checked', 'true');
    expect(await session(page, (s) => s.mode)).toBe('play');
    // A keyboard press on Play keeps focus on the switch (the arrows are the group's there).
    await page.getByRole('radio', { name: 'Play' }).focus();
    await page.keyboard.press('Enter');
    await expect(play).toBeFocused();
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
    await expect(info).toContainText('Art by you · Code by Moon King, your wishes and you');
    await expect(info).not.toContainText('AI');
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

  test('running slowly: a small note low in the world with something to do', async ({ page }) => {
    await openWorld(page);
    const frame = await gameFrame(page);
    await startGame(page, frame);
    // What the controller reports after 10 s under 20 fps.
    const patch = (p: Record<string, unknown>) =>
      page.evaluate(async (next) => {
        const m = await import(/* @vite-ignore */ `${location.origin}/src/state/session.ts`);
        m.patchSession(next);
      }, p);
    await patch({ heavy: true });
    const note = page.getByTestId('world-heavy');
    await expect(note).toContainText('Running slowly. Close other tabs, then restart it.');
    await expect(note.getByRole('button', { name: 'Restart' })).toBeVisible();
    // Low in the world view, clear of the HUD at the top.
    const [n, v] = await Promise.all([note.boundingBox(), page.getByTestId('world-slot').boundingBox()]);
    expect(n!.y).toBeGreaterThan(v!.y + v!.height * 0.6);
    expect(n!.y + n!.height).toBeLessThanOrEqual(v!.y + v!.height);
    // A twist that crowds the screen is what it offers to turn off.
    await page.evaluate(async () => {
      const m = await import(/* @vite-ignore */ `${location.origin}/src/state/session.ts`);
      m.setTwist('starRain', true);
    });
    await expect(note).toContainText('Close other tabs, or turn off Rain of stars.');
    await note.getByRole('button', { name: 'Turn off Rain of stars' }).click();
    await expect(note).toHaveCount(0);
    await expect.poll(() => readGame(frame, (g) => g.twists())).not.toContain('starRain');
    // Closed, it stays closed.
    await patch({ heavy: true });
    await page.waitForTimeout(300);
    await expect(note).toHaveCount(0);
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
