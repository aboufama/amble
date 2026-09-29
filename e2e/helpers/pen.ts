/**
 * Pen, mouse and touch strokes for e2e tests (§8.4), sent through CDP (`Input.dispatchMouseEvent` with
 * `pointerType: 'pen'`, pressure and tilt, or `Input.dispatchTouchEvent`), paced in real time like a
 * hand. Lifted from the editor probe's harness (S/editor-probe/harness/lib.mjs).
 *
 *   await stroke(page, page.getByTestId('desk-board'), [[20, 20], [200, 180]], { pointer: 'pen' });
 *   await stroke(page, board, humanStroke(ellipse(150, 150, 80, 60, 0, 360)), { pointer: 'pen' });
 *   await scribble(page, board, { x: 40, y: 40, w: 200, h: 120 });
 *
 * Points are CSS px relative to the target's top-left corner: `[x, y]`, or `{ x, y, p }` with pressure.
 */
import type { CDPSession, Locator, Page } from '@playwright/test';

export type PenPoint = [number, number] | { x: number; y: number; p?: number };
export type Pointer = 'pen' | 'mouse' | 'touch';

export interface StrokeOptions {
  pointer?: Pointer;
  /** Pen pressure (0..1) for points without their own (default 0.6). */
  pressure?: number;
  /** Events per second (default 120). */
  hz?: number;
  /** Pace events in real time (default true); false sends them as fast as possible. */
  realtime?: boolean;
  tiltX?: number;
  tiltY?: number;
}

const sessions = new WeakMap<Page, Promise<CDPSession>>();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function cdp(page: Page): Promise<CDPSession> {
  let s = sessions.get(page);
  if (!s) {
    s = page.context().newCDPSession(page);
    sessions.set(page, s);
  }
  return s;
}

async function originOf(target: Locator | string, page: Page): Promise<{ x: number; y: number }> {
  const loc = typeof target === 'string' ? page.locator(target) : target;
  const box = await loc.boundingBox();
  if (!box) throw new Error('The stroke target is not visible.');
  return { x: box.x, y: box.y };
}

const norm = (p: PenPoint, pressure: number) => (Array.isArray(p) ? { x: p[0], y: p[1], p: pressure } : { x: p.x, y: p.y, p: p.p ?? pressure });

/** Draws one stroke over `target`. */
export async function stroke(page: Page, target: Locator | string, points: PenPoint[], o: StrokeOptions = {}): Promise<void> {
  if (points.length < 1) return;
  const pointer = o.pointer ?? 'pen';
  const hz = o.hz ?? 120;
  const realtime = o.realtime ?? true;
  const origin = await originOf(target, page);
  const pts = points.map((p) => norm(p, o.pressure ?? 0.6)).map((q) => ({ ...q, x: origin.x + q.x, y: origin.y + q.y }));
  const session = await cdp(page);
  const dt = 1000 / hz;
  const t0 = Date.now();
  const pace = async (i: number) => {
    if (!realtime) return;
    const wait = t0 + i * dt - Date.now();
    if (wait > 1) await sleep(wait);
  };

  if (pointer === 'touch') {
    const tp = (i: number) => [{ x: pts[i].x, y: pts[i].y, force: pts[i].p, radiusX: 4, radiusY: 4, id: 1 }];
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: tp(0) });
    for (let i = 1; i < pts.length; i++) {
      await pace(i);
      await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: tp(i) });
    }
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    return;
  }

  const extra = pointer === 'pen' ? { pointerType: 'pen' as const, tiltX: o.tiltX ?? 12, tiltY: o.tiltY ?? -8 } : { pointerType: 'mouse' as const };
  const ev = (type: 'mousePressed' | 'mouseMoved' | 'mouseReleased', i: number, buttons: number) => ({
    type,
    x: pts[i].x,
    y: pts[i].y,
    button: 'left' as const,
    buttons,
    clickCount: 1,
    ...extra,
    ...(pointer === 'pen' ? { force: buttons ? pts[i].p : 0 } : {}),
  });
  await session.send('Input.dispatchMouseEvent', ev('mouseMoved', 0, 0));
  await session.send('Input.dispatchMouseEvent', ev('mousePressed', 0, 1));
  for (let i = 1; i < pts.length; i++) {
    await pace(i);
    await session.send('Input.dispatchMouseEvent', ev('mouseMoved', i, 1));
  }
  await session.send('Input.dispatchMouseEvent', ev('mouseReleased', pts.length - 1, 0));
  await sleep(30);
}

/** A quick zig-zag fill of a box (target-relative CSS px): enough ink for "something was drawn". */
export async function scribble(page: Page, target: Locator | string, box: { x: number; y: number; w: number; h: number }, o: StrokeOptions = {}): Promise<void> {
  const rows = Math.max(3, Math.round(box.h / 14));
  const zig: PenPoint[] = [];
  for (let r = 0; r <= rows; r++) {
    const y = box.y + (box.h * r) / rows;
    zig.push(r % 2 ? [box.x + box.w, y] : [box.x, y]);
  }
  await stroke(page, target, densify(zig, 6), { hz: 240, ...o });
}

/** Extra points every `step` px along straight segments (so fast strokes still look continuous). */
export function densify(points: PenPoint[], step = 4): PenPoint[] {
  const out: PenPoint[] = [];
  for (let i = 0; i < points.length; i++) {
    const a = norm(points[i], 0.6);
    out.push(points[i]);
    if (i === points.length - 1) break;
    const b = norm(points[i + 1], 0.6);
    const n = Math.floor(Math.hypot(b.x - a.x, b.y - a.y) / step);
    for (let k = 1; k < n; k++) out.push({ x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n, p: a.p + ((b.p - a.p) * k) / n });
  }
  return out;
}

// ------------------------------------------------------------------ human-like paths (from the probe)

export type Path = (u: number) => { x: number; y: number };

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};
const minJerk = (t: number) => t * t * t * (10 - 15 * t + 6 * t * t);

export const ellipse = (cx: number, cy: number, rx: number, ry: number, a0Deg: number, sweepDeg: number): Path => (u) => {
  const a = ((a0Deg + sweepDeg * u) * Math.PI) / 180;
  return { x: cx + rx * Math.cos(a), y: cy + ry * Math.sin(a) };
};

export const line = (x0: number, y0: number, x1: number, y1: number, bow = 0): Path => (u) => {
  const nx = -(y1 - y0);
  const ny = x1 - x0;
  const l = Math.hypot(nx, ny) || 1;
  const b = bow * Math.sin(Math.PI * u);
  return { x: x0 + (x1 - x0) * u + (nx / l) * b, y: y0 + (y1 - y0) * u + (ny / l) * b };
};

/** Straight segments (sharp corners), parameterised by arc length. */
export function polyline(points: Array<[number, number]>): Path {
  const P = points.map(([x, y]) => ({ x, y }));
  const acc = [0];
  for (let i = 1; i < P.length; i++) acc.push(acc[i - 1] + Math.hypot(P[i].x - P[i - 1].x, P[i].y - P[i - 1].y));
  const L = acc[acc.length - 1];
  return (u) => {
    const s = u * L;
    let i = 1;
    while (i < acc.length - 1 && acc[i] < s) i++;
    const f = (s - acc[i - 1]) / (acc[i] - acc[i - 1] || 1);
    return { x: P[i - 1].x + (P[i].x - P[i - 1].x) * f, y: P[i - 1].y + (P[i].y - P[i - 1].y) * f };
  };
}

function pathLength(path: Path, n = 400): number {
  let L = 0;
  let prev = path(0);
  for (let i = 1; i <= n; i++) {
    const p = path(i / n);
    L += Math.hypot(p.x - prev.x, p.y - prev.y);
    prev = p;
  }
  return L;
}

/**
 * Samples a human-like stroke along `path`: minimum-jerk timing, a pressure envelope, low-frequency
 * wobble, a 9 Hz tremor and digitizer jitter, at `hz` samples per second.
 */
export function humanStroke(path: Path, o: { hz?: number; speed?: number; p0?: number; p1?: number; wobble?: number; tremor?: number; jitter?: number; seed?: number } = {}): PenPoint[] {
  const { hz = 120, speed = 700, p0 = 0.25, p1 = 0.75, wobble = 0.9, tremor = 0.22, jitter = 0.12, seed = 1 } = o;
  const dur = Math.max(160, (pathLength(path) / speed) * 1000 * 1.6);
  const n = Math.max(2, Math.round((dur / 1000) * hz));
  const rnd = mulberry32(seed);
  const ph = rnd() * 6.28;
  const ph2 = rnd() * 6.28;
  const wf = 0.6 + rnd() * 1.2;
  const out: PenPoint[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const u = minJerk(t);
    const a = path(Math.max(0, u - 0.002));
    const b = path(Math.min(1, u + 0.002));
    let tx = b.x - a.x;
    let ty = b.y - a.y;
    const tl = Math.hypot(tx, ty) || 1;
    tx /= tl;
    ty /= tl;
    const q = path(u);
    const off = wobble * Math.sin(u * Math.PI * 2 * wf + ph) + tremor * Math.sin((i / hz) * 2 * Math.PI * 9 + ph2);
    const env = smooth(0, 0.1, t) * (1 - 0.8 * smooth(0.8, 1, t));
    const p = Math.min(1, Math.max(0.02, p0 + (p1 - p0) * env + 0.05 * Math.sin(t * 9 + ph)));
    out.push({ x: q.x - ty * off + (rnd() - 0.5) * 2 * jitter, y: q.y + tx * off + (rnd() - 0.5) * 2 * jitter, p });
  }
  return out;
}
