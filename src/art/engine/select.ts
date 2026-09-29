/**
 * Lasso and rectangle selections: lift the selected pixels off a layer (anti-aliased edge), transform them
 * (move, scale, rotate, flip) and stamp them back with bilinear filtering in premultiplied space (nearest
 * for pixel art). The same stamp renders the live preview and the commit.
 */
import { type Point, type Rect, emptyRect, isEmpty, toPixels } from './geom';
import { fillPolygon, makeTarget } from './raster';
import { compositeLayer } from './blend';
import type { Board } from './board';
import type { Affine6 } from './log';

export interface Floating {
  frame: string;
  layer: string;
  polygon: Point[];
  /** Integer box of the lifted pixels on the board. */
  box: Rect;
  /** Box-sized straight RGBA of the lifted pixels. */
  rgba: Uint8ClampedArray;
}

/** A friendly transform: scale and rotate about the selection's centre, then move. */
export interface SelectionTransform {
  tx: number;
  ty: number;
  /** Negative = flipped. */
  sx: number;
  sy: number;
  /** Radians. */
  rot: number;
}

export const IDENTITY: SelectionTransform = { tx: 0, ty: 0, sx: 1, sy: 1, rot: 0 };

export function matrixOf(t: SelectionTransform, cx: number, cy: number): Affine6 {
  const c = Math.cos(t.rot);
  const s = Math.sin(t.rot);
  const a = c * t.sx;
  const b = s * t.sx;
  const cc = -s * t.sy;
  const d = c * t.sy;
  return [a, b, cc, d, cx + t.tx - (a * cx + cc * cy), cy + t.ty - (b * cx + d * cy)];
}

export function invert(m: Affine6): Affine6 | null {
  const [a, b, c, d, e, f] = m;
  const det = a * d - b * c;
  if (Math.abs(det) < 1e-9) return null;
  return [d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det];
}

export function apply(m: Affine6, x: number, y: number): Point {
  return { x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] };
}

export function isIdentity(m: Affine6): boolean {
  return Math.abs(m[0] - 1) < 1e-9 && Math.abs(m[1]) < 1e-9 && Math.abs(m[2]) < 1e-9 && Math.abs(m[3] - 1) < 1e-9 && Math.abs(m[4]) < 1e-9 && Math.abs(m[5]) < 1e-9;
}

/** The rectangle selection as a polygon. */
export function rectPolygon(x0: number, y0: number, x1: number, y1: number): Point[] {
  return [
    { x: Math.min(x0, x1), y: Math.min(y0, y1) },
    { x: Math.max(x0, x1), y: Math.min(y0, y1) },
    { x: Math.max(x0, x1), y: Math.max(y0, y1) },
    { x: Math.min(x0, x1), y: Math.max(y0, y1) },
  ];
}

/** Anti-aliased (hard for pixel art) coverage of a polygon on the board: box and box-sized mask. */
export function polygonMask(polygon: Point[], W: number, H: number, hard: boolean): { box: Rect; mask: Float32Array } | null {
  if (polygon.length < 3) return null;
  const t = makeTarget(W, H, false);
  fillPolygon(t, polygon, 1);
  const box = toPixels(t.box, W, H);
  if (isEmpty(box)) return null;
  const bw = box.x1 - box.x0;
  const mask = new Float32Array(bw * (box.y1 - box.y0));
  for (let y = box.y0; y < box.y1; y++)
    for (let x = box.x0; x < box.x1; x++) {
      const v = t.buf[y * W + x];
      mask[(y - box.y0) * bw + (x - box.x0)] = hard ? (v >= 0.5 ? 1 : 0) : v;
    }
  return { box, mask };
}

/**
 * Lifts the pixels inside `polygon` off the layer (leaving a hole) and returns them, or null when the
 * selection is empty. The caller snapshots the layer for undo first.
 */
export function lift(
  board: Board,
  frame: string,
  layer: string,
  polygon: Point[],
  pm: { box: Rect; mask: Float32Array } | null = polygonMask(polygon, board.W, board.H, board.pixelArt),
): Floating | null {
  if (!pm) return null;
  const { box, mask } = pm;
  const W = board.W;
  const data = board.pixels(frame, layer, true);
  const bw = box.x1 - box.x0;
  const rgba = new Uint8ClampedArray(bw * (box.y1 - box.y0) * 4);
  let any = false;
  for (let y = box.y0; y < box.y1; y++)
    for (let x = box.x0; x < box.x1; x++) {
      const k = (y - box.y0) * bw + (x - box.x0);
      const m = mask[k];
      if (m <= 0) continue;
      const j = (y * W + x) * 4;
      const a = data[j + 3];
      if (a === 0) continue;
      rgba[k * 4] = data[j];
      rgba[k * 4 + 1] = data[j + 1];
      rgba[k * 4 + 2] = data[j + 2];
      rgba[k * 4 + 3] = a * m;
      data[j + 3] = a * (1 - m);
      // Fully lifted pixels become all zero (smaller PNGs, canonical pixels).
      if (data[j + 3] === 0) data[j] = data[j + 1] = data[j + 2] = 0;
      any = true;
    }
  if (!any) return null;
  board.changed(frame, layer, box);
  return { frame, layer, polygon, box, rgba };
}

/**
 * One floating image from several layers lifted with the same outline (bottom to top), each composited
 * with its layer's opacity and blend: what the drawing looks like there, as a single piece.
 */
export function mergeFloating(board: Board, fls: readonly Floating[]): Floating {
  const f0 = fls[0];
  const bw = f0.box.x1 - f0.box.x0;
  const bh = f0.box.y1 - f0.box.y0;
  const rgba = new Uint8ClampedArray(bw * bh * 4);
  for (const fl of fls) {
    const l = board.layer(fl.layer);
    compositeLayer(rgba, fl.rgba, bw, bh, null, l?.opacity ?? 1, l?.blend ?? 'normal');
  }
  return { ...f0, rgba };
}

/** Halves an RGBA image (box filter in premultiplied space). */
function halve(src: Uint8ClampedArray, w: number, h: number): { rgba: Uint8ClampedArray; w: number; h: number } {
  const w2 = Math.max(1, w >> 1);
  const h2 = Math.max(1, h >> 1);
  const out = new Uint8ClampedArray(w2 * h2 * 4);
  for (let y = 0; y < h2; y++)
    for (let x = 0; x < w2; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let dy = 0; dy < 2; dy++)
        for (let dx = 0; dx < 2; dx++) {
          const sx = Math.min(w - 1, x * 2 + dx);
          const sy = Math.min(h - 1, y * 2 + dy);
          const j = (sy * w + sx) * 4;
          const al = src[j + 3];
          r += src[j] * al;
          g += src[j + 1] * al;
          b += src[j + 2] * al;
          a += al;
        }
      const o = (y * w2 + x) * 4;
      if (a > 0) {
        out[o] = r / a;
        out[o + 1] = g / a;
        out[o + 2] = b / a;
      }
      out[o + 3] = a / 4;
    }
  return { rgba: out, w: w2, h: h2 };
}

/** Where a floating selection lands under matrix m (integer rect on the board). */
export function stampRect(fl: Floating, m: Affine6, W: number, H: number): Rect {
  const r = emptyRect();
  const b = fl.box;
  for (const [x, y] of [
    [b.x0, b.y0],
    [b.x1, b.y0],
    [b.x0, b.y1],
    [b.x1, b.y1],
  ]) {
    const p = apply(m, x, y);
    r.x0 = Math.min(r.x0, p.x);
    r.y0 = Math.min(r.y0, p.y);
    r.x1 = Math.max(r.x1, p.x);
    r.y1 = Math.max(r.y1, p.y);
  }
  return toPixels(r, W, H, 1);
}

/**
 * Composites the floating pixels, transformed by m, over `dst` (a board-sized RGBA buffer) inside `clip`.
 * Bilinear in premultiplied space (nearest when `nearest`), with a halving pyramid when shrinking a lot.
 */
export function stampInto(dst: Uint8ClampedArray, W: number, H: number, fl: Floating, m: Affine6, nearest: boolean, clip: Rect | null): Rect {
  const target = stampRect(fl, m, W, H);
  const r = clip ? { x0: Math.max(target.x0, clip.x0), y0: Math.max(target.y0, clip.y0), x1: Math.min(target.x1, clip.x1), y1: Math.min(target.y1, clip.y1) } : target;
  if (isEmpty(r)) return r;
  let src = fl.rgba;
  let sw = fl.box.x1 - fl.box.x0;
  let sh = fl.box.y1 - fl.box.y0;
  // Source pixel coords (relative to the box) per board pixel: inverse of m, shifted to the box.
  let inv = invert(m);
  if (!inv) return emptyRect();
  let k = 1;
  if (!nearest) {
    const scale = Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));
    while (scale * k < 0.5 && sw > 2 && sh > 2) {
      const h2 = halve(src, sw, sh);
      src = h2.rgba;
      sw = h2.w;
      sh = h2.h;
      k *= 2;
    }
  }
  inv = inv as Affine6;
  const ox = fl.box.x0;
  const oy = fl.box.y0;
  for (let y = r.y0; y < r.y1; y++) {
    for (let x = r.x0; x < r.x1; x++) {
      const bx = inv[0] * (x + 0.5) + inv[2] * (y + 0.5) + inv[4];
      const by = inv[1] * (x + 0.5) + inv[3] * (y + 0.5) + inv[5];
      const u = (bx - ox) / k;
      const v = (by - oy) / k;
      let R = 0;
      let G = 0;
      let B = 0;
      let A = 0;
      if (nearest) {
        const ix = Math.floor(u);
        const iy = Math.floor(v);
        if (ix < 0 || iy < 0 || ix >= sw || iy >= sh) continue;
        const j = (iy * sw + ix) * 4;
        A = src[j + 3] / 255;
        if (A <= 0) continue;
        R = src[j];
        G = src[j + 1];
        B = src[j + 2];
      } else {
        const fx = u - 0.5;
        const fy = v - 0.5;
        const x0 = Math.floor(fx);
        const y0 = Math.floor(fy);
        const tx = fx - x0;
        const ty = fy - y0;
        if (x0 < -1 || y0 < -1 || x0 >= sw || y0 >= sh) continue;
        let pr = 0;
        let pg = 0;
        let pb = 0;
        let pa = 0;
        for (let dy = 0; dy < 2; dy++) {
          const yy = y0 + dy;
          if (yy < 0 || yy >= sh) continue;
          const wy = dy ? ty : 1 - ty;
          for (let dx = 0; dx < 2; dx++) {
            const xx = x0 + dx;
            if (xx < 0 || xx >= sw) continue;
            const w = wy * (dx ? tx : 1 - tx);
            const j = (yy * sw + xx) * 4;
            const a = (src[j + 3] / 255) * w;
            pr += src[j] * a;
            pg += src[j + 1] * a;
            pb += src[j + 2] * a;
            pa += a;
          }
        }
        if (pa <= 0.0005) continue;
        R = pr / pa;
        G = pg / pa;
        B = pb / pa;
        A = pa;
      }
      const o = (y * W + x) * 4;
      const ad = dst[o + 3] / 255;
      const ao = A + ad * (1 - A);
      const ks = A / ao;
      const kd = (ad * (1 - A)) / ao;
      dst[o] = R * ks + dst[o] * kd;
      dst[o + 1] = G * ks + dst[o + 1] * kd;
      dst[o + 2] = B * ks + dst[o + 2] * kd;
      dst[o + 3] = ao * 255;
    }
  }
  return r;
}

/** Stamps a floating selection onto a layer; returns the changed rect. */
export function stamp(board: Board, frame: string, layer: string, fl: Floating, m: Affine6): Rect {
  const data = board.pixels(frame, layer, true);
  const r = stampInto(data, board.W, board.H, fl, m, board.pixelArt, null);
  if (!isEmpty(r)) board.changed(frame, layer, r);
  return r;
}
