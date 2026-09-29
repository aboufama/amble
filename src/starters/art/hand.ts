/**
 * The simulated hand for writing starter drawings as ArtScripts (§9): turns shapes placed by eye into the
 * pen samples a kid's hand would make, so the real brush engine draws them like a person did. Pure and
 * seeded: the same call always makes the same stroke.
 *
 * - `wobblyPath(points)`: a smooth path through hand-placed points, with slow arm wobble.
 * - `penStroke(path, o)`: one stroke op: minimum-jerk timing (slow off the mark, fast in the middle,
 *   slow into the end), a pressure ramp, and a small 9 Hz tremor.
 * - `scribble(region, o)`: crayon back-and-forth filling a polygon, the way kids colour in.
 * - `dot(x, y, o)` and `blob(cx, cy, r)`: eyes and lumpy round shapes.
 */
import type { ArtOp, ScriptBrush } from '../../cores/art';

export type Pt = [number, number];

/** A small seeded random generator (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function lengthOf(path: Pt[]): number {
  let n = 0;
  for (let i = 1; i < path.length; i++) n += Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]);
  return n;
}

/** The point at arc length `s` along a polyline. */
function at(path: Pt[], s: number): Pt {
  let left = s;
  for (let i = 1; i < path.length; i++) {
    const [x0, y0] = path[i - 1];
    const [x1, y1] = path[i];
    const d = Math.hypot(x1 - x0, y1 - y0);
    if (left <= d || i === path.length - 1) {
      const t = d > 0 ? Math.min(1, left / d) : 0;
      return [x0 + (x1 - x0) * t, y0 + (y1 - y0) * t];
    }
    left -= d;
  }
  return path[path.length - 1];
}

/**
 * A smooth path through `points` (Catmull-Rom), sampled every `step` px, pushed sideways by a slow wobble
 * (a few random sines along the path, amplitude `wobble` px): what an arm does to a planned line.
 */
export function wobblyPath(points: Pt[], o: { wobble?: number; step?: number; seed?: number; closed?: boolean; sharp?: boolean } = {}): Pt[] {
  const wobble = o.wobble ?? 1.5;
  const step = o.step ?? 2;
  const r = rng(o.seed ?? 7);
  const pts = o.closed ? [...points, points[0]] : points;
  if (pts.length < 2) return pts.slice();
  const smooth: Pt[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(pts.length - 1, i + 2)];
    const n = Math.max(2, Math.ceil(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) / step));
    for (let k = 0; k < n; k++) {
      const t = k / n;
      const t2 = t * t;
      const t3 = t2 * t;
      // Sharp corners (a scribble's turns) go straight between the points; others curve through them.
      const f = (a: number, b: number, c: number, d: number) => (o.sharp ? b + (c - b) * t : 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3));
      smooth.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  smooth.push(pts[pts.length - 1]);
  const waves = [0, 1, 2].map(() => ({ k: (0.02 + r() * 0.05) * Math.PI * 2, phase: r() * Math.PI * 2, amp: wobble * (0.4 + r() * 0.6) }));
  let s = 0;
  return smooth.map((p, i) => {
    if (i > 0) s += Math.hypot(p[0] - smooth[i - 1][0], p[1] - smooth[i - 1][1]);
    const q = smooth[Math.min(smooth.length - 1, i + 1)];
    const b = smooth[Math.max(0, i - 1)];
    const len = Math.hypot(q[0] - b[0], q[1] - b[1]) || 1;
    const nx = -(q[1] - b[1]) / len;
    const ny = (q[0] - b[0]) / len;
    const off = waves.reduce((sum, w) => sum + Math.sin(s * w.k + w.phase) * w.amp, 0) / 3;
    return [p[0] + nx * off, p[1] + ny * off] as Pt;
  });
}

export interface StrokeOptions {
  layer: string;
  color: string;
  size: number;
  brush?: ScriptBrush;
  /** Pressure at touch-down, while cruising, and at the lift. */
  pressure?: [number, number, number];
  /** Cruise speed along the path, px per second. */
  speed?: number;
  /** ms between samples: 8 to 14. */
  dt?: number;
  /** Tremor amplitude, px (about 9 Hz). */
  tremor?: number;
  opacity?: number;
  seed?: number;
}

/**
 * One pen stroke along `path`: samples every `dt` ms placed by a minimum-jerk profile (so they bunch up
 * where the hand is slow), pressure that ramps up, cruises and fades, and a small 9 Hz tremor.
 */
export function penStroke(path: Pt[], o: StrokeOptions): Extract<ArtOp, { op: 'stroke' }> {
  const dt = Math.max(8, Math.min(14, o.dt ?? 11));
  const [p0, p1, p2] = o.pressure ?? [0.35, 0.9, 0.4];
  const r = rng(o.seed ?? 11);
  const L = lengthOf(path);
  // Minimum-jerk: peak speed is 1.875x the mean, so the whole stroke takes 1.875 L / (cruise speed).
  const T = Math.max(0.08, (1.875 * L) / (o.speed ?? 320));
  const n = Math.max(2, Math.round((T * 1000) / dt));
  const tremor = o.tremor ?? 0.25;
  const phase = r() * Math.PI * 2;
  const points: Array<[number, number, number]> = [];
  for (let i = 0; i <= n; i++) {
    const tau = i / n;
    const s = L * (10 * tau ** 3 - 15 * tau ** 4 + 6 * tau ** 5);
    const [x, y] = at(path, s);
    const ahead = at(path, Math.min(L, s + 2));
    const len = Math.hypot(ahead[0] - x, ahead[1] - y) || 1;
    const shake = Math.sin(((i * dt) / 1000) * 9 * Math.PI * 2 + phase) * tremor + (r() - 0.5) * 0.1;
    const press = tau < 0.2 ? p0 + (p1 - p0) * (tau / 0.2) : tau > 0.75 ? p1 + (p2 - p1) * ((tau - 0.75) / 0.25) : p1 + (r() - 0.5) * 0.06;
    const px = x - ((ahead[1] - y) / len) * shake;
    const py = y + ((ahead[0] - x) / len) * shake;
    points.push([Math.round(px * 10) / 10, Math.round(py * 10) / 10, Math.round(Math.max(0.05, Math.min(1, press)) * 100) / 100]);
  }
  const op: Extract<ArtOp, { op: 'stroke' }> = { op: 'stroke', layer: o.layer, brush: o.brush ?? 'ink', size: o.size, color: o.color, points, dt };
  if (o.opacity !== undefined) op.opacity = o.opacity;
  return op;
}

function inside(poly: Pt[], x: number, y: number): boolean {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

/**
 * Colouring in: back-and-forth strokes across `region` (a polygon) at `angle` degrees, `gap` px apart,
 * each run kept inside the shape, the way a kid colours with a crayon.
 */
export function scribble(region: Pt[], o: { layer: string; color: string; brush?: ScriptBrush; size?: number; gap?: number; angle?: number; seed?: number }): ArtOp[] {
  const size = o.size ?? 7;
  const gap = o.gap ?? size * 0.8;
  const a = ((o.angle ?? 35) * Math.PI) / 180;
  const ca = Math.cos(a);
  const sa = Math.sin(a);
  // In the scribble's own frame (u along the strokes, v across them).
  const uv = region.map(([x, y]) => [x * ca + y * sa, -x * sa + y * ca] as Pt);
  const vs = uv.map((p) => p[1]);
  const us = uv.map((p) => p[0]);
  const zig: Pt[] = [];
  let flip = false;
  for (let v = Math.min(...vs) + gap / 2; v < Math.max(...vs); v += gap) {
    const row: number[] = [];
    for (let u = Math.min(...us); u <= Math.max(...us); u += 1) if (inside(uv, u, v)) row.push(u);
    // The crayon's edge reaches the outline: its middle stays half a crayon inside.
    const lo = row[0] + size / 2;
    const hi = row[row.length - 1] - size / 2;
    if (hi <= lo) continue;
    const [u0, u1] = flip ? [hi, lo] : [lo, hi];
    flip = !flip;
    for (const u of [u0, u1]) zig.push([u * ca - v * sa, u * sa + v * ca]);
  }
  if (zig.length < 2) return [];
  return [penStroke(wobblyPath(zig, { wobble: 0.8, step: 3, seed: o.seed, sharp: true }), { layer: o.layer, color: o.color, size, brush: o.brush ?? 'crayon', pressure: [0.5, 0.8, 0.5], speed: 700, seed: o.seed })];
}

/** A dot (an eye, a freckle): a tiny pressed stroke. */
export function dot(x: number, y: number, o: { layer: string; color: string; size: number; brush?: ScriptBrush }): ArtOp {
  return { op: 'stroke', layer: o.layer, brush: o.brush ?? 'ink', size: o.size, color: o.color, points: [[x, y, 0.8], [x + 0.3, y + 0.2, 0.9], [x + 0.1, y + 0.4, 0.8]], dt: 10 };
}

/** A lumpy round outline (a body, a head, a cloud): never a perfect circle. */
export function blob(cx: number, cy: number, r: number, o: { lumps?: number; seed?: number; squash?: number } = {}): Pt[] {
  const rand = rng(o.seed ?? 3);
  const lumps = o.lumps ?? 0.08;
  const n = 18;
  const phase = rand() * Math.PI * 2;
  return Array.from({ length: n }, (_, i) => {
    const t = (i / n) * Math.PI * 2 + phase;
    const k = 1 + (rand() - 0.5) * 2 * lumps;
    return [cx + Math.cos(t) * r * k, cy + Math.sin(t) * r * k * (o.squash ?? 1)] as Pt;
  });
}
