/**
 * The app frame (§8.3 step 6): every route of §2.1 renders its screen, unknown hashes land on the Trail,
 * the class-link fragment is read and stripped, a starter world reaches its first frame in the player
 * layer at the world slot (once the player core has merged), the frame's landmarks and live regions are
 * there, and nothing leaves the app (the `test` fixture fails on any outside request, native dialog or
 * page error).
 */
import { classLinkPayload, expect, gotoRoute, openAmble, test, TEST_CLASS, waitForApp } from '../helpers/app';
import { mockAi } from '../helpers/mockAi';

const PAGES = ['privacy', 'terms', 'ai', 'it', 'parents', 'accessibility', 'poster', 'sent', 'whatsnew'];
const SETTINGS = ['ai', 'sound', 'reading', 'drawing', 'keys', 'storage', 'about'];
const TEACHER = ['link', 'assignments', 'gallery', 'help', 'present'];

/** Opens a starter and returns the new world's id (the route becomes `#/w/<id>`). */
async function openStarterWorld(page: import('@playwright/test').Page): Promise<string> {
  await gotoRoute(page, '#/starter/moon-king');
  await expect(page).toHaveURL(/#\/w\/[A-Za-z0-9_-]+$/);
  await expect(page.getByTestId('screen-world')).toBeVisible();
  return new URL(page.url()).hash.replace('#/w/', '');
}

test.describe('app shell', () => {
  test('every route renders its screen', async ({ page }) => {
    await openAmble(page);
    const simple: Array<[string, string]> = [
      ['#/first', 'screen-first'],
      ['#/trail', 'screen-trail'],
      ['#/trail/list', 'screen-trail'],
      ['#/trail/lost', 'screen-trail'],
      ['#/new', 'screen-new'],
      ['#/new?idea=1', 'screen-new'],
      ['#/plan', 'screen-plan'],
      ['#/draw/new', 'screen-draw'],
      ['#/bones/a_test000001', 'screen-bones'],
      ['#/settings', 'screen-settings'],
      ...SETTINGS.map((s): [string, string] => [`#/settings/${s}`, 'screen-settings']),
      ...TEACHER.map((tab): [string, string] => [`#/teacher/${tab}`, 'screen-teacher']),
      ...PAGES.map((p): [string, string] => [`#/${p}`, 'screen-page']),
      ['#/', 'screen-home'],
    ];
    for (const [hash, id] of simple) {
      await gotoRoute(page, hash);
      await expect(page.getByTestId(id), hash).toBeVisible();
      await expect(page.locator('main#main'), hash).toHaveCount(1);
    }

    const worldId = await openStarterWorld(page);
    const inWorld: Array<[string, string]> = [
      [`#/w/${worldId}/draw/hero`, 'screen-draw'],
      [`#/w/${worldId}/bones/hero`, 'screen-bones'],
      [`#/w/${worldId}/code`, 'screen-code'],
      [`#/w/${worldId}/code/game.js`, 'screen-code'],
      [`#/w/${worldId}`, 'screen-world'],
    ];
    for (const [hash, id] of inWorld) {
      await gotoRoute(page, hash);
      await expect(page.getByTestId(id), hash).toBeVisible();
    }
    // Hand in is a sheet over the running world.
    await gotoRoute(page, `#/w/${worldId}/handin`);
    await expect(page.getByTestId('screen-handin')).toBeVisible();
    await expect(page.getByTestId('screen-world')).toHaveCount(1);
  });

  test('an unknown hash lands on the Trail with a toast', async ({ page }) => {
    await openAmble(page);
    await gotoRoute(page, '#/no-such-place');
    await expect(page).toHaveURL(/#\/trail$/);
    await expect(page.getByTestId('screen-trail')).toBeVisible();
    await expect(page.getByTestId('toasts')).toContainText("That page isn't here.");
  });

  test('the frame has its landmarks, skip link and live regions', async ({ page }) => {
    // A fresh load (not a route change), so focus starts at the top of the page.
    await page.goto('./#/settings');
    await waitForApp(page);
    await expect(page.getByRole('banner')).toHaveCount(1);
    await expect(page.getByRole('main')).toHaveCount(1);
    await expect(page.getByTestId('live-polite')).toHaveAttribute('aria-live', 'polite');
    await expect(page.getByTestId('live-assertive')).toHaveAttribute('aria-live', 'assertive');
    await expect(page.getByTestId('player-layer')).toHaveCount(1);
    await expect(page.getByTestId('ai-chip')).toContainText('AI helper');
    await page.keyboard.press('Tab');
    const skip = page.getByRole('link', { name: 'Skip to main content' });
    await expect(skip).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('main#main')).toBeFocused();
    await expect(page).toHaveTitle('Settings · Amble');
  });

  test('a route change moves focus to the new screen', async ({ page }) => {
    await openAmble(page, { route: '#/settings' });
    await page.getByRole('link', { name: 'Trail' }).click();
    await expect(page.getByTestId('screen-trail')).toBeVisible();
    await expect(page.locator('main#main')).toBeFocused();
  });

  test('back and forward follow the hash', async ({ page }) => {
    await openAmble(page, { route: '#/settings' });
    await gotoRoute(page, '#/trail');
    await page.goBack();
    await expect(page.getByTestId('screen-settings')).toBeVisible();
    await page.goForward();
    await expect(page.getByTestId('screen-trail')).toBeVisible();
  });

  test('the class link is read, stripped before render, and joins the class', async ({ page }) => {
    const ai = await mockAi(page);
    await openAmble(page, { ai: 'mock' });
    expect(new URL(page.url()).hash).toBe('#/');
    const stored = await page.evaluate(() => (window as unknown as { __amble: { getState(): { config: { classLink: { cls: string } | null } } } }).__amble.getState().config.classLink);
    expect(stored?.cls).toBe(TEST_CLASS.cls);
    expect(ai.errors).toEqual([]);
  });

  test('a damaged or expired class link is stripped and explained', async ({ page }) => {
    await page.goto('./#class=%%%');
    await waitForApp(page);
    expect(new URL(page.url()).hash).toBe('#/');
    await expect(page.getByRole('dialog')).toContainText('damaged');
    await page.getByRole('button', { name: 'Go to Amble' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);

    await page.goto(`./#class=${classLinkPayload({ ...TEST_CLASS, exp: '2020-01-01' })}`);
    await waitForApp(page);
    expect(new URL(page.url()).hash).toBe('#/');
    await expect(page.getByRole('dialog')).toContainText('expired');
  });

  test('prefs apply to the page', async ({ page }) => {
    await openAmble(page, { prefs: { theme: 'day', textScale: 1.3, reduceMotion: 'on' } });
    const html = page.locator('html');
    await expect(html).toHaveAttribute('data-theme', 'day');
    await expect(html).toHaveAttribute('data-text', '1.3');
    await expect(html).toHaveAttribute('data-motion', 'reduced');
    await expect(html).toHaveAttribute('data-layout', 'full');
    // Saved to the store, so a reload keeps them.
    await page.waitForFunction(async () => {
      const prefs = await (window as unknown as { __amble: { store: { settings: { get(k: string): Promise<{ theme?: string } | null> } } } }).__amble.store.settings.get('prefs');
      return prefs?.theme === 'day';
    });
    await page.reload();
    await waitForApp(page);
    await expect(html).toHaveAttribute('data-theme', 'day');
  });

  test('a starter world reaches its first frame at the world slot', async ({ page }) => {
    await openAmble(page);
    const cores = await page.evaluate(() => (window as unknown as { __amble: { cores: Record<string, string> } }).__amble.cores);
    test.skip(cores.play === 'stub', 'The player core has not merged yet.');
    await openStarterWorld(page);
    const layer = page.getByTestId('player-layer');
    await expect(layer).toHaveAttribute('data-first-frame', 'true', { timeout: 30_000 });
    const [slot, box] = await Promise.all([page.getByTestId('world-slot').boundingBox(), layer.boundingBox()]);
    expect(slot && box).toBeTruthy();
    expect(Math.abs(slot!.x - box!.x)).toBeLessThan(2);
    expect(Math.abs(slot!.width - box!.width)).toBeLessThan(2);
  });
});
