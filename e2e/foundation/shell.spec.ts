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
      ...PAGES.map((p): [string, string] => [`#/${p}`, `screen-page-${p}`]),
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
    await openStarterWorld(page);
    const layer = page.getByTestId('player-layer');
    await expect(layer).toHaveAttribute('data-first-frame', /^[1-9]\d*$/, { timeout: 45_000 });
    await expect(layer).toHaveAttribute('data-slot', 'world');
    const [slot, box] = await Promise.all([page.getByTestId('world-slot').boundingBox(), layer.boundingBox()]);
    expect(slot && box).toBeTruthy();
    expect(Math.abs(slot!.x - box!.x)).toBeLessThan(2);
    expect(Math.abs(slot!.width - box!.width)).toBeLessThan(2);
    const game = await gameFrame(page);
    const info = await game.evaluate(() => {
      const g = (window as unknown as GameWin).__ambleGame;
      return { state: g.state, errors: g.errors.length, hero: !!g.find('hero') };
    });
    expect(info.errors).toBe(0);
    expect(['title', 'running']).toContain(info.state);
    expect(info.hero).toBe(true);
  });

  test('a drawn character with bones plays through the rig mesh', async ({ page }) => {
    await openAmble(page);
    await openStarterWorld(page);
    await expect(page.getByTestId('player-layer')).toHaveAttribute('data-first-frame', /^[1-9]\d*$/, { timeout: 45_000 });
    // A stick figure drawn on a canvas, rigged by the rig worker, swapped into the running game.
    const rigged = await page.evaluate(async () => {
      const c = new OffscreenCanvas(160, 240);
      const g = c.getContext('2d')!;
      g.lineWidth = 10;
      g.lineCap = 'round';
      g.strokeStyle = '#2b1d16';
      g.fillStyle = '#7cc7ef';
      g.beginPath();
      g.arc(80, 40, 26, 0, Math.PI * 2);
      g.fill();
      g.stroke();
      const line = (x0: number, y0: number, x1: number, y1: number) => {
        g.beginPath();
        g.moveTo(x0, y0);
        g.lineTo(x1, y1);
        g.stroke();
      };
      line(80, 66, 80, 150);
      line(80, 90, 30, 130);
      line(80, 90, 130, 130);
      line(80, 150, 50, 230);
      line(80, 150, 110, 230);
      const png = await c.convertToBlob({ type: 'image/png' });
      const { rigWorker } = await import(/* @vite-ignore */ `${location.origin}/src/cores/rig.ts`);
      const reply = await rigWorker.autoRig({ image: png }, { kind: 'biped' });
      const host = (window as unknown as { __amble: { services: { player: { swapArt(a: unknown): void; on(t: string, fn: (m: unknown) => void): () => void } } } }).__amble.services.player;
      const swapped = new Promise((resolve) => host.on('swapped', resolve));
      host.swapArt({ key: 'hero', image: png, rig: reply.rig });
      await swapped;
      return { bones: reply.rig.bones.length, confidence: reply.confidence };
    });
    expect(rigged.bones).toBeGreaterThan(5);
    const game = await gameFrame(page);
    const visual = await game.evaluate(() => {
      const g = (window as unknown as GameWin).__ambleGame;
      const hero = g.find('hero') as { visual?: { constructor: { name: string }; object: { type: string } } } | null;
      return { kind: hero?.visual?.constructor.name ?? null, object: hero?.visual?.object.type ?? null, errors: g.errors.length, swaps: g.swaps };
    });
    expect(visual.errors).toBe(0);
    expect(visual.swaps).toBeGreaterThan(0);
    // The rig's Phaser mesh (MeshCharacter under WebGL, CutoutCharacter under Canvas), not the kit's sprite puppet.
    expect(['MeshCharacter', 'CutoutCharacter']).toContain(visual.kind);
  });
});

/** What the runtime exposes for tests inside the game frame (window.__ambleGame). */
interface GameHook {
  state: string;
  errors: unknown[];
  swaps: number;
  game: unknown;
  find(key: string): unknown;
}
type GameWin = Window & { __ambleGame: GameHook };

/** The visible game's frame, once its runtime is up. */
async function gameFrame(page: import('@playwright/test').Page): Promise<import('@playwright/test').Frame> {
  const handle = await page.evaluateHandle(() => (window as unknown as { __amble: { services: { player: { player: { iframe: HTMLIFrameElement | null } | null } } } }).__amble.services.player.player?.iframe ?? null);
  const frame = await handle.asElement()?.contentFrame();
  if (!frame) throw new Error('No game frame.');
  await frame.waitForFunction(() => !!(window as unknown as GameWin).__ambleGame?.game);
  return frame;
}
