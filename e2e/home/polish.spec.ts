/**
 * Visual details of the home screens that broke once (QA): the First page column's shadows, the picked
 * world card's ring, the Trail for a student with worlds but no free drawing, and the empty world list.
 */
import type { Page } from '@playwright/test';
import { expect, gotoRoute, openAmble, test } from '../helpers/app';
import { mockAi } from '../helpers/mockAi';

/** Makes worlds from the Boss fight seed with no hero drawn (as "Pick a world" or a plan does). */
async function makeWorlds(page: Page, titles: string[]): Promise<void> {
  await page.evaluate(async (list) => {
    const origin = location.origin;
    const { openSeed } = await import(/* @vite-ignore */ `${origin}/src/home/createWorld.ts`);
    const { refreshLibrary } = await import(/* @vite-ignore */ `${origin}/src/state/library.ts`);
    const store = (window as unknown as { __amble: { store: { commit(c: unknown): Promise<unknown> } } }).__amble.store;
    for (const title of list) {
      const w = (await openSeed('moon-king', null)) as Record<string, unknown>;
      await store.commit({ worlds: [{ ...w, title }] });
    }
    await refreshLibrary(store as never);
  }, titles);
}

test("the First page column leaves room for its cards' and idea box's shadows", async ({ page }) => {
  await openAmble(page, { clean: true });
  await expect(page.getByTestId('screen-first')).toBeVisible();
  const room = await page.evaluate(() => {
    const col = document.querySelector('.first__col')!.getBoundingClientRect();
    const box = document.querySelector('.first-col__idea')!.getBoundingClientRect();
    return { left: box.left - col.left, right: col.right - box.right };
  });
  // The idea box casts a 34 px blur: a scroller edge closer than that cuts it into a hard-edged box.
  expect(room.left).toBeGreaterThanOrEqual(24);
  expect(room.right).toBeGreaterThanOrEqual(24);
});

test('a picked world card keeps its ring while the pointer is still on it', async ({ page }) => {
  await openAmble(page, { clean: true, route: '#/new' });
  const card = page.getByTestId('screen-new').getByRole('radio').first();
  await card.click();
  await expect(card).toHaveAttribute('aria-checked', 'true');
  await card.hover();
  const [shadow, accent] = await card.evaluate((el) => {
    const probe = document.createElement('i');
    probe.style.color = 'var(--accent)';
    document.body.append(probe);
    const c = getComputedStyle(probe).color;
    probe.remove();
    return [getComputedStyle(el).boxShadow, c];
  });
  expect(shadow).toContain(accent);
});

test('a student with worlds but no free drawing is welcomed back with New world', async ({ page }) => {
  await openAmble(page, { clean: true });
  await makeWorlds(page, ['Moss Run']);
  await gotoRoute(page, '#/trail');
  await expect(page.getByRole('heading', { name: 'Welcome back.' })).toBeVisible();
  await expect(page.getByTestId('play-first')).toHaveCount(0);
  // The lamppost still waits for a character.
  await expect(page.getByTestId('lamp-spot')).toContainText('goes here');
  await page.getByTestId('new-world').click();
  await expect(page).toHaveURL(/#\/new$/);
});

test('the empty world list offers a New world', async ({ page }) => {
  await openAmble(page, { clean: true, route: '#/trail/list' });
  const make = page.getByTestId('list-new-world');
  await expect(make).toBeVisible();
  await make.click();
  await expect(page).toHaveURL(/#\/new$/);
  await expect(page.getByTestId('screen-new')).toBeVisible();
});

test('#/new?idea=1 puts the caret in the idea box, not on the sheet\'s close button', async ({ page }) => {
  await mockAi(page);
  await openAmble(page, { clean: true, ai: 'mock', route: '#/new?idea=1' });
  await expect(page.getByTestId('idea-field')).toBeFocused();
});

test.describe('large text on 1280x600', () => {
  test.use({ viewport: { width: 1280, height: 600 } });

  test('the First page cards hold their words at 130 % text', async ({ page }) => {
    await openAmble(page, { clean: true, prefs: { textScale: 1.3 } });
    await expect(page.getByTestId('first-column').locator('.seed-card')).toHaveCount(4);
    const spill = await page.evaluate(() =>
      [...document.querySelectorAll('.first-col__card')].map((li) => li.querySelector('.seed-card__line')!.getBoundingClientRect().bottom - li.querySelector('.seed-card')!.getBoundingClientRect().bottom),
    );
    for (const s of spill) expect(s, 'the world type line stays on its card').toBeLessThanOrEqual(0);
  });
});
