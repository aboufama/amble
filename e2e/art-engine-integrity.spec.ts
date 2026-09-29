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

  test('a photo placed on the paper lets go of its decoded picture', async ({ page }) => {
    await open(page, 'w=512&h=512');
    const r = await page.evaluate(async () => {
      const w = window as unknown as HarnessWindow & { createImageBitmap: typeof createImageBitmap };
      // A camera photo decodes to tens of MB on a Chromebook: keep hold of every picture the Desk decodes.
      const made: ImageBitmap[] = [];
      const real = w.createImageBitmap.bind(w);
      w.createImageBitmap = ((...a: Parameters<typeof createImageBitmap>) => real(...a).then((b) => (made.push(b), b))) as typeof createImageBitmap;
      const c = document.createElement('canvas');
      c.width = 800;
      c.height = 600;
      const g = c.getContext('2d')!;
      g.fillStyle = '#f4f1ea';
      g.fillRect(0, 0, 800, 600);
      g.fillStyle = '#222';
      g.fillRect(200, 150, 400, 20);
      const photo = await new Promise<Blob>((resolve) => c.toBlob((b) => resolve(b!), 'image/png'));
      const s = w.__art.surface as unknown as { importTrace(b: Blob, o?: { role?: 'trace' | 'lines' }): Promise<string | null> };
      const id = await s.importTrace(photo, { role: 'lines' });
      w.createImageBitmap = real;
      return { id, made: made.length, open: made.filter((b) => b.width > 0).length };
    });
    expect(r.id).not.toBeNull();
    expect(r.made).toBeGreaterThan(0);
    expect(r.open).toBe(0);
  });

  test('a save that runs while a layer is merged down keeps every layer it lists', async ({ page }) => {
    await open(page, 'w=2048&h=2048&layers=paint,paint,paint,lines');
    const r = await page.evaluate(async () => {
      const w = window as unknown as HarnessWindow;
      const s = w.__art.surface as unknown as {
        layers(): Array<{ id: string }>;
        setActiveLayer(id: string): void;
        setColor(c: string): void;
        drawShape(o: { shape: string; points: Array<[number, number]>; filled?: boolean }): boolean;
        toArtDoc(): Promise<{ layers: Array<{ id: string }>; cels: Array<{ layer: string }> }>;
        mergeDown(id: string): Promise<void>;
      };
      // Four busy layers: saving each one is a real PNG encode in the worker.
      const ids = s.layers().map((l) => l.id);
      ids.forEach((id, i) => {
        s.setActiveLayer(id);
        s.setColor(['#e8423f', '#3d7bf2', '#3fbf5a', '#221c18'][i]);
        for (let k = 0; k < 6; k++) s.drawShape({ shape: 'ellipse', points: [[100 + k * 300, 100 + i * 400], [400 + k * 300, 500 + i * 400]], filled: i < 3 });
      });
      const saving = s.toArtDoc();
      // The student merges the blue layer down while the first layer is being encoded.
      await new Promise((resolve) => setTimeout(resolve, 30));
      await s.mergeDown(ids[1]);
      const doc = await saving;
      const withCels = new Set(doc.cels.map((c) => c.layer));
      // What was saved, opened again: the blue is on its own layer (saved before the merge) or on the one
      // below (after it), but never nowhere.
      const art = (await import(/* @vite-ignore */ `${location.origin}/src/art/engine/serialize.ts`)) as { artDocToBoard(d: unknown): Promise<{ W: number; pixels(f: string, l: string): Uint8ClampedArray | null; frames: Array<{ id: string }>; layers: Array<{ id: string }> }> };
      const board = await art.artDocToBoard(doc);
      const f = board.frames[0].id;
      const blueAt = board.layers.filter((l) => {
        const px = board.pixels(f, l.id);
        const j = (700 * board.W + 250) * 4;
        return !!px && px[j + 3] > 0 && px[j + 2] > 200 && px[j] < 100;
      }).length;
      return { missing: doc.layers.map((l) => l.id).filter((id) => !withCels.has(id)), blueAt };
    });
    // Every layer the saved drawing lists has its pixels with it, and nothing drawn is lost.
    expect(r.missing).toEqual([]);
    expect(r.blueAt).toBe(1);
  });

  test('a flipbook asked to play twice at once leaves no timer running once stopped', async ({ page }) => {
    await open(page, 'w=256&h=256');
    const left = await page.evaluate(async () => {
      const w = window as unknown as HarnessWindow;
      const s = w.__art.surface as unknown as {
        addFrame(o?: { copy?: boolean }): Promise<string | null>;
        drawShape(o: { shape: string; points: Array<[number, number]> }): boolean;
        playFrames(fps: number): Promise<() => void>;
      };
      for (let i = 0; i < 3; i++) {
        s.drawShape({ shape: 'line', points: [[20 + i * 30, 40], [200, 200 - i * 30]] });
        await s.addFrame({ copy: true });
      }
      // Count the timers that tick on their own from here on.
      const live = new Set<number>();
      const realSet = window.setInterval.bind(window);
      const realClear = window.clearInterval.bind(window);
      window.setInterval = ((fn: TimerHandler, ms?: number, ...a: unknown[]) => {
        const id = realSet(fn, ms, ...a);
        live.add(id);
        return id;
      }) as typeof window.setInterval;
      window.clearInterval = ((id?: number) => {
        if (id !== undefined) live.delete(id);
        realClear(id);
      }) as typeof window.clearInterval;
      // Play pressed twice before the pages are ready: then stopped.
      const [a, b] = await Promise.all([s.playFrames(8), s.playFrames(8)]);
      a();
      b();
      window.setInterval = realSet as typeof window.setInterval;
      window.clearInterval = realClear as typeof window.clearInterval;
      for (const id of live) realClear(id);
      return live.size;
    });
    expect(left).toBe(0);
  });
});
