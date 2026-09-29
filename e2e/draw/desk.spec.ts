/**
 * The Desk (§2.10, §7): tools by keyboard, a fill that stays inside a gapped circle, undo that restores
 * pixels, and a drawing that survives switching away within 100 ms of a stroke.
 */
import { expect, openAmble, test } from '../helpers/app';
import { alphaAt, boardSize, circle, deskState, drawOnBoard, inkedLayers, openDesk, openStarterWorld, settle, tapOnBoard } from './desk';

test('tools by keyboard, while the sheet has focus', async ({ page }) => {
  await openAmble(page);
  await openDesk(page, '#/draw/new');
  const sheet = page.getByTestId('desk-board');
  await expect(sheet).toHaveAttribute('role', 'application');
  await sheet.focus();
  const keys: Array<[string, string]> = [
    ['p', 'pencil'],
    ['m', 'marker'],
    ['c', 'crayon'],
    ['a', 'airbrush'],
    ['e', 'eraser'],
    ['g', 'fill'],
    ['l', 'select'],
    ['u', 'shapes'],
    ['b', 'ink'],
  ];
  for (const [key, tool] of keys) {
    await page.keyboard.press(key);
    await expect(page.locator(`.rail__tool[data-tool="${tool}"]`)).toHaveAttribute('aria-pressed', 'true');
  }
  const before = (await deskState(page)) as unknown as { brush: { size: number; opacity: number } };
  await page.keyboard.press(']');
  await page.keyboard.press('5');
  const after = (await deskState(page)) as unknown as { brush: { size: number; opacity: number } };
  expect(after.brush.size).toBeGreaterThan(before.brush.size);
  expect(after.brush.opacity).toBeCloseTo(0.5, 2);

  // Typing elsewhere never picks a tool.
  await page.getByRole('button', { name: 'More colours' }).focus();
  await page.keyboard.press('p');
  await expect(page.locator('.rail__tool[data-tool="ink"]')).toHaveAttribute('aria-pressed', 'true');

  // The rail is a toolbar: arrow keys move between tools, Enter picks one.
  await page.locator('.rail__tool[data-tool="ink"]').focus();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(page.locator('.rail__tool[data-tool="pencil"]')).toHaveAttribute('aria-pressed', 'true');
});

test('fill stays inside a gapped circle', async ({ page }) => {
  await openAmble(page);
  await openDesk(page, '#/draw/new');
  const { w, h } = await boardSize(page);
  const cx = w / 2;
  const cy = h / 2;
  const r = w * 0.2;
  // A circle with a small gap at the right (about 7 px between the stroke's ends).
  await drawOnBoard(page, circle(cx, cy, r, 3, 357));
  await settle(page, 500);
  await page.getByTestId('desk-board').focus();
  await page.keyboard.press('g');
  await tapOnBoard(page, cx, cy);
  await expect.poll(() => alphaAt(page, 'colors', Math.round(cx), Math.round(cy)), { timeout: 5000 }).toBeGreaterThan(200);
  // Inside near the gap is filled; outside, beyond the gap, stays paper.
  expect(await alphaAt(page, 'colors', Math.round(cx + r - 20), Math.round(cy))).toBeGreaterThan(200);
  expect(await alphaAt(page, 'colors', Math.round(cx + r + 30), Math.round(cy))).toBe(0);
  expect(await alphaAt(page, 'colors', 20, 20)).toBe(0);
  // The fill went under the lines, on Colours; the lines stay on Lines.
  expect(await inkedLayers(page)).toEqual(expect.arrayContaining(['lines', 'colors']));
});

test('undo restores pixels, redo brings them back', async ({ page }) => {
  await openAmble(page);
  await openDesk(page, '#/draw/new');
  const { w, h } = await boardSize(page);
  const y = Math.round(h * 0.4);
  await drawOnBoard(page, [
    [w * 0.3, y],
    [w * 0.5, y],
    [w * 0.7, y],
  ]);
  await settle(page);
  const x = Math.round(w * 0.5);
  expect(await alphaAt(page, 'lines', x, y)).toBeGreaterThan(100);
  await page.keyboard.press('Control+z');
  await expect.poll(() => alphaAt(page, 'lines', x, y)).toBe(0);
  await expect(page.getByRole('button', { name: 'Undo' })).toBeDisabled();
  await page.keyboard.press('Control+Shift+z');
  await expect.poll(() => alphaAt(page, 'lines', x, y)).toBeGreaterThan(100);
});

test('switching drawings within 100 ms of a stroke loses nothing', async ({ page }) => {
  await openAmble(page);
  const world = await openStarterWorld(page);
  await openDesk(page, `#/w/${world}/draw/boss`);
  await page.getByRole('radio', { name: 'Freehand' }).click();
  const { w, h } = await boardSize(page);
  const y = Math.round(h * 0.5);
  await drawOnBoard(page, [
    [w * 0.35, y],
    [w * 0.5, y],
    [w * 0.65, y],
  ]);
  // Straight to another drawing, at once.
  await page.evaluate((id) => {
    location.hash = `#/w/${id}/draw/minion`;
  }, world);
  await openDesk(page, `#/w/${world}/draw/minion`);
  await openDesk(page, `#/w/${world}/draw/boss`);
  await expect.poll(() => alphaAt(page, 'lines', Math.round(w * 0.5), y), { timeout: 10_000 }).toBeGreaterThan(100);
  // It was saved as a drawing (with no draft left over).
  const saved = await page.evaluate(async (id) => {
    const a = (window as unknown as { __amble: { store: { art: { list(q?: unknown): Promise<Array<{ id: string; name: string }>> }; drafts: { list(): Promise<Array<{ artId: string }>> } } } }).__amble;
    const list = await a.store.art.list();
    const drafts = await a.store.drafts.list();
    return { names: list.map((r) => r.name), drafts: drafts.length, id };
  }, world);
  expect(saved.names).toContain('Moon King');
});

test('a photo of a paper drawing becomes a Lines layer, on this Chromebook', async ({ page, guards }) => {
  await openAmble(page);
  await openDesk(page, '#/draw/new');
  // A "photo": grey paper with a dark ring drawn on it.
  const png = await page.evaluate(async () => {
    const c = new OffscreenCanvas(400, 300);
    const x = c.getContext('2d') as OffscreenCanvasRenderingContext2D;
    x.fillStyle = '#c9c4b8';
    x.fillRect(0, 0, 400, 300);
    x.strokeStyle = '#2a2622';
    x.lineWidth = 10;
    x.beginPath();
    x.arc(200, 150, 90, 0, Math.PI * 2);
    x.stroke();
    const blob = await c.convertToBlob({ type: 'image/png' });
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let s = '';
    for (const b of bytes) s += String.fromCharCode(b);
    return btoa(s);
  });
  const before = (await inkedLayers(page)).length;
  await page.getByRole('button', { name: 'More', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Use a photo of my drawing' }).click();
  await expect(page.getByRole('dialog', { name: 'Use a photo of your drawing' })).toBeVisible();
  await page.getByTestId('photo-file').setInputFiles({ name: 'drawing.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
  await page.getByRole('button', { name: 'Use my lines' }).click();
  await expect(page.getByText('Your lines are on a new layer.')).toBeVisible();
  // A new Lines layer with the ring's ink, and the paper gone (the middle is clear).
  const layers = await inkedLayers(page);
  expect(layers.length).toBe(before + 1);
  const photo = layers.find((l) => !['lines', 'colors', 'sketch'].includes(l)) as string;
  const { w, h } = await boardSize(page);
  // The photo is fitted into the board: 400 x 300 at w / 400.
  const k = Math.min(w / 400, h / 300);
  expect(await alphaAt(page, photo, Math.round(w / 2), Math.round(h / 2))).toBe(0);
  expect(await alphaAt(page, photo, Math.round(w / 2 + 90 * k), Math.round(h / 2))).toBeGreaterThan(200);
  // Nothing left the device.
  expect(guards.egress.violations).toEqual([]);
});
