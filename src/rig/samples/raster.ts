/**
 * A tiny anti-aliased rasterizer in plain TypeScript: polygon fills (nonzero winding, 4 sub-rows with
 * exact horizontal coverage) and round-capped strokes (max-union of capsule distance fields).
 * It exists so the sample "kid drawings" render the same pixels in Node tests, workers and browsers.
 */
import type { Pixels } from '../types';

export type Pt = [number, number];
export type RGB = [number, number, number];

export function parseColor(css: string): RGB {
  if (css.startsWith('#')) {
    const v = parseInt(css.slice(1), 16);
    return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
  }
  const m = css.match(/[\d.]+/g);
  return m ? [Number(m[0]), Number(m[1]), Number(m[2])] : [0, 0, 0];
}

/** Coverage (0..1) of a shape over a box of the canvas. */
export interface Coverage {
  x0: number;
  y0: number;
  w: number;
  h: number;
  c: Float32Array;
}

export function polygonCoverage(pts: Pt[], W: number, H: number): Coverage {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of pts) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const x0 = Math.max(0, Math.floor(minX)), y0 = Math.max(0, Math.floor(minY));
  const x1 = Math.min(W - 1, Math.ceil(maxX)), y1 = Math.min(H - 1, Math.ceil(maxY));
  const w = Math.max(0, x1 - x0 + 1), h = Math.max(0, y1 - y0 + 1);
  const c = new Float32Array(w * h);
  const n = pts.length;
  const xs: number[] = [];
  const dirs: number[] = [];
  const order: number[] = [];
  const SUB = 4;
  for (let row = 0; row < h; row++) {
    for (let s = 0; s < SUB; s++) {
      const sy = y0 + row + (s + 0.5) / SUB;
      xs.length = 0;
      dirs.length = 0;
      for (let i = 0; i < n; i++) {
        const [ax, ay] = pts[i];
        const [bx, by] = pts[(i + 1) % n];
        if (ay === by) continue;
        const lo = Math.min(ay, by), hi = Math.max(ay, by);
        if (sy < lo || sy >= hi) continue;
        xs.push(ax + ((sy - ay) * (bx - ax)) / (by - ay));
        dirs.push(by > ay ? 1 : -1);
      }
      if (xs.length < 2) continue;
      order.length = 0;
      for (let i = 0; i < xs.length; i++) order.push(i);
      order.sort((a, b) => xs[a] - xs[b]);
      let wind = 0;
      for (let k = 0; k < order.length - 1; k++) {
        wind += dirs[order[k]];
        if (wind === 0) continue;
        const xa = Math.max(x0, xs[order[k]]), xb = Math.min(x1 + 1, xs[order[k + 1]]);
        if (xb <= xa) continue;
        const pa = Math.floor(xa), pb = Math.floor(xb);
        const base = row * w - x0;
        if (pa === pb) {
          c[base + pa] += (xb - xa) / SUB;
          continue;
        }
        c[base + pa] += (pa + 1 - xa) / SUB;
        for (let px = pa + 1; px < pb; px++) c[base + px] += 1 / SUB;
        if (pb <= x1) c[base + pb] += (xb - pb) / SUB;
      }
    }
  }
  for (let i = 0; i < c.length; i++) if (c[i] > 1) c[i] = 1;
  return { x0, y0, w, h, c };
}

/** Coverage of a polyline stroked with round caps and joins. */
export function strokeCoverage(pts: Pt[], closed: boolean, width: number, W: number, H: number): Coverage {
  const hw = width / 2;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of pts) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const x0 = Math.max(0, Math.floor(minX - hw - 1)), y0 = Math.max(0, Math.floor(minY - hw - 1));
  const x1 = Math.min(W - 1, Math.ceil(maxX + hw + 1)), y1 = Math.min(H - 1, Math.ceil(maxY + hw + 1));
  const w = Math.max(0, x1 - x0 + 1), h = Math.max(0, y1 - y0 + 1);
  const c = new Float32Array(w * h);
  const segs = closed ? pts.length : pts.length - 1;
  for (let i = 0; i < Math.max(1, segs); i++) {
    const [ax, ay] = pts[i];
    const [bx, by] = pts[Math.min(pts.length - 1, closed ? (i + 1) % pts.length : i + 1)];
    const vx = bx - ax, vy = by - ay;
    const l2 = vx * vx + vy * vy;
    const sx0 = Math.max(x0, Math.floor(Math.min(ax, bx) - hw - 1)), sx1 = Math.min(x1, Math.ceil(Math.max(ax, bx) + hw + 1));
    const sy0 = Math.max(y0, Math.floor(Math.min(ay, by) - hw - 1)), sy1 = Math.min(y1, Math.ceil(Math.max(ay, by) + hw + 1));
    for (let py = sy0; py <= sy1; py++) {
      for (let px = sx0; px <= sx1; px++) {
        const qx = px + 0.5 - ax, qy = py + 0.5 - ay;
        const t = l2 > 0 ? Math.max(0, Math.min(1, (qx * vx + qy * vy) / l2)) : 0;
        const d = Math.hypot(qx - vx * t, qy - vy * t);
        const cov = hw - d + 0.5;
        if (cov <= 0) continue;
        const o = (py - y0) * w + (px - x0);
        const v = cov > 1 ? 1 : cov;
        if (v > c[o]) c[o] = v;
      }
    }
  }
  return { x0, y0, w, h, c };
}

/** A premultiplied float RGBA canvas with source-over painting and an optional clip coverage. */
export class Painter {
  readonly buf: Float32Array;
  private clip: Float32Array | null = null;

  constructor(readonly width: number, readonly height: number) {
    this.buf = new Float32Array(width * height * 4);
  }

  /** Restrict painting to a coverage (e.g. a filled shape, for crayon scribbles), or lift it. */
  setClip(cov: Coverage | null): void {
    if (!cov) {
      this.clip = null;
      return;
    }
    const clip = new Float32Array(this.width * this.height);
    for (let y = 0; y < cov.h; y++) for (let x = 0; x < cov.w; x++) clip[(cov.y0 + y) * this.width + cov.x0 + x] = cov.c[y * cov.w + x];
    this.clip = clip;
  }

  paint(cov: Coverage, color: RGB, alpha = 1): void {
    const { buf, width } = this;
    const [r, g, b] = color;
    for (let y = 0; y < cov.h; y++) {
      for (let x = 0; x < cov.w; x++) {
        let a = cov.c[y * cov.w + x] * alpha;
        if (a <= 0) continue;
        const p = (cov.y0 + y) * width + cov.x0 + x;
        if (this.clip) a *= this.clip[p];
        if (a <= 0) continue;
        const o = p * 4, k = 1 - a;
        buf[o] = r * a + buf[o] * k;
        buf[o + 1] = g * a + buf[o + 1] * k;
        buf[o + 2] = b * a + buf[o + 2] * k;
        buf[o + 3] = a + buf[o + 3] * k;
      }
    }
  }

  /** destination-out: removes paint under the coverage. */
  erase(cov: Coverage, alpha = 1): void {
    const { buf, width } = this;
    for (let y = 0; y < cov.h; y++) {
      for (let x = 0; x < cov.w; x++) {
        const a = cov.c[y * cov.w + x] * alpha;
        if (a <= 0) continue;
        const o = ((cov.y0 + y) * width + cov.x0 + x) * 4, k = 1 - a;
        buf[o] *= k;
        buf[o + 1] *= k;
        buf[o + 2] *= k;
        buf[o + 3] *= k;
      }
    }
  }

  fill(pts: Pt[], color: RGB, alpha = 1): Coverage {
    const cov = polygonCoverage(pts, this.width, this.height);
    this.paint(cov, color, alpha);
    return cov;
  }

  stroke(pts: Pt[], closed: boolean, width: number, color: RGB, alpha = 1): Coverage {
    const cov = strokeCoverage(pts, closed, width, this.width, this.height);
    this.paint(cov, color, alpha);
    return cov;
  }

  /** Paints another painter's pixels over this one (source-over). */
  drawPainter(src: Painter): void {
    const d = this.buf, s = src.buf;
    for (let o = 0; o < d.length; o += 4) {
      const a = s[o + 3];
      if (a <= 0) continue;
      const k = 1 - a;
      d[o] = s[o] + d[o] * k;
      d[o + 1] = s[o + 1] + d[o + 1] * k;
      d[o + 2] = s[o + 2] + d[o + 2] * k;
      d[o + 3] = a + d[o + 3] * k;
    }
  }

  toPixels(): Pixels {
    const n = this.width * this.height;
    const data = new Uint8ClampedArray(n * 4);
    const b = this.buf;
    for (let i = 0; i < n; i++) {
      const o = i * 4, a = b[o + 3];
      if (a <= 1e-4) continue;
      data[o] = b[o] / a;
      data[o + 1] = b[o + 1] / a;
      data[o + 2] = b[o + 2] / a;
      data[o + 3] = a * 255;
    }
    return { data, width: this.width, height: this.height };
  }
}
