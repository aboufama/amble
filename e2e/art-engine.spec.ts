import { expect, test, type CDPSession, type Page } from '@playwright/test';

// The art engine end to end, through its harness page (dev/art/): real pointer input over CDP (pen pressure,
// mouse, touch), then checks on the pixels the engine keeps.

type Sample = { x: number; y: number; p: number };
type Path = (u: number) => { x: number; y: number };
type Box = [number, number, number, number];
type Api = Record<string, (...args: unknown[]) => unknown>;
type HarnessWindow = { __art: Api & { surface: Api } };

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Calls a method of the drawing surface in the page. */
function surface<T = unknown>(page: Page, name: string, ...args: unknown[]): Promise<T> {
  return page.evaluate(([n, a]) => (window as unknown as HarnessWindow).__art.surface[n as string](...(a as unknown[])), [name, args] as const) as Promise<T>;
}

/** Calls a harness helper in the page (pixel checks, hashes, replay checks). */
function harness<T = unknown>(page: Page, name: string, ...args: unknown[]): Promise<T> {
  return page.evaluate(([n, a]) => (window as unknown as HarnessWindow).__art[n as string](...(a as unknown[])), [name, args] as const) as Promise<T>;
}

async function open(page: Page, query = ''): Promise<CDPSession> {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`/dev/art/?${query}`);
  await page.waitForFunction(() => '__art' in window);
  await harness(page, 'ready');
  expect(errors).toEqual([]);
  return page.context().newCDPSession(page);
}

const ellipse = (cx: number, cy: number, rx: number, ry: number, a0: number, sweep: number): Path => (u) => {
  const a = ((a0 + sweep * u) * Math.PI) / 180;
  return { x: cx + rx * Math.cos(a), y: cy + ry * Math.sin(a) };
};
const line = (x0: number, y0: number, x1: number, y1: number): Path => (u) => ({ x: x0 + (x1 - x0) * u, y: y0 + (y1 - y0) * u });

/** Samples along a path at 240 Hz with a pen pressure envelope (light at both ends). */
function stroke(path: Path, ms: number, o: { wobble?: number; p?: (u: number) => number } = {}): Sample[] {
  const n = Math.max(2, Math.round((ms / 1000) * 240));
  const out: Sample[] = [];
  for (let i = 0; i <= n; i++) {
    const u = i / n;
    const q = path(u);
    const w = (o.wobble ?? 0) * Math.sin(u * 37);
    out.push({ x: q.x + w, y: q.y - w, p: o.p ? o.p(u) : 0.15 + 0.7 * Math.sin(Math.PI * u) });
  }
  return out;
}

/** Sends samples (board px) as real-time pen, mouse or touch input; `holdMs` rests before lifting. */
async function send(page: Page, cdp: CDPSession, samples: Sample[], kind: 'pen' | 'mouse' | 'touch' = 'pen', holdMs = 0): Promise<void> {
  const pts = await page.evaluate((s) => s.map((q) => ((window as unknown as HarnessWindow).__art.docToClient(q.x, q.y) as [number, number])), samples);
  const t0 = Date.now();
  const pace = async (i: number): Promise<void> => {
    const wait = t0 + (i * 1000) / 240 - Date.now();
    if (wait > 1) await sleep(wait);
  };
  if (kind === 'touch') {
    const tp = (i: number) => [{ x: pts[i][0], y: pts[i][1], force: samples[i].p, radiusX: 4, radiusY: 4, id: 1 }];
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: tp(0) });
    // Moves are not awaited one by one (a round trip each would slow the stroke); CDP keeps their order.
    for (let i = 1; i < pts.length; i++) {
      await pace(i);
      void cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: tp(i) });
    }
    if (holdMs) await sleep(holdMs);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } else {
    const extra = kind === 'pen' ? { pointerType: 'pen' as const } : { pointerType: 'mouse' as const };
    const ev = (type: 'mousePressed' | 'mouseMoved' | 'mouseReleased', i: number, buttons: number) => ({
      type,
      x: pts[i][0],
      y: pts[i][1],
      button: 'left' as const,
      buttons,
      clickCount: 1,
      ...extra,
      ...(kind === 'pen' ? { force: buttons ? samples[i].p : 0, tiltX: 10, tiltY: -6 } : {}),
    });
    await cdp.send('Input.dispatchMouseEvent', ev('mousePressed', 0, 1));
    for (let i = 1; i < pts.length; i++) {
      await pace(i);
      void cdp.send('Input.dispatchMouseEvent', ev('mouseMoved', i, 1));
    }
    if (holdMs) await sleep(holdMs);
    await cdp.send('Input.dispatchMouseEvent', ev('mouseReleased', pts.length - 1, 0));
  }
  await sleep(40);
  await surface(page, 'settled');
}

async function fingerTap(cdp: CDPSession, fingers: number): Promise<void> {
  const pts = Array.from({ length: fingers }, (_, i) => ({ x: 600 + i * 60, y: 450 + (i % 2) * 20, id: i + 1, radiusX: 6, radiusY: 6, force: 0.5 }));
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pts });
  await sleep(80);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await sleep(120);
}

const alphaAt = async (page: Page, layer: string | null, x: number, y: number): Promise<number> => (await harness<number[]>(page, 'pixel', layer, x, y))[3];

test.describe('art engine', () => {
  test.use({ hasTouch: true, viewport: { width: 1280, height: 900 } });

  test('a pen stroke is smooth and tapered, and the screen shows exactly the pixels', async ({ page }) => {
    const cdp = await open(page);
    const lines = await harness<string>(page, 'layerId', 'lines');
    await surface(page, 'setBrush', { size: 12 });
    await send(page, cdp, stroke(line(200, 500, 820, 500), 900));
    // Full width in the middle, thin toward the tapered ends, and it reaches both ends.
    const width = async (x: number): Promise<number> => Math.round(await harness<number>(page, 'coverage', lines, x, 470, 1, 60));
    const mid = await width(510);
    expect(mid).toBeGreaterThan(9);
    expect(await width(212)).toBeLessThan(mid * 0.6);
    expect(await width(808)).toBeLessThan(mid * 0.6);
    expect(await alphaAt(page, lines, 205, 500)).toBeGreaterThan(0);
    const view = await harness<{ bad: number }>(page, 'checkView');
    expect(view.bad).toBe(0);
  });

  test('fill closes a gap without leaking, and never floods the background into shapes', async ({ page }) => {
    const cdp = await open(page);
    await surface(page, 'setBrush', { size: 8 });
    // A circle with a gap of about 10 px at the top.
    await send(page, cdp, stroke(ellipse(400, 420, 150, 140, -86, 356), 1300));
    const toasts: string[] = [];
    await page.exposeFunction('__toast', (m: string) => toasts.push(m));
    await page.evaluate(() => (window as unknown as HarnessWindow).__art.surface.on('toast', (t: unknown) => (window as unknown as { __toast: (m: string) => void }).__toast((t as { message: string }).message)));
    await surface(page, 'setColor', '#f5a142');
    expect(await surface<boolean>(page, 'fillAt', 400, 420)).toBe(true);
    await surface(page, 'settled');
    const colors = await harness<string>(page, 'layerId', 'colors');
    const inside = await harness<number[]>(page, 'pixel', colors, 400, 420);
    expect(inside.slice(0, 4)).toEqual([245, 161, 66, 255]);
    expect(await alphaAt(page, colors, 400, 200)).toBe(0);
    expect(await alphaAt(page, colors, 700, 700)).toBe(0);
    expect(toasts.some((m) => /gap/.test(m))).toBe(true);
    // The background: everything outside, nothing inside the circle.
    await surface(page, 'setColor', '#3aa7e8');
    await surface(page, 'fillAt', 900, 900);
    await surface(page, 'settled');
    expect((await harness<number[]>(page, 'pixel', colors, 900, 900)).slice(0, 3)).toEqual([58, 167, 232]);
    expect((await harness<number[]>(page, 'pixel', colors, 400, 420)).slice(0, 3)).toEqual([245, 161, 66]);
    expect((await harness<{ bad: number }>(page, 'checkView')).bad).toBe(0);
  });

  test('undo and redo restore exact pixels, also with two- and three-finger taps', async ({ page }) => {
    const cdp = await open(page);
    const lines = await harness<string>(page, 'layerId', 'lines');
    const empty = await harness<number>(page, 'hash', lines);
    await send(page, cdp, stroke(ellipse(500, 500, 200, 160, 0, 300), 900));
    const one = await harness<number>(page, 'hash', lines);
    await surface(page, 'setTool', 'marker');
    await send(page, cdp, stroke(line(250, 700, 800, 650), 700));
    const two = await harness<number>(page, 'hash', lines);
    expect(await surface<boolean>(page, 'undo')).toBe(true);
    expect(await harness<number>(page, 'hash', lines)).toBe(one);
    expect(await surface<boolean>(page, 'undo')).toBe(true);
    expect(await harness<number>(page, 'hash', lines)).toBe(empty);
    await surface(page, 'redo');
    await surface(page, 'redo');
    expect(await harness<number>(page, 'hash', lines)).toBe(two);
    await fingerTap(cdp, 2);
    await surface(page, 'settled');
    expect(await harness<number>(page, 'hash', lines)).toBe(one);
    await fingerTap(cdp, 3);
    await surface(page, 'settled');
    expect(await harness<number>(page, 'hash', lines)).toBe(two);
  });

  test('holding still at the end of a wobbly circle makes it a perfect circle', async ({ page }) => {
    const cdp = await open(page);
    const shapes: string[] = [];
    await page.exposeFunction('__shape', (s: string) => shapes.push(s));
    await page.evaluate(() =>
      (window as unknown as HarnessWindow).__art.surface.on('toast', (t: unknown) => {
        const shape = (t as { shape?: string }).shape;
        if (shape) (window as unknown as { __shape: (s: string) => void }).__shape(shape);
      }),
    );
    await send(page, cdp, stroke(ellipse(500, 450, 180, 176, -90, 358), 1200, { wobble: 3, p: () => 0.6 }), 'pen', 700);
    expect(shapes).toEqual(['circle']);
    expect((await surface<{ undoLabel: string }>(page, 'historyState')).undoLabel).toBeTruthy();
  });

  test('export is transparent, trimmed and anchored at the feet', async ({ page }) => {
    const cdp = await open(page);
    await surface(page, 'setBrush', { size: 10 });
    await send(page, cdp, stroke(ellipse(512, 400, 120, 120, -90, 356), 1000));
    await send(page, cdp, stroke(line(470, 520, 440, 820), 500));
    await send(page, cdp, stroke(line(555, 520, 585, 820), 500));
    const ex = await harness<{ flat: string; w: number; h: number; box: Box; anchor: [number, number]; anchorBoard: [number, number]; linesMask: string | null }>(page, 'exportArt');
    const [bx, by, bw, bh] = ex.box;
    expect(bx).toBeGreaterThan(370);
    expect(by).toBeGreaterThan(260);
    expect(bx + bw).toBeLessThan(655);
    expect(by + bh).toBeLessThan(840);
    // Feet: the anchor sits on the bottom edge, between the legs.
    expect(ex.anchorBoard[1]).toBeCloseTo(by + bh, 0);
    expect(ex.anchorBoard[0]).toBeGreaterThan(460);
    expect(ex.anchorBoard[0]).toBeLessThan(565);
    expect(ex.linesMask).not.toBeNull();
    const corners = await page.evaluate(async (url) => {
      const img = await createImageBitmap(await (await fetch(url)).blob());
      const c = new OffscreenCanvas(img.width, img.height);
      const g = c.getContext('2d') as OffscreenCanvasRenderingContext2D;
      g.drawImage(img, 0, 0);
      const px = (x: number, y: number) => g.getImageData(x, y, 1, 1).data[3];
      return [px(0, 0), px(img.width - 1, 0), img.width, img.height];
    }, ex.flat);
    expect(corners.slice(0, 2)).toEqual([0, 0]);
    expect(corners.slice(2)).toEqual([ex.w, ex.h]);
  });

  test('a drawing replays exactly from its stroke log, and survives save and load', async ({ page }) => {
    const cdp = await open(page);
    for (const [tool, size, y] of [['ink', 8, 120], ['pencil', 5, 200], ['marker', 30, 280], ['crayon', 20, 360], ['airbrush', 70, 440]] as const) {
      await surface(page, 'setTool', tool);
      await surface(page, 'setBrush', { size });
      await send(page, cdp, stroke(line(150, y, 850, y + 40), 700));
    }
    await surface(page, 'setTool', 'ink');
    await send(page, cdp, stroke(ellipse(320, 700, 120, 110, -90, 356), 900), 'mouse');
    await surface(page, 'setMirror', { x: true });
    await send(page, cdp, stroke(line(420, 860, 470, 980), 400));
    await surface(page, 'setMirror', null);
    await surface(page, 'setColor', '#7cc95a');
    await surface(page, 'fillAt', 320, 700);
    await surface(page, 'setTool', 'eraser');
    await send(page, cdp, stroke(line(250, 690, 390, 720), 400));
    await surface(page, 'selectAll');
    await surface(page, 'transformSelection', { tx: 30, ty: -20, rot: 0.1 });
    await surface(page, 'commitSelection');
    await surface(page, 'undo');
    await surface(page, 'redo');
    const check = await harness<{ layers: number; mismatched: string[] }>(page, 'replayCheck');
    expect(check.mismatched).toEqual([]);
    const lines = await harness<string>(page, 'layerId', 'lines');
    const before = await harness<number>(page, 'hash', lines);
    const saved = await harness<{ data: string; bytes: number }>(page, 'saveDoc');
    expect(saved.bytes).toBeGreaterThan(1000);
    await harness(page, 'loadDoc', saved.data);
    expect(await harness<number>(page, 'hash', await harness<string>(page, 'layerId', 'lines'))).toBe(before);
  });

  test('ArtScripts replay in the browser through the same brushes', async ({ page }) => {
    await open(page);
    const script = {
      v: 1,
      name: 'blob',
      kind: 'character',
      rig: 'blob',
      width: 512,
      height: 512,
      layers: [
        { id: 'c', role: 'colors' },
        { id: 'l', role: 'lines' },
      ],
      ops: [
        {
          op: 'stroke',
          layer: 'l',
          brush: 'ink',
          size: 8,
          color: '#2b1d16',
          points: [[150, 300, 0.3], [180, 180, 0.8], [256, 130, 0.9], [340, 180, 0.8], [370, 300, 0.7], [256, 380, 0.8], [150, 300, 0.3]],
        },
        { op: 'fill', layer: 'c', x: 256, y: 260, color: '#7cc95a' },
      ],
    };
    const r = await harness<{ ms: number; flat: string | null; anchor: [number, number] | null }>(page, 'replayScript', script);
    expect(r.flat).toMatch(/^data:image\/png/);
    expect(r.anchor).not.toBeNull();
  });
});
