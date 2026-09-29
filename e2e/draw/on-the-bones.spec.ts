/**
 * Drawing on the bones (§2.10, §7.3): the student picks each step by tapping (it never moves on by
 * itself), strokes land on the chosen part's layers, the preview moves, and Bring to life makes the rig
 * from the parts (`made: 'parts'`).
 */
import { expect, openAmble, test } from '../helpers/app';
import { boardSize, circle, deskState, drawOnBoard, inkedLayers, openDesk, openStarterWorld, settle, tapOnBoard } from './desk';

test('steps are picked by tapping, strokes land on the part, the preview moves, and the rig is made from the parts', async ({ page }) => {
  test.setTimeout(90_000);
  await openAmble(page);
  const world = await openStarterWorld(page);
  await openDesk(page, `#/w/${world}/draw/hero`);

  // The hero opens on the bones, at the first step.
  const start = await deskState(page);
  expect(start.mode).toBe('bones');
  expect(start.part).toBe('torso');
  await expect(page.getByRole('button', { name: 'Body, drawing now' })).toHaveAttribute('aria-current', 'step');

  // Body: a torso around the body bones, filled.
  const { w, h } = await boardSize(page);
  await drawOnBoard(page, circle(w / 2, h * 0.52, w * 0.12, 0, 360));
  await settle(page, 400);
  await page.getByTestId('desk-board').focus();
  await page.keyboard.press('g');
  await tapOnBoard(page, w / 2, h * 0.52);
  await settle(page, 500);
  expect(await inkedLayers(page)).toEqual(expect.arrayContaining(['torso-lines', 'torso']));

  // Still the body: the Desk never moves on by itself.
  expect((await deskState(page)).part).toBe('torso');

  // Head, by tapping its chip.
  await page.getByRole('button', { name: 'Head', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Head, drawing now' })).toHaveAttribute('aria-current', 'step');
  expect((await deskState(page)).part).toBe('head');
  await page.getByTestId('desk-board').focus();
  await page.keyboard.press('b');
  await drawOnBoard(page, circle(w / 2, h * 0.3, w * 0.1, 0, 360));
  await settle(page, 400);
  const inked = await inkedLayers(page);
  expect(inked).toContain('head-lines');
  expect(inked).not.toContain('armL-lines');
  await expect(page.getByRole('button', { name: 'Body, done' })).toBeVisible();

  // The preview moves: its picture changes over time.
  const canvas = page.locator('.preview__canvas');
  await expect(canvas).toBeVisible();
  await expect
    .poll(
      async () => {
        const a = await canvas.evaluate((c: HTMLCanvasElement) => c.toDataURL());
        await page.waitForTimeout(250);
        const b = await canvas.evaluate((c: HTMLCanvasElement) => c.toDataURL());
        return a !== b;
      },
      { timeout: 15_000 },
    )
    .toBe(true);

  // Bring to life: the rig is made from the parts.
  await page.getByTestId('bring-to-life').click();
  await page.waitForFunction((id) => location.hash === `#/w/${id}`, world, { timeout: 30_000 });
  const made = await page.evaluate(async (id) => {
    const a = (window as unknown as { __amble: { store: { worlds: { get(id: string): Promise<{ cast: Record<string, { art: string | null }> } | null> }; art: { get(id: string): Promise<{ rigInfo: { made: string } | null; mode: string; parts: Record<string, unknown> } | null> } } } }).__amble;
    const wld = await a.store.worlds.get(id);
    const art = wld?.cast.hero?.art;
    const rec = art ? await a.store.art.get(art) : null;
    return { made: rec?.rigInfo?.made ?? null, mode: rec?.mode ?? null, parts: Object.keys(rec?.parts ?? {}) };
  }, world);
  expect(made.made).toBe('parts');
  expect(made.mode).toBe('bones');
  expect(made.parts).toEqual(expect.arrayContaining(['torso', 'head']));
});

test('Bones from the Desk brings the drawing to life and opens its bones', async ({ page }) => {
  test.setTimeout(90_000);
  await openAmble(page);
  const world = await openStarterWorld(page);
  await openDesk(page, `#/w/${world}/draw/grumble`);
  const { w, h } = await boardSize(page);
  await drawOnBoard(page, circle(w / 2, h * 0.6, w * 0.2, 0, 360));
  await settle(page, 400);
  await page.getByRole('button', { name: 'Bones', exact: true }).click();
  await page.waitForFunction((id) => location.hash === `#/w/${id}/bones/grumble`, world, { timeout: 30_000 });
  await expect(page.getByTestId('screen-bones')).toBeVisible();
  await expect(page.getByText('is only bones so far')).toHaveCount(0);
});
