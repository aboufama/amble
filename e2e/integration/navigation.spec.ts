/**
 * Moving between screens: the new screen's main region takes focus without drawing a ring (it is not a
 * control; the controls in it still show focus), and a world sign or the First page's paper morphs into
 * the world view, even on the first visit, while the world screen is still loading.
 */
import type { Page } from '@playwright/test';
import { expect, gotoRoute, openAmble, test } from '../helpers/app';

interface Transition {
  pseudo: string[] | null;
  error: string | null;
}

/** Records, for every View Transition, the pseudo-elements that animate (once the transition is ready). */
async function recordTransitions(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const log: Array<{ pseudo: string[] | null; error: string | null }> = [];
    (window as unknown as { __transitions: typeof log }).__transitions = log;
    const doc = document as Document & { startViewTransition?: (update: () => unknown) => { ready: Promise<void> } };
    const real = doc.startViewTransition?.bind(document);
    if (!real) return;
    doc.startViewTransition = (update) => {
      const rec: { pseudo: string[] | null; error: string | null } = { pseudo: null, error: null };
      log.push(rec);
      const t = real(update);
      t.ready.then(
        () => {
          rec.pseudo = [...new Set(document.getAnimations().map((a) => (a.effect as KeyframeEffect | null)?.pseudoElement ?? '').filter(Boolean))];
        },
        (e: unknown) => {
          rec.error = String(e);
        },
      );
      return t;
    };
  });
}

function transitions(page: Page): Promise<Transition[]> {
  return page.evaluate(() => (window as unknown as { __transitions: Transition[] }).__transitions);
}

/** A saved Boss fight world, made by the app's own code (the Trail lists it). */
async function makeWorld(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const origin = location.origin;
    const { openSeed } = await import(/* @vite-ignore */ `${origin}/src/home/createWorld.ts`);
    const { refreshLibrary } = await import(/* @vite-ignore */ `${origin}/src/state/library.ts`);
    const store = (window as unknown as { __amble: { store: { commit(c: unknown): Promise<void> } } }).__amble.store;
    const w = (await openSeed('moon-king', null)) as { id: string };
    await store.commit({ worlds: [{ ...w, title: 'Moss Run', openedAt: Date.now(), updatedAt: Date.now() }] });
    await refreshLibrary(store);
    return w.id;
  });
}

/**
 * Loads the world screen's modules the way its chunk arrives in a built app (already fetched and quick):
 * the dev server compiles them on first use, which alone takes longer than a transition waits.
 */
async function warmWorldScreen(page: Page): Promise<void> {
  await page.evaluate(() => import(/* @vite-ignore */ `${location.origin}/src/screens/world/index.ts`));
}

const MORPH = ['::view-transition-group(world-view)', '::view-transition-old(world-view)', '::view-transition-new(world-view)'];

/**
 * A transition that runs morphs the named pair into the world view. On a busy page (software rendering, as
 * here) the change may run without one, or skip it once the old screen's picture is late, so a tap always
 * answers at once (app/transitions.ts): then only a skip is allowed, never another error.
 */
async function expectMorphOrQuickChange(page: Page, before: number): Promise<void> {
  await page.waitForTimeout(600);
  const [morph] = (await transitions(page)).slice(before);
  if (!morph) return;
  if (morph.error === null) expect(morph.pseudo).toEqual(expect.arrayContaining(MORPH));
  else expect(String(morph.error)).toMatch(/skipped/i);
}

test('the main region takes focus after navigation without a ring; controls still show theirs', async ({ page }) => {
  await openAmble(page);
  await gotoRoute(page, '#/settings');
  await expect.poll(() => page.evaluate(() => document.activeElement?.id)).toBe('main');
  const main = await page.evaluate(() => {
    const el = document.activeElement as HTMLElement;
    const s = getComputedStyle(el);
    return { tag: el.tagName, tabindex: el.getAttribute('tabindex'), visible: el.matches(':focus-visible'), outline: s.outlineStyle, shadow: s.boxShadow };
  });
  // The browser calls this focus visible (it followed no click), which used to draw the ring round the page.
  expect(main).toEqual({ tag: 'MAIN', tabindex: '-1', visible: true, outline: 'none', shadow: 'none' });
  await page.keyboard.press('Tab');
  const control = await page.evaluate(() => {
    const el = document.activeElement as HTMLElement;
    return { tag: el.tagName, main: el.id === 'main', visible: el.matches(':focus-visible'), outline: getComputedStyle(el).outlineStyle };
  });
  expect(control.main).toBe(false);
  expect(control.visible).toBe(true);
  expect(control.outline).not.toBe('none');
});

test('a world sign morphs into the world view on the first visit', async ({ page }) => {
  await recordTransitions(page);
  await openAmble(page);
  const id = await makeWorld(page);
  await warmWorldScreen(page);
  await gotoRoute(page, '#/trail');
  const sign = page.locator(`[data-testid="trail-sign"][data-world="${id}"]`);
  await expect(sign).toBeVisible();
  // The walkers stand still, so the browser's picture of the old screen is quick even on a busy machine.
  await page.getByTestId('trail-pause').click();
  const before = (await transitions(page)).length;
  await sign.click();
  await expect(page).toHaveURL(new RegExp(`#/w/${id}$`));
  await expect(page.getByTestId('world-view')).toBeVisible();
  await expectMorphOrQuickChange(page, before);
  // Once the morph is over the world view gives the name back: named, it would be a stacking context and
  // everything the editor draws over the game (Change mode's tags here) would sit under the game's layer.
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.querySelector('.world-view')!).viewTransitionName)).toBe('none');
  await page.getByRole('radio', { name: 'Change' }).click();
  const tag = page.getByTestId('tag-hero');
  await expect(tag).toBeVisible();
  const onTop = await tag.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return el.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2));
  });
  expect(onTop, 'the tag is on top of the game').toBe(true);
});

test("the First page's paper morphs into the world view of the chosen seed", async ({ page }) => {
  await recordTransitions(page);
  await openAmble(page);
  await expect(page.getByTestId('screen-first')).toBeVisible();
  await warmWorldScreen(page);
  const before = (await transitions(page)).length;
  // The end of the First page's pick (a seed chosen for the doodle): the world is made and opened, the
  // paper takes the world view's name, and the app goes to the world.
  const id = await page.evaluate(async () => {
    const origin = location.origin;
    const { openSeed } = await import(/* @vite-ignore */ `${origin}/src/home/createWorld.ts`);
    const { openWorld } = await import(/* @vite-ignore */ `${origin}/src/state/session.ts`);
    const { transitionName } = await import(/* @vite-ignore */ `${origin}/src/app/transitions.ts`);
    const { navigate } = (window as unknown as { __amble: { navigate(route: { name: 'world'; id: string }): void } }).__amble;
    const w = (await openSeed('moon-king', null)) as { id: string };
    await openWorld(w.id);
    transitionName(document.querySelector<HTMLElement>('.first__sheet'), 'world-view');
    navigate({ name: 'world', id: w.id });
    return w.id;
  });
  await expect(page).toHaveURL(new RegExp(`#/w/${id}$`));
  await expect(page.getByTestId('world-view')).toBeVisible();
  await expectMorphOrQuickChange(page, before);
});
