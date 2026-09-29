/**
 * Hand-drawn look for the sample drawings: wobbly outlines, fills that miss the lines, crayon
 * scribbles, doubled sketchy strokes. Paints the flat drawing plus the editor layers a student using
 * Amble would have made: `lines` (visible ink), optional `shading`, optional `part:<name>` layers.
 */
import type { Pixels } from '../types';
import { Painter, parseColor, polygonCoverage, type Coverage, type Pt, type RGB } from './raster';

const TAU = Math.PI * 2;

export const INK = '#2b2622';

/** Small fast seeded PRNG (mulberry32). */
export function rng(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function ellipse(cx: number, cy: number, rx: number, ry: number, rot = 0, n = 48): Pt[] {
  const out: Pt[] = [];
  const c = Math.cos(rot), s = Math.sin(rot);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU;
    const x = Math.cos(a) * rx, y = Math.sin(a) * ry;
    out.push([cx + x * c - y * s, cy + x * s + y * c]);
  }
  return out;
}

/** Tapered capsule from a (radius ra) to b (radius rb). */
export function capsule(ax: number, ay: number, bx: number, by: number, ra: number, rb: number, n = 16): Pt[] {
  const ang = Math.atan2(by - ay, bx - ax);
  const out: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const a = ang + Math.PI / 2 + (i / n) * Math.PI;
    out.push([ax + Math.cos(a) * ra, ay + Math.sin(a) * ra]);
  }
  for (let i = 0; i <= n; i++) {
    const a = ang - Math.PI / 2 + (i / n) * Math.PI;
    out.push([bx + Math.cos(a) * rb, by + Math.sin(a) * rb]);
  }
  return out;
}

export function star(cx: number, cy: number, r1: number, r2: number, rot = -Math.PI / 2): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < 10; i++) {
    const a = rot + (i * Math.PI) / 5;
    const r = i % 2 ? r2 : r1;
    out.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  return out;
}

export function roundRect(x0: number, y0: number, x1: number, y1: number, r: number): Pt[] {
  const out: Pt[] = [];
  const corners: [number, number, number][] = [[x1 - r, y0 + r, -Math.PI / 2], [x1 - r, y1 - r, 0], [x0 + r, y1 - r, Math.PI / 2], [x0 + r, y0 + r, Math.PI]];
  for (const [cx, cy, a0] of corners) for (let i = 0; i <= 6; i++) {
    const a = a0 + (i / 6) * (Math.PI / 2);
    out.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  return out;
}

function resample(pts: Pt[], step: number, closed: boolean): Pt[] {
  const out: Pt[] = [];
  const n = pts.length;
  const segs = closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const [x0, y0] = pts[i], [x1, y1] = pts[(i + 1) % n];
    const k = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / step));
    for (let j = 0; j < k; j++) out.push([x0 + ((x1 - x0) * j) / k, y0 + ((y1 - y0) * j) / k]);
  }
  if (!closed) out.push(pts[n - 1]);
  return out;
}

/** Pushes points along their normals with smooth low-frequency noise: the hand-drawn wobble. */
export function wobble(pts: Pt[], R: () => number, amp: number, closed = true): Pt[] {
  const p = resample(pts, 3, closed);
  const n = p.length;
  const f1 = 2 + Math.floor(R() * 3), f2 = 6 + Math.floor(R() * 4);
  const p1 = R() * TAU, p2 = R() * TAU;
  return p.map(([x, y], i) => {
    const a = p[closed ? (i - 1 + n) % n : Math.max(0, i - 1)], b = p[closed ? (i + 1) % n : Math.min(n - 1, i + 1)];
    let nx = -(b[1] - a[1]), ny = b[0] - a[0];
    const l = Math.hypot(nx, ny) || 1;
    nx /= l;
    ny /= l;
    const s = i / n;
    const fade = closed ? 1 : Math.min(1, i / 3, (n - 1 - i) / 3);
    const off = fade * (amp * (0.65 * Math.sin(TAU * f1 * s + p1) + 0.35 * Math.sin(TAU * f2 * s + p2)) + (R() - 0.5) * amp * 0.25);
    return [x + nx * off, y + ny * off];
  });
}

/** Smooths a polyline through its midpoints with quadratic curves (like a pen), flattened. */
export function smooth(pts: Pt[], closed: boolean, dx = 0, dy = 0): Pt[] {
  const n = pts.length;
  const out: Pt[] = [];
  const mid = (a: Pt, b: Pt): Pt => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const quad = (p0: Pt, c: Pt, p1: Pt) => {
    for (let k = 1; k <= 4; k++) {
      const t = k / 4, u = 1 - t;
      out.push([u * u * p0[0] + 2 * u * t * c[0] + t * t * p1[0] + dx, u * u * p0[1] + 2 * u * t * c[1] + t * t * p1[1] + dy]);
    }
  };
  if (n < 3) return pts.map(([x, y]) => [x + dx, y + dy]);
  if (closed) {
    let cur = mid(pts[n - 1], pts[0]);
    out.push([cur[0] + dx, cur[1] + dy]);
    for (let i = 0; i < n; i++) {
      const m = mid(pts[i], pts[(i + 1) % n]);
      quad(cur, pts[i], m);
      cur = m;
    }
    return out;
  }
  let cur = pts[0];
  out.push([cur[0] + dx, cur[1] + dy]);
  for (let i = 1; i < n - 1; i++) {
    const m = mid(pts[i], pts[i + 1]);
    quad(cur, pts[i], m);
    cur = m;
  }
  out.push([pts[n - 1][0] + dx, pts[n - 1][1] + dy]);
  return out;
}

export function shade(hex: string, k: number): string {
  const [r, g, b] = parseColor(hex);
  const f = (c: number) => Math.max(0, Math.min(255, Math.round(c * k)));
  return `rgb(${f(r)},${f(g)},${f(b)})`;
}

export interface ShapeStyle {
  fill?: string;
  stroke?: string;
  lw?: number;
  amp?: number;
  scribble?: boolean;
  /** Paint on this `part:<name>` layer too (the student drew this piece on its own layer). */
  part?: string;
  /** Paint on the shading layer instead of the drawing's main layers. */
  shading?: boolean;
}

/**
 * The student's paper: a flat drawing (painter's order, as a single-layer drawing would look),
 * the visible ink (`lines`), an optional `shading` layer and optional part layers.
 */
export class KidCanvas {
  readonly flat: Painter;
  readonly lines: Painter;
  readonly shading: Painter;
  readonly parts = new Map<string, Painter>();
  private usedShading = false;

  constructor(readonly width: number, readonly height: number, readonly R: () => number) {
    this.flat = new Painter(width, height);
    this.lines = new Painter(width, height);
    this.shading = new Painter(width, height);
  }

  private part(name: string): Painter {
    let p = this.parts.get(name);
    if (!p) this.parts.set(name, (p = new Painter(this.width, this.height)));
    return p;
  }

  private targets(st: { part?: string; shading?: boolean }): Painter[] {
    if (st.shading) {
      this.usedShading = true;
      return [this.flat, this.shading];
    }
    return st.part ? [this.flat, this.part(st.part)] : [this.flat];
  }

  /** A closed shape: fill (a little off the lines, with crayon scribbles) and a sketchy outline. */
  shape(base: Pt[], st: ShapeStyle): void {
    const R = this.R;
    const pts = wobble(base, R, st.amp ?? 1.6, true);
    const dst = this.targets(st);
    if (st.fill) {
      const sx = (R() - 0.5) * 3, sy = (R() - 0.5) * 3;
      const outline = smooth(pts, true, sx, sy);
      const fill = parseColor(st.fill);
      let cov: Coverage | null = null;
      for (const p of dst) cov = p.fill(outline, fill);
      if (cov && !st.shading) this.lines.erase(cov);
      if (st.scribble !== false && cov) {
        let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
        for (const [x, y] of pts) {
          x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
        }
        const col = parseColor(shade(st.fill, 0.86));
        for (const p of dst) p.setClip(cov);
        for (let k = x0 - (y1 - y0); k < x1; k += 5 + R() * 3) {
          const seg: Pt[] = [[k, y1 + 2], [k + (y1 - y0) + 4, y0 - 2 + (R() - 0.5) * 4]];
          for (const p of dst) p.stroke(seg, false, 1.4, col, 0.35);
        }
        for (const p of dst) p.setClip(null);
      }
    }
    if (st.stroke) {
      const col = parseColor(st.stroke);
      const lw = st.lw ?? 4;
      const main = smooth(pts, true);
      const sketch = smooth(wobble(base, R, (st.amp ?? 1.6) * 1.2, true), true, 0.8, 0.6);
      for (const p of [...dst, ...(st.shading ? [] : [this.lines])]) {
        p.stroke(main, true, lw, col);
        p.stroke(sketch, true, lw * 0.45, col, 0.45);
      }
    }
  }

  /** An open pen line (mouths, stick limbs, antennas). */
  line(pts: Pt[], color: string, lw: number, amp = 1.2, st: { part?: string; ink?: boolean } = {}): void {
    const path = smooth(wobble(pts, this.R, amp, false), false);
    const col = parseColor(color);
    for (const p of this.targets(st)) p.stroke(path, false, lw, col);
    if (st.ink !== false) this.lines.stroke(path, false, lw, col);
  }

  /** A flat dot or ellipse (eyes, cheeks, highlights). `ink` = it is part of the line art. */
  dot(cx: number, cy: number, rx: number, ry: number, color: string, alpha = 1, st: { part?: string; ink?: boolean } = {}): void {
    const pts = ellipse(cx, cy, rx, ry, 0, 32);
    const col = parseColor(color);
    for (const p of this.targets(st)) p.fill(pts, col, alpha);
    if (st.ink) this.lines.fill(pts, col, alpha);
    else this.lines.erase(polygonCoverage(pts, this.width, this.height), alpha);
  }

  result(): { image: Pixels; layers: Record<string, Pixels> } {
    const layers: Record<string, Pixels> = { lines: this.lines.toPixels() };
    if (this.usedShading) layers.shading = this.shading.toPixels();
    for (const [name, p] of this.parts) layers[`part:${name}`] = p.toPixels();
    return { image: this.flat.toPixels(), layers };
  }
}

export type { Pt, RGB };
