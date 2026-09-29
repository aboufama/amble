// Shared Playwright harness for the art engine: launch Chromium on the harness page and send human-like
// pen, mouse and touch input over CDP (real-time paced, with pressure and tilt).
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The repository's root folder. */
export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
export const BASE = process.env.ART_URL ?? 'http://localhost:5211/dev/art/';
/** Screenshots and measurements go to test-results/art in the repository (ignored by git), or to ART_OUT. */
export const OUT = resolve(process.env.ART_OUT ?? resolve(ROOT, 'test-results/art'));
mkdirSync(OUT, { recursive: true });
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The flags the repo's e2e tests use (software WebGL for games). ART_GPU=none runs without them. */
export const GPU_ARGS = process.env.ART_GPU === 'none' ? [] : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'];

export async function launch({ dpr = 1, throttle = 1, width = 1280, height = 900, query = '', args = GPU_ARGS } = {}) {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args });
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: dpr, hasTouch: true });
  const page = await context.newPage();
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning' || process.env.ART_LOG) console.log('[page]', m.text());
  });
  await page.goto(`${BASE}?${query}`);
  await page.waitForFunction(() => !!window.__art);
  await page.evaluate(() => window.__art.ready());
  const cdp = await context.newCDPSession(page);
  if (throttle > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle });
  return { browser, context, page, cdp };
}

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const smooth = (e0, e1, x) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};
const minJerk = (t) => t * t * t * (10 - 15 * t + 6 * t * t);

// ---- paths: u in [0,1] -> {x, y}
export const ellipse = (cx, cy, rx, ry, a0Deg, sweepDeg) => (u) => {
  const a = ((a0Deg + sweepDeg * u) * Math.PI) / 180;
  return { x: cx + rx * Math.cos(a), y: cy + ry * Math.sin(a) };
};
export const line = (x0, y0, x1, y1, bow = 0) => (u) => {
  const nx = -(y1 - y0);
  const ny = x1 - x0;
  const l = Math.hypot(nx, ny) || 1;
  const b = bow * Math.sin(Math.PI * u);
  return { x: x0 + (x1 - x0) * u + (nx / l) * b, y: y0 + (y1 - y0) * u + (ny / l) * b };
};
/** Smooth curve through points (Catmull-Rom), parameterised by arc length. */
export function through(points, closed = false) {
  const P = closed ? [...points, points[0]] : points;
  const dense = [];
  for (let i = 0; i < P.length - 1; i++) {
    const p0 = P[i - 1] ?? (closed ? P[P.length - 2] : P[i]);
    const p1 = P[i];
    const p2 = P[i + 1];
    const p3 = P[i + 2] ?? (closed ? P[1] : P[i + 1]);
    for (let k = 0; k < 24; k++) {
      const t = k / 24;
      const t2 = t * t;
      const t3 = t2 * t;
      const f = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      dense.push({ x: f(p0[0], p1[0], p2[0], p3[0]), y: f(p0[1], p1[1], p2[1], p3[1]) });
    }
  }
  dense.push({ x: P[P.length - 1][0], y: P[P.length - 1][1] });
  return polyline(dense);
}
export function polyline(pts) {
  const P = pts.map((p) => (Array.isArray(p) ? { x: p[0], y: p[1] } : p));
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
export function pathLength(path, n = 400) {
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
 * A human-like stroke along `path` (board px): minimum-jerk timing, a pressure envelope, low-frequency
 * wobble, 9 Hz tremor and digitizer jitter. Returns [{x, y, p}] at `hz`; `hold` adds resting samples.
 */
export function humanStroke(path, o = {}) {
  const { hz = 240, speed = 700, minDur = 160, p0 = 0.25, p1 = 0.75, wobble = 0.9, tremor = 0.22, jitter = 0.12, seed = 1, ramp = 0.1, fade = 0.2, hold = 0 } = o;
  const L = pathLength(path);
  const dur = o.dur ?? Math.max(minDur, (L / speed) * 1000 * 1.6);
  const n = Math.max(2, Math.round((dur / 1000) * hz));
  const rnd = mulberry32(seed);
  const ph = rnd() * 6.28;
  const ph2 = rnd() * 6.28;
  const wf = 0.6 + rnd() * 1.2;
  const out = [];
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
    const env = smooth(0, ramp, t) * (1 - 0.8 * smooth(1 - fade, 1, t));
    const p = Math.min(1, Math.max(0.02, p0 + (p1 - p0) * env + 0.05 * Math.sin(t * 9 + ph)));
    out.push({ x: q.x - ty * off + (rnd() - 0.5) * 2 * jitter, y: q.y + tx * off + (rnd() - 0.5) * 2 * jitter, p });
  }
  const last = out[out.length - 1];
  for (let k = 0; k < hold; k++) out.push({ ...last, hold: true });
  return out;
}

async function toClient(page, samples) {
  return page.evaluate((s) => s.map((q) => window.__art.docToClient(q.x, q.y)), samples);
}

/** Sends a stroke (board coords) as real-time paced input. kind: 'pen' | 'mouse' | 'touch'. */
export async function sendStroke(page, cdp, samples, { hz = 240, kind = 'pen', tiltX = 12, tiltY = -8 } = {}) {
  const pts = await toClient(page, samples);
  const dt = 1000 / hz;
  if (kind === 'touch') {
    const tp = (i) => [{ x: pts[i][0], y: pts[i][1], force: samples[i].p, radiusX: 4, radiusY: 4, id: 1 }];
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: tp(0) });
    const t0 = performance.now();
    for (let i = 1; i < pts.length; i++) {
      const wait = t0 + i * dt - performance.now();
      if (wait > 1) await sleep(wait);
      if (samples[i].hold) continue;
      cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: tp(i) });
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await sleep(30);
    return;
  }
  const extra = kind === 'pen' ? { pointerType: 'pen', tiltX, tiltY } : { pointerType: 'mouse' };
  const ev = (type, i, buttons) => ({ type, x: pts[i][0], y: pts[i][1], button: 'left', buttons, clickCount: 1, ...extra, ...(kind === 'pen' ? { force: buttons ? samples[i].p : 0 } : {}) });
  await cdp.send('Input.dispatchMouseEvent', ev('mousePressed', 0, 1));
  const t0 = performance.now();
  for (let i = 1; i < pts.length; i++) {
    const wait = t0 + i * dt - performance.now();
    if (wait > 1) await sleep(wait);
    if (samples[i].hold) continue; // resting: no movement events
    cdp.send('Input.dispatchMouseEvent', ev('mouseMoved', i, 1));
  }
  await cdp.send('Input.dispatchMouseEvent', ev('mouseReleased', pts.length - 1, 0));
  await sleep(30);
}

/** A mouse (or pen) tap at a board point. */
export async function tap(page, cdp, x, y, kind = 'mouse') {
  const [[cx, cy]] = await toClient(page, [{ x, y }]);
  const extra = kind === 'pen' ? { pointerType: 'pen', force: 0.6 } : {};
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: cx, y: cy, button: 'left', buttons: 1, clickCount: 1, ...extra });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: cx, y: cy, button: 'left', buttons: 0, clickCount: 1, ...extra });
  await sleep(40);
}

/** A multi-finger tap (two = undo, three = redo) at view-centre offsets. */
export async function fingerTap(cdp, fingers, cx = 640, cy = 450) {
  const pts = Array.from({ length: fingers }, (_, i) => ({ x: cx + i * 60, y: cy + (i % 2) * 20, id: i + 1, radiusX: 6, radiusY: 6, force: 0.5 }));
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pts });
  await sleep(80);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await sleep(60);
}

/** Two fingers: pinch by `scale` and rotate by `deg` around (cx, cy) over `steps` moves. */
export async function pinch(cdp, { cx = 640, cy = 450, r0 = 80, scale = 1.6, deg = 20, steps = 20 } = {}) {
  const at = (k) => {
    const t = k / steps;
    const r = r0 * (1 + (scale - 1) * t);
    const a = (deg * t * Math.PI) / 180;
    return [
      { x: cx - r * Math.cos(a), y: cy - r * Math.sin(a), id: 1, radiusX: 6, radiusY: 6, force: 0.5 },
      { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a), id: 2, radiusX: 6, radiusY: 6, force: 0.5 },
    ];
  };
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: at(0) });
  for (let k = 1; k <= steps; k++) {
    await sleep(16);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: at(k) });
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await sleep(250);
}

export async function shot(page, name, selector = '#desk') {
  const file = resolve(OUT, name);
  await page.locator(selector).screenshot({ path: file });
  return file;
}

export function saveDataUrl(dataUrl, name) {
  const file = resolve(OUT, name);
  writeFileSync(file, Buffer.from(dataUrl.split(',')[1], 'base64'));
  return file;
}

export function saveJson(obj, name) {
  const file = resolve(OUT, name);
  writeFileSync(file, JSON.stringify(obj, null, 2));
  return file;
}

/** Waits until fills are worked out and the screen shows the final pixels. */
export async function settle(page) {
  await page.evaluate(() => window.__art.surface.settled());
}
