import { expect, test, type Page } from '@playwright/test';

// The art engine's undo, stroke log and fill cache under real timing, through its harness page (dev/art/):
// the page's one engine worker outlives each drawing, undo waits on that worker for old steps, and the
// stroke log must replay to exactly the drawing ("Watch it drawn", crash recovery).

type Api = Record<string, (...args: unknown[]) => unknown>;
type HarnessWindow = { __art: Api & { surface: Api }; __pen(points: Array<[number, number]>): void };

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function surface<T = unknown>(page: Page, name: string, ...args: unknown[]): Promise<T> {
  return page.evaluate(([n, a]) => (window as unknown as HarnessWindow).__art.surface[n as string](...(a as unknown[])), [name, args] as const) as Promise<T>;
}

function harness<T = unknown>(page: Page, name: string, ...args: unknown[]): Promise<T> {
  return page.evaluate(([n, a]) => (window as unknown as HarnessWindow).__art[n as string](...(a as unknown[])), [name, args] as const) as Promise<T>;
}

/** Opens the harness and installs `__pen`: a pen stroke (board px) through the engine's real pointer path. */
async function open(page: Page, query: string): Promise<void> {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`/dev/art/?${query}`);
  await page.waitForFunction(() => '__art' in window);
  await harness(page, 'ready');
  await page.evaluate(() => {
    const w = window as unknown as HarnessWindow;
    w.__pen = (points) => {
      const host = document.getElementById('desk')!;
      const s = w.__art.surface as unknown as { docToClient(x: number, y: number): { x: number; y: number } };
      const fire = (type: string, [x, y]: [number, number], buttons: number): void => {
        const c = s.docToClient(x, y);
        host.dispatchEvent(new PointerEvent(type, { pointerId: 7, pointerType: 'pen', isPrimary: true, clientX: c.x, clientY: c.y, pressure: buttons ? 0.6 : 0, buttons, button: type === 'pointerdown' || type === 'pointerup' ? 0 : -1, bubbles: true, cancelable: true }));
      };
      fire('pointerdown', points[0], 1);
      for (const p of points.slice(1)) {
        // Chrome sends raw updates in secure contexts and plain moves otherwise; the engine reads one of them.
        fire('pointerrawupdate', p, 1);
        fire('pointermove', p, 1);
      }
      fire('pointerup', points[points.length - 1], 0);
    };
  });
  expect(errors).toEqual([]);
}

const rgbAt = async (page: Page, layer: string, x: number, y: number): Promise<number[]> => (await harness<number[]>(page, 'pixel', layer, x, y)).slice(0, 4);

test.describe('art engine integrity', () => {
  test('a fill in a reopened drawing is walled by the lines it has now', async ({ page }) => {
    await open(page, 'w=512&h=512');
    const lines = await harness<string>(page, 'layerId', 'lines');
    const colors = await harness<string>(page, 'layerId', 'colors');
    await surface(page, 'setActiveLayer', lines);
    await surface(page, 'setBrush', { size: 6 }, 'ink');
    // First visit: a ring and a dash, then the inside of the ring filled orange.
    await surface(page, 'drawShape', { shape: 'ellipse', points: [[128, 128], [384, 384]] });
    await surface(page, 'drawShape', { shape: 'line', points: [[20, 20], [40, 20]] });
    await sleep(700);
    await surface(page, 'setColor', '#f5a142');
    expect(await surface<boolean>(page, 'fillAt', 256, 256)).toBe(true);
    await surface(page, 'settled');
    expect(await rgbAt(page, colors, 312, 256)).toEqual([245, 161, 66, 255]);

    // Saved, closed and opened again (the page and its engine worker stay).
    const saved = await harness<{ data: string }>(page, 'saveDoc');
    await harness(page, 'loadDoc', saved.data);
    expect(await harness<string>(page, 'layerId', 'lines')).toBe(lines);
    await surface(page, 'setActiveLayer', lines);
    await surface(page, 'setBrush', { size: 6 }, 'ink');
    await surface(page, 'setColor', '#2b1d16');
    // Second visit: a line down the middle splits the ring, and only its left half is filled blue.
    await surface(page, 'drawShape', { shape: 'line', points: [[256, 100], [256, 412]] });
    await sleep(700);
    await surface(page, 'setColor', '#3aa7e8');
    expect(await surface<boolean>(page, 'fillAt', 200, 256)).toBe(true);
    await surface(page, 'settled');
    expect(await rgbAt(page, colors, 200, 256)).toEqual([58, 167, 232, 255]);
    expect(await rgbAt(page, colors, 312, 256)).toEqual([245, 161, 66, 255]);
  });

  test('a stroke drawn while an undo waits for the worker lands after it', async ({ page }) => {
    await open(page, 'w=1024&h=1024');
    const lines = await harness<string>(page, 'layerId', 'lines');
    const colors = await harness<string>(page, 'layerId', 'colors');
    // Two full-board fills (the second one's undo keeps every tile of the first) and three small lines.
    await surface(page, 'setActiveLayer', colors);
    await surface(page, 'setColor', '#e8443a');
    await surface(page, 'drawShape', { shape: 'rect', points: [[4, 4], [1020, 1020]], filled: true });
    await surface(page, 'setColor', '#3d5bd9');
    await surface(page, 'drawShape', { shape: 'rect', points: [[4, 4], [1020, 1020]], filled: true });
    await surface(page, 'setActiveLayer', lines);
    await surface(page, 'setColor', '#2b1d16');
    for (const y of [200, 400, 600]) await surface(page, 'drawShape', { shape: 'line', points: [[100, y], [300, y]] });
    // Idle: older steps are packed away in the worker, tile by tile.
    await expect.poll(() => surface<{ history: { bytes: number } }>(page, 'stats').then((s) => s.history.bytes), { timeout: 30_000 }).toBeLessThan(1_000_000);

    const r = await page.evaluate(async () => {
      const w = window as unknown as HarnessWindow;
      const s = w.__art.surface as unknown as { undo(): Promise<boolean>; settled(): Promise<void>; historyState(): { canUndo: boolean; canRedo: boolean } };
      let done = false;
      const undos = Promise.all([s.undo(), s.undo(), s.undo(), s.undo()]).then(() => (done = true));
      await new Promise((resolve) => setTimeout(resolve, 0));
      const during = !done;
      // The student draws right away, while the fourth undo still waits for its tiles.
      w.__pen([[520, 700], [600, 710], [680, 720], [760, 730], [840, 740]]);
      await undos;
      await s.settled();
      return { during, history: s.historyState() };
    });
    expect(r.during).toBe(true);
    // Every undo happened, then the stroke: nothing is left to redo.
    expect(r.history.canRedo).toBe(false);
    expect(await rgbAt(page, colors, 512, 512)).toEqual([232, 68, 58, 255]);
    expect(await harness<number>(page, 'coverage', lines, 560, 690, 240, 60)).toBeGreaterThan(50);
    const check = await harness<{ mismatched: string[] }>(page, 'replayCheck');
    expect(check.mismatched).toEqual([]);
  });
});
