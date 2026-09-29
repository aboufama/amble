/**
 * A stroke drawn while the Desk is saving (a slow Chromebook, a big drawing) must survive leaving the Desk.
 * The save in progress took its copy of the drawing before that stroke, so the stroke is still unsaved when
 * that save ends: the drawing must stay "changed", and the stroke's draft must not be thrown away with the
 * drafts the save replaces.
 */
import { expect, openAmble, test } from '../helpers/app';
import { alphaAt, boardSize, drawOnBoard, openDesk, openStarterWorld } from './desk';

type Win = {
  __amble: { store: { commit(c: unknown): Promise<void>; drafts: { put(d: unknown): Promise<void> } } };
  __ambleDesk: { surface: { on(e: string, f: (v: unknown) => void): unknown; isDirty(): boolean } };
  __trace: string[];
  __release: () => void;
};

test('a stroke drawn during a save is still there after switching drawings', async ({ page }) => {
  test.setTimeout(300_000);
  await openAmble(page);
  const world = await openStarterWorld(page);
  await openDesk(page, `#/w/${world}/draw/moonKing`);
  await page.getByRole('radio', { name: 'Freehand' }).click();
  const { w, h } = await boardSize(page);
  const first = Math.round(h * 0.4);
  const second = Math.round(h * 0.6);
  await drawOnBoard(page, [
    [w * 0.35, first],
    [w * 0.5, first],
    [w * 0.65, first],
  ]);
  await expect.poll(() => page.evaluate(() => (window as unknown as Win).__ambleDesk.surface.isDirty())).toBe(true);
  // From here on, the drawing's save reaches the store only when the test says so (a slow save).
  await page.evaluate(() => {
    const win = window as unknown as Win;
    const store = win.__amble.store;
    const commit = store.commit.bind(store);
    const put = store.drafts.put.bind(store.drafts);
    win.__trace = [];
    const gate = new Promise<void>((r) => (win.__release = r));
    store.commit = async (c: unknown) => {
      win.__trace.push('save started');
      await gate;
      await commit(c);
      win.__trace.push('save stored');
    };
    store.drafts.put = async (d: unknown) => {
      win.__trace.push('draft');
      return put(d);
    };
    win.__ambleDesk.surface.on('history', () => win.__trace.push('stroke'));
    win.__ambleDesk.surface.on('dirty', (v) => win.__trace.push(v ? 'changed' : 'marked saved'));
  });
  const trace = (): Promise<string[]> => page.evaluate(() => (window as unknown as Win).__trace.slice());
  await page.keyboard.press('Control+s');
  await expect.poll(trace, { timeout: 30_000 }).toContain('save started');
  // The save has its copy of the drawing. A second stroke now, and its draft 1 s later.
  await drawOnBoard(page, [
    [w * 0.35, second],
    [w * 0.5, second],
    [w * 0.65, second],
  ]);
  await expect
    .poll(
      async () => {
        const t = await trace();
        return t.includes('stroke') && t.slice(t.indexOf('stroke')).includes('draft');
      },
      { timeout: 60_000 },
    )
    .toBe(true);
  // Then the save reaches the store, and the student moves on to another drawing and comes back.
  await page.evaluate(() => (window as unknown as Win).__release());
  await expect.poll(trace, { timeout: 60_000 }).toContain('marked saved');
  console.log(`trace: ${(await trace()).join(', ')}`);
  await page.evaluate((id) => {
    location.hash = `#/w/${id}/draw/grumble`;
  }, world);
  await openDesk(page, `#/w/${world}/draw/grumble`);
  await openDesk(page, `#/w/${world}/draw/moonKing`);
  await expect.poll(() => alphaAt(page, 'lines', Math.round(w * 0.5), first), { timeout: 30_000 }).toBeGreaterThan(100);
  await page.screenshot({ path: 'test-results/save-race-reopened.png', timeout: 60_000 });
  expect(await alphaAt(page, 'lines', Math.round(w * 0.5), second)).toBeGreaterThan(100);
});
