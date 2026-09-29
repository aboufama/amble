/**
 * Coming back from the Desk and leaving before the world has started again (§2.6, §2.10): the come-alive flight
 * never plays over the next screen, and the hidden game is never resumed behind it. The flight waits for the
 * next time the world shows.
 */
import { expect, gotoRoute, test } from '../helpers/app';
import { openWorld } from './world';

type Win = Window & {
  __flights: number;
  __resumes: number;
  __release(): void;
  __amble: {
    store: { worlds: { get(id: string): Promise<unknown> } };
    services: { player: { resume(): void } };
    getState(): { session: { comeAlive: { key: string | null } | null } };
    setState(fn: (s: { session: { comeAlive: unknown } }) => void): void;
    navigate(r: unknown): void;
  };
};

/** A 1x1 PNG, for the sticker that flies. */
const STICKER = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

test('leaving right after coming back from the Desk plays no flight over the next screen and keeps the game paused', async ({ page }) => {
  const id = await openWorld(page);
  await gotoRoute(page, '#/trail');
  await expect(page.getByTestId('screen-trail')).toBeVisible();
  await page.evaluate((sticker) => {
    const w = window as unknown as Win;
    w.__flights = 0;
    w.__resumes = 0;
    new MutationObserver((records) => {
      for (const r of records) for (const n of r.addedNodes) if (n instanceof HTMLElement && n.classList.contains('flight__sticker')) w.__flights++;
    }).observe(document.body, { childList: true, subtree: true });
    const player = w.__amble.services.player;
    const resume = player.resume.bind(player);
    player.resume = () => {
      w.__resumes++;
      resume();
    };
    // The world's start waits on a read (a busy Chromebook) until the student has already gone.
    const worlds = w.__amble.store.worlds;
    const get = worlds.get;
    let open: () => void = () => undefined;
    const gate = new Promise<void>((r) => (open = r));
    worlds.get = async (wid: string) => {
      await gate;
      return get.call(worlds, wid);
    };
    w.__release = () => {
      worlds.get = get;
      open();
    };
    // Bring to life came back with a drawing to fly in.
    w.__amble.setState((s) => {
      s.session.comeAlive = { key: 'hero', artId: 'a_leaving01', sticker, from: { x: 120, y: 120, left: 120, top: 120, width: 60, height: 60, right: 180, bottom: 180 } };
    });
  }, STICKER);
  await gotoRoute(page, `#/w/${id}`);
  await expect(page.getByTestId('screen-world')).toBeVisible();
  await gotoRoute(page, '#/trail');
  await expect(page.getByTestId('screen-trail')).toBeVisible();
  await page.evaluate(() => (window as unknown as Win).__release());
  await page.waitForTimeout(3000);
  expect(await page.evaluate(() => (window as unknown as Win).__flights)).toBe(0);
  expect(await page.evaluate(() => (window as unknown as Win).__resumes)).toBe(0);
  // It flies the next time the world shows.
  expect(await page.evaluate(() => (window as unknown as Win).__amble.getState().session.comeAlive?.key)).toBe('hero');
});
