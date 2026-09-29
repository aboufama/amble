/**
 * The Trail (§2.4): the student's worlds stand first, the most recently opened leading, then the Starter
 * worlds signpost and the starters; signs are one tab stop with arrow keys between them; the List view
 * sorts by recent or by name; Put away (Shift+F10) sends a world to Lost and found, and Bring it back
 * puts it back on the Trail. On a first visit the starters' heroes stand on the trail at once, and no
 * walker ever crosses a sign's name.
 */
import type { Page } from '@playwright/test';
import { expect, gotoRoute, openAmble, test } from '../helpers/app';

interface StoreLike {
  commit(c: { worlds: unknown[] }): Promise<unknown>;
  worlds: { list(): Promise<Array<{ id: string; putAwayAt: number | null }>> };
}

/** Makes worlds through the app's own code (a Boss fight seed each), opened `daysAgo` days ago. */
async function makeWorlds(page: Page, worlds: Array<{ title: string; daysAgo: number }>): Promise<string[]> {
  return page.evaluate(async (list) => {
    const origin = location.origin;
    const { openSeed } = await import(/* @vite-ignore */ `${origin}/src/home/createWorld.ts`);
    const { refreshLibrary } = await import(/* @vite-ignore */ `${origin}/src/state/library.ts`);
    const store = (window as unknown as { __amble: { store: StoreLike } }).__amble.store;
    const ids: string[] = [];
    for (const { title, daysAgo } of list) {
      const w = (await openSeed('moon-king', null)) as { id: string };
      const at = Date.now() - daysAgo * 86_400_000;
      await store.commit({ worlds: [{ ...w, title, openedAt: at, updatedAt: at }] });
      ids.push(w.id);
    }
    await refreshLibrary(store);
    return ids;
  }, worlds);
}

const WORLDS = [
  { title: 'Moss Run', daysAgo: 3 },
  { title: 'Apple Tower', daysAgo: 1 },
  { title: 'Zig Zag', daysAgo: 2 },
];

test.beforeEach(async ({ page }) => {
  await openAmble(page);
});

test('signs: recent worlds first, then the starters, one tab stop with arrow keys', async ({ page }) => {
  const [moss, apple, zig] = await makeWorlds(page, WORLDS);
  await gotoRoute(page, '#/trail');
  const signs = page.getByTestId('trail-sign');
  await expect(signs.first()).toBeVisible();
  const order = await signs.evaluateAll((els) => els.map((e) => e.getAttribute('data-world') ?? `starter:${e.getAttribute('data-starter')}`));
  expect(order.slice(0, 3)).toEqual([apple, zig, moss]);
  const starters = order.slice(3);
  expect(starters.length).toBeGreaterThanOrEqual(4);
  for (const s of starters) expect(s).toMatch(/^starter:[a-z-]+$/);
  expect(starters).not.toContain('starter:parade');
  await expect(page.getByText('Starter worlds', { exact: true })).toBeVisible();

  // One tab stop; the arrows, Home and End walk the trail.
  await expect(page.locator('[data-testid="trail-sign"][tabindex="0"]')).toHaveCount(1);
  await signs.first().focus();
  await page.keyboard.press('ArrowRight');
  await expect(signs.nth(1)).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(signs.nth(2)).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(signs.nth(1)).toBeFocused();
  await page.keyboard.press('End');
  await expect(signs.last()).toBeFocused();
  await page.keyboard.press('Home');
  await expect(signs.first()).toBeFocused();
  await expect(page.locator('[data-testid="trail-sign"][tabindex="0"]')).toHaveCount(1);

  // Enter opens the world.
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(new RegExp(`#/w/${apple}$`));
  await expect(page.getByTestId('screen-world')).toBeVisible();
});

test('the List view sorts by recent and by name, and goes back to the Trail', async ({ page }) => {
  await makeWorlds(page, WORLDS);
  await gotoRoute(page, '#/trail');
  await page.getByTestId('trail-list').click();
  await expect(page).toHaveURL(/#\/trail\/list$/);
  const view = page.getByTestId('trail-list-view');
  await expect(view).toBeVisible();
  const names = view.locator('.world-card__name');
  await expect(names).toHaveText(['Apple Tower', 'Zig Zag', 'Moss Run']);
  await view.getByRole('radio', { name: 'Name' }).click();
  await expect(names).toHaveText(['Apple Tower', 'Moss Run', 'Zig Zag']);
  await view.getByRole('radio', { name: 'Recent' }).click();
  await expect(names).toHaveText(['Apple Tower', 'Zig Zag', 'Moss Run']);

  // Home remembers the List view until the student walks back.
  await gotoRoute(page, '#/');
  await expect(page.getByTestId('trail-list-view')).toBeVisible();
  await page.getByTestId('back-to-trail').click();
  await expect(page.getByTestId('screen-trail')).toHaveAttribute('data-view', 'trail');
  await expect(page.getByTestId('trail-sign').first()).toBeVisible();
});

test('Put away sends a world to Lost and found, and Bring it back restores it', async ({ page }) => {
  const [moss] = await makeWorlds(page, WORLDS);
  await gotoRoute(page, '#/trail');
  const sign = page.locator(`[data-testid="trail-sign"][data-world="${moss}"]`);
  await expect(sign).toBeVisible();
  await sign.focus();
  await page.keyboard.press('Shift+F10');
  await page.getByTestId('sign-menu-putAway').click();
  const confirm = page.getByRole('dialog');
  await expect(confirm).toContainText('Put Moss Run in Lost and found?');
  await confirm.getByRole('button', { name: 'Put away', exact: true }).click();
  await expect(sign).toHaveCount(0);
  await expect(page.getByText('Moss Run is in Lost and found.')).toBeVisible();
  await expect(page.getByTestId('trail-sign')).not.toHaveCount(0);

  await gotoRoute(page, '#/trail/lost');
  const item = page.getByTestId('lost-item');
  await expect(item).toHaveCount(1);
  await expect(item).toContainText('Moss Run');
  await expect(item).toContainText('30 days left');
  await item.getByTestId('bring-back').click();
  await expect(item).toHaveCount(0);
  await expect(page.getByTestId('lost-view')).toContainText('Nothing here.');

  await gotoRoute(page, '#/trail');
  await expect(page.locator(`[data-testid="trail-sign"][data-world="${moss}"]`)).toBeVisible();
  const kept = await page.evaluate(async () => (await (window as unknown as { __amble: { store: StoreLike } }).__amble.store.worlds.list()).map((w) => w.putAwayAt));
  expect(kept).toEqual([null, null, null]);
});

test("a returning student's Trail opens on their own worlds, even when they are read after the first paint", async ({ page }) => {
  const [moss] = await makeWorlds(page, WORLDS.slice(0, 1));
  await gotoRoute(page, '#/trail');
  const scroller = page.locator('.trail__scroller');
  await expect(page.locator(`[data-testid="trail-sign"][data-world="${moss}"]`)).toBeVisible();
  // As on a fresh load: the Trail paints before the worlds are read from storage, then they arrive.
  await page.evaluate(() =>
    (window as unknown as { __amble: { setState(fn: (s: { library: { loaded: boolean; worlds: unknown[]; characters: unknown[] } }) => void): void } }).__amble.setState((s) => {
      s.library.loaded = false;
      s.library.worlds = [];
      s.library.characters = [];
    }),
  );
  await page.waitForTimeout(400);
  await expect(page.locator('.trail-copy')).toBeHidden();
  await page.evaluate(async () => {
    const { refreshLibrary } = await import(/* @vite-ignore */ `${location.origin}/src/state/library.ts`);
    await refreshLibrary((window as unknown as { __amble: { store: StoreLike } }).__amble.store);
  });
  const sign = page.locator(`[data-testid="trail-sign"][data-world="${moss}"]`);
  await expect(sign).toBeInViewport();
  expect(await scroller.evaluate((el) => el.scrollLeft)).toBe(0);
  await expect(page.locator('.trail-copy')).toBeVisible();
});

/** Walkers whose box crosses a sign's board (the board's name and date must stay readable). */
async function walkersOnBoards(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const boards = [...document.querySelectorAll('.sign__board')].map((b) => ({ name: b.querySelector('.sign__title')?.textContent ?? '', r: b.getBoundingClientRect() }));
    const out: string[] = [];
    for (const w of document.querySelectorAll('[data-testid="walker"]')) {
      const r = w.getBoundingClientRect();
      for (const b of boards) if (r.left < b.r.right && r.right > b.r.left && r.top < b.r.bottom && r.bottom > b.r.top) out.push(`${w.getAttribute('aria-label')} on ${b.name}`);
    }
    return out;
  });
}

for (const size of [
  { width: 1366, height: 768 },
  { width: 1366, height: 657 },
]) {
  test(`a first visit's starter walkers stand on the trail at once, clear of the sign names (${size.width}x${size.height})`, async ({ page }) => {
    await page.setViewportSize(size);
    // Still walkers (reduced motion), so what is measured is where they stand.
    await openAmble(page, { clean: true, prefs: { seen: { firstPage: Date.now() }, reduceMotion: 'on' } });
    await gotoRoute(page, '#/trail');
    await expect(page.getByTestId('trail-sign').first()).toBeVisible();
    // A cold profile: the heroes stand there as their drawings before any walk is baked.
    await expect.poll(() => page.getByTestId('walker').count(), { timeout: 4000 }).toBeGreaterThanOrEqual(4);
    expect(await walkersOnBoards(page)).toEqual([]);
    // And once they walk, they still keep clear.
    await expect.poll(() => page.locator('.walker__sprite').count(), { timeout: 60_000 }).toBeGreaterThanOrEqual(4);
    expect(await walkersOnBoards(page)).toEqual([]);
  });
}
