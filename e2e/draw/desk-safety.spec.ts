/**
 * The Desk never strands the student or their drawing (§2.10, §4.4): its loading sheet has a way back when
 * opening stalls, and a drawing whose saved file can't be read opens to draw again, says so, and is never
 * saved over (the new drawing waits in its draft until Bring to life).
 */
import type { Page } from '@playwright/test';
import { expect, gotoRoute, openAmble, test } from '../helpers/app';
import { boardSize, circle, drawOnBoard, inkedLayers, openDesk, openStarterWorld, settle } from './desk';

type Amble = {
  store: {
    worlds: { get(id: string): Promise<unknown> };
    art: { get(id: string): Promise<Record<string, unknown> | null> };
    drafts: { get(id: string): Promise<unknown> };
    commit(c: unknown): Promise<void>;
  };
  getState(): { draw: { artId: string | null } };
};

/** Draws a circle and waits for its ink (a stroke into a sheet still settling on a busy machine is drawn again). */
async function ink(page: Page, cx: number, cy: number, r: number): Promise<void> {
  for (let tries = 0; tries < 3; tries++) {
    await drawOnBoard(page, circle(cx, cy, r, 0, 360));
    const landed = await expect
      .poll(async () => (await inkedLayers(page)).length, { timeout: 6000 })
      .toBeGreaterThan(0)
      .then(() => true, () => false);
    if (landed) return;
  }
  throw new Error('No stroke landed on the sheet.');
}

test("the Desk's loading sheet has a way back when opening stalls", async ({ page }) => {
  await openAmble(page);
  const id = await openStarterWorld(page);
  // A read that never finishes (a stalled disk on a busy Chromebook).
  await page.evaluate(() => {
    const w = (window as unknown as { __amble: Amble; __realGet?: unknown }).__amble.store.worlds;
    (window as unknown as { __realGet: unknown }).__realGet = w.get;
    w.get = () => new Promise(() => undefined);
  });
  await gotoRoute(page, `#/w/${id}/draw/grumble`);
  await expect(page.locator('.desk--loading')).toBeVisible();
  const back = page.locator('.desk--loading .topbar__back');
  await expect(back).toBeVisible();
  await expect(back).toContainText('Moon King');
  await settle(page, 1500);
  await expect(page.locator('.desk--loading')).toBeVisible();
  await page.evaluate(() => {
    const win = window as unknown as { __amble: Amble; __realGet: Amble['store']['worlds']['get'] };
    win.__amble.store.worlds.get = win.__realGet;
  });
  await back.click();
  await expect(page.getByTestId('screen-world')).toBeVisible();
  await page.waitForFunction((w) => location.hash === `#/w/${w}`, id);
});

test('a drawing whose file is damaged opens to draw again, and is never saved over', async ({ page }) => {
  await openAmble(page);
  const id = await openStarterWorld(page);
  const hash = `#/w/${id}/draw/grumble`;

  // A saved drawing (Ctrl+S commits it), then its file goes missing.
  await openDesk(page, hash);
  const { w, h } = await boardSize(page);
  await settle(page, 500);
  await ink(page, w / 2, h * 0.5, w * 0.12);
  await settle(page, 300);
  await page.keyboard.press('Control+s');
  const artId = await page.evaluate(() => (window as unknown as { __amble: Amble }).__amble.getState().draw.artId);
  await expect.poll(() => page.evaluate(async (a) => !!(await (window as unknown as { __amble: Amble }).__amble.store.art.get(a as string)), artId)).toBe(true);
  await gotoRoute(page, `#/w/${id}`);
  await expect(page.getByTestId('screen-world')).toBeVisible();
  await settle(page, 1500);
  const damaged = await page.evaluate(async (a) => {
    const s = (window as unknown as { __amble: Amble }).__amble.store;
    const rec = await s.art.get(a as string);
    const broken = { ...rec, doc: `sha256:${'0'.repeat(64)}` };
    await s.commit({ art: [broken], clearDrafts: [a] });
    return broken;
  }, artId);

  // Opened again: a blank sheet that says why, under the same drawing.
  await openDesk(page, hash);
  await expect(page.getByTestId('desk-damaged')).toContainText("This drawing's file is damaged. You can draw it again");
  expect(await inkedLayers(page)).toEqual([]);

  // Drawing it again and saving: the new drawing goes into its draft, the record stays as it was.
  await ink(page, w / 2, h * 0.45, w * 0.1);
  await settle(page, 1400);
  await page.keyboard.press('Control+s');
  await settle(page, 600);
  const after = await page.evaluate(async (a) => {
    const s = (window as unknown as { __amble: Amble }).__amble.store;
    return { rec: await s.art.get(a as string), draft: await s.drafts.get(a as string) };
  }, artId);
  expect(after.rec).toEqual(damaged);
  expect(after.draft).not.toBeNull();

  // Leaving and coming back: the new drawing so far, still saying the file is damaged.
  await gotoRoute(page, `#/w/${id}`);
  await expect(page.getByTestId('screen-world')).toBeVisible();
  await openDesk(page, hash);
  await expect(page.getByTestId('desk-damaged')).toBeVisible();
  expect((await inkedLayers(page)).length).toBeGreaterThan(0);
  expect(await page.evaluate(async (a) => (window as unknown as { __amble: Amble }).__amble.store.art.get(a as string), artId)).toEqual(damaged);
});
