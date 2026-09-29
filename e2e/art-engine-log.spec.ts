import { expect, test, type Page } from '@playwright/test';

// The art engine's stroke log, through its harness page (dev/art/): it must replay to exactly the drawing
// ("Watch it drawn", crash recovery), so every logged op is exactly one of the student's undo steps.

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

test.describe('art engine stroke log', () => {
  test('a stroke off the paper is not a step: undo and Make it perfect act on the real last step', async ({ page }) => {
    await open(page, 'w=512&h=512');
    await harness(page, 'look', 0.5);
    const lines = await harness<string>(page, 'layerId', 'lines');
    await surface(page, 'setActiveLayer', lines);
    const onPaper: Array<[number, number]> = [];
    for (let i = 0; i <= 30; i++) onPaper.push([120 + i * 9, 250 + (i % 3)]);
    // A circle scribbled on the desk beside the paper.
    const offPaper: Array<[number, number]> = [];
    for (let i = 0; i <= 48; i++) offPaper.push([-220 + 70 * Math.cos((i / 44) * 2 * Math.PI), 256 + 70 * Math.sin((i / 44) * 2 * Math.PI)]);
    const drawBoth = async (): Promise<void> => {
      await page.evaluate(([a, b]) => {
        const w = window as unknown as HarnessWindow;
        w.__pen(a);
        w.__pen(b);
      }, [onPaper, offPaper] as const);
      await surface(page, 'settled');
    };
    await drawBoth();
    const inked = await harness<number>(page, 'coverage', lines, 100, 230, 320, 40);
    expect(inked).toBeGreaterThan(100);
    // "Make it perfect" has nothing to perfect: the scribble drew nothing, and the real line stays.
    expect(await surface(page, 'makeLastStrokePerfect')).toBeNull();
    expect(await harness<number>(page, 'coverage', lines, 100, 230, 320, 40)).toBeCloseTo(inked, 3);
    // Undo takes back the line, and the log agrees.
    await surface(page, 'undo');
    expect(await harness<number>(page, 'coverage', lines, 100, 230, 320, 40)).toBe(0);
    expect((await harness<{ mismatched: string[] }>(page, 'replayCheck')).mismatched).toEqual([]);
  });
});
