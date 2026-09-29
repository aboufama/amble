/**
 * Layout (§2.2, §10.2 `layout`): at the four sizes (1366x768, 1366x657 a Chrome tab, 1280x800 touch,
 * 1280x600 small) the page never scrolls and each screen's key controls are on screen: the First page, the
 * Trail, the world in Play and in Change, the Desk, Bones, Look inside, Hand in and the Teacher desk.
 * Two dialogs and the in-app pages reflow at 320 px, and 130 % text breaks nothing at 1280x600.
 */
import type { Locator, Page } from '@playwright/test';
import { expect, gotoRoute, openAmble, test } from '../helpers/app';
import { openStarter } from './journey';

const SIZES = [
  { name: '1366x768', width: 1366, height: 768, touch: false },
  { name: '1366x657 tab', width: 1366, height: 657, touch: false },
  { name: '1280x800 touch', width: 1280, height: 800, touch: true },
  { name: '1280x600 small', width: 1280, height: 600, touch: false },
] as const;

/** The page itself never scrolls (screens scroll inside their own panels). */
async function noPageScroll(page: Page, where: string): Promise<void> {
  const box = await page.evaluate(() => ({ h: document.scrollingElement!.scrollHeight, w: document.scrollingElement!.scrollWidth, ih: innerHeight, iw: innerWidth }));
  expect(box.h, `${where}: page height`).toBeLessThanOrEqual(box.ih);
  expect(box.w, `${where}: page width`).toBeLessThanOrEqual(box.iw);
}

/** Each control is rendered and lies inside the window. */
async function onScreen(page: Page, where: string, controls: Locator[]): Promise<void> {
  const size = page.viewportSize()!;
  for (const c of controls) {
    await expect(c, where).toBeVisible();
    const b = (await c.boundingBox())!;
    expect(b.x, `${where}: left edge`).toBeGreaterThanOrEqual(-1);
    expect(b.y, `${where}: top edge`).toBeGreaterThanOrEqual(-1);
    expect(b.x + b.width, `${where}: right edge`).toBeLessThanOrEqual(size.width + 1);
    expect(b.y + b.height, `${where}: bottom edge`).toBeLessThanOrEqual(size.height + 1);
  }
}

/** Lets entrances finish (a sheet slides in from 24 px below): measured boxes are where things rest. */
async function settled(page: Page): Promise<void> {
  await page.evaluate(() =>
    Promise.race([
      Promise.all(
        document
          .getAnimations()
          .filter((a) => a.effect?.getComputedTiming().iterations !== Infinity)
          .map((a) => a.finished.catch(() => undefined)),
      ),
      new Promise((r) => setTimeout(r, 3000)),
    ]),
  );
}

async function check(page: Page, where: string, controls: Locator[]): Promise<void> {
  await settled(page);
  await onScreen(page, where, controls);
  await noPageScroll(page, where);
}

for (const size of SIZES) {
  test.describe(size.name, () => {
    test.use({ viewport: { width: size.width, height: size.height }, hasTouch: size.touch });

    test('every screen fits with its key controls on screen', async ({ page }) => {
      test.setTimeout(240_000);
      await openAmble(page, { clean: true });
      await check(page, 'First page', [page.getByTestId('first-board'), page.getByTestId('bring-to-life')]);

      const id = await openStarter(page, 'moon-king');
      const small = size.width < 1280 || size.height < 620;
      await check(page, 'world, Play', [
        page.getByTestId('world-slot'),
        page.getByRole('radio', { name: 'Play' }),
        page.getByRole('radio', { name: 'Change' }),
        page.getByTestId('cast-line'),
        small ? page.getByTestId('world-drawer-open') : page.getByTestId('ask-card'),
      ]);
      await page.getByRole('radio', { name: 'Change' }).click();
      await check(page, 'world, Change', [page.getByTestId('change-layer'), page.getByRole('radio', { name: 'Play' })]);
      await page.keyboard.press('Escape');

      await gotoRoute(page, `#/w/${id}/draw/grumble`);
      await expect(page.locator('.desk__sheet canvas').first()).toBeVisible();
      await check(page, 'Desk', [page.getByTestId('desk-board'), page.getByTestId('bring-to-life')]);

      await gotoRoute(page, `#/w/${id}/bones/hero`);
      await check(page, 'Bones', [page.getByRole('button', { name: 'Done' }), page.getByTestId('bones-preview')]);

      await gotoRoute(page, `#/w/${id}/code`);
      await expect(page.locator('.cm-content')).toBeVisible();
      await check(page, 'Look inside', [page.locator('.cm-scroller'), page.getByTestId('run-it')]);

      await gotoRoute(page, `#/w/${id}/handin`);
      const sheet = page.getByRole('dialog', { name: /^Hand in your world/ });
      await check(page, 'Hand in', [sheet, sheet.getByTestId('turned-in')]);
      await page.keyboard.press('Escape');
      await expect(page).toHaveURL(new RegExp(`#/w/${id}$`));

      await gotoRoute(page, '#/teacher/link');
      await check(page, 'Teacher desk', [page.locator('.teacher-tabs'), page.getByTestId('teacher-classlink').getByRole('heading').first()]);

      // Last: an untouched starter world is let go when the student leaves it for the Trail.
      await gotoRoute(page, '#/trail');
      await check(page, 'Trail', [page.getByTestId('trail-sign').first()]);
    });
  });
}

test.describe('320 px wide', () => {
  test.use({ viewport: { width: 320, height: 640 } });

  test('dialogs reflow: nothing is cut off sideways', async ({ page }) => {
    test.setTimeout(120_000);
    await openAmble(page, { clean: true });
    const id = await openStarter(page, 'moon-king');
    for (const open of [
      async () => {
        await page.getByRole('button', { name: 'More for this world' }).click();
        await page.getByRole('menuitem', { name: 'World info' }).click();
      },
      async () => gotoRoute(page, `#/w/${id}/handin`),
    ]) {
      await open();
      const dialog = page.getByRole('dialog').first();
      await expect(dialog).toBeVisible();
      const b = (await dialog.boundingBox())!;
      expect(b.x).toBeGreaterThanOrEqual(0);
      expect(b.x + b.width).toBeLessThanOrEqual(321);
      expect(await dialog.evaluate((d) => d.scrollWidth <= d.clientWidth + 1)).toBe(true);
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).toHaveCount(0);
    }
  });

  test('the in-app pages reflow: only tables and code scroll sideways, inside their own boxes', async ({ page }) => {
    test.setTimeout(120_000);
    await openAmble(page, { clean: true });
    for (const name of ['privacy', 'terms', 'ai', 'it', 'parents', 'accessibility', 'poster', 'sent', 'whatsnew']) {
      await gotoRoute(page, `#/${name}`);
      await expect(page.getByTestId(`screen-page-${name}`).getByRole('heading', { level: 1 })).toBeVisible();
      const cut = await page.evaluate(() =>
        [...document.querySelectorAll('body *')]
          .filter((el) => {
            const b = el.getBoundingClientRect();
            if (!b.width || !b.height || el.closest('pre, .page__table-wrap')) return false;
            return b.left < -1 || b.right > innerWidth + 1;
          })
          .slice(0, 3)
          .map((el) => `${el.tagName.toLowerCase()}.${[...el.classList].join('.')}`),
      );
      expect(cut, `#/${name}: cut off sideways`).toEqual([]);
      expect(await page.evaluate(() => document.scrollingElement!.scrollWidth <= innerWidth), `#/${name}: page width`).toBe(true);
    }
  });
});

test.describe('130 % text at 1280x600', () => {
  test.use({ viewport: { width: 1280, height: 600 } });

  test('large text breaks nothing', async ({ page }) => {
    test.setTimeout(120_000);
    await openAmble(page, { clean: true, prefs: { textScale: 1.3 } });
    await expect.poll(() => page.evaluate(() => document.documentElement.dataset.text)).toBe('1.3');
    const id = await openStarter(page, 'moon-king');
    await check(page, 'world at 130 %', [page.getByTestId('world-slot'), page.getByRole('radio', { name: 'Play' }), page.getByTestId('cast-line')]);
    await gotoRoute(page, `#/w/${id}/draw/grumble`);
    await expect(page.locator('.desk__sheet canvas').first()).toBeVisible();
    await check(page, 'Desk at 130 %', [page.getByTestId('desk-board'), page.getByTestId('bring-to-life')]);
    await gotoRoute(page, '#/trail');
    await check(page, 'Trail at 130 %', [page.getByTestId('trail-sign').first()]);
  });
});
