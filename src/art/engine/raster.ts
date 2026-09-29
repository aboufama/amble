/**
 * Software stroke rasterizer: writes coverage into Float32 alpha buffers (one float per document pixel).
 * Capsules (the convex hull of two circles, i.e. one tapered piece of a stroke) are rasterized from an
 * exact signed-distance function with a 1px anti-aliasing ramp and combined with MAX, so overlapping pieces,
 * the committed part and the re-drawn tail never double up (no beading, no seams, no dark knots).
 */
import { type Point, type Rect, addPoint } from './geom';

export const TILE = 64;

export interface Target {
  buf: Float32Array;
  W: number;
  H: number;
  /** Tile flags (TILE x TILE) set for every tile touched; null for scratch targets. */
  tiles: Uint8Array | null;
  tilesW: number;
  /** Accumulated bounding box of everything drawn (document px, float). */
  box: Rect;
}

/** Grain: a 256x256 tileable texture (0..255) and an alpha lookup per (pressure level 0..31, grain value). */
export interface Grain {
  tex: Uint8Array;
  lut: Float32Array;
}

export function makeTarget(W: number, H: number, withTiles: boolean): Target {
  const tilesW = Math.ceil(W / TILE);
  return {
    buf: new Float32Array(W * H),
    W,
    H,
    tiles: withTiles ? new Uint8Array(tilesW * Math.ceil(H / TILE)) : null,
    tilesW,
    box: { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity },
  };
}

function markTiles(t: Target, x0: number, y0: number, x1: number, y1: number): void {
  if (!t.tiles) return;
  const tx0 = (x0 / TILE) | 0;
  const tx1 = (x1 / TILE) | 0;
  const ty0 = (y0 / TILE) | 0;
  const ty1 = (y1 / TILE) | 0;
  for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) t.tiles[ty * t.tilesW + tx] = 1;
}

/** Records that pixels in [x0,x1]x[y0,y1] (inclusive) were written. */
export function touch(t: Target, x0: number, y0: number, x1: number, y1: number): void {
  addPoint(t.box, x0, y0, 0);
  addPoint(t.box, x1 + 1, y1 + 1, 0);
  markTiles(t, x0, y0, x1, y1);
}

/**
 * One stroke piece from A (radius ra, pressure pa) to B (rb, pb), max-combined into t.buf.
 * Radii under 0.5px are drawn at 0.5px with proportionally less alpha, so hairline tips fade instead of breaking up.
 */
export function capsule(
  t: Target,
  ax: number,
  ay: number,
  ra: number,
  pa: number,
  bx: number,
  by: number,
  rb: number,
  pb: number,
  opacity: number,
  grain: Grain | null,
): void {
  const raC = ra < 0.5 ? 0.5 : ra;
  const rbC = rb < 0.5 ? 0.5 : rb;
  const fa = ra < 0.5 ? ra * 2 : 1;
  const fb = rb < 0.5 ? rb * 2 : 1;
  const rmax = raC > rbC ? raC : rbC;
  const W = t.W;
  const x0 = Math.max(0, Math.floor(Math.min(ax, bx) - rmax - 1));
  const x1 = Math.min(W - 1, Math.ceil(Math.max(ax, bx) + rmax + 1));
  const y0 = Math.max(0, Math.floor(Math.min(ay, by) - rmax - 1));
  const y1 = Math.min(t.H - 1, Math.ceil(Math.max(ay, by) + rmax + 1));
  if (x0 > x1 || y0 > y1) return;
  touch(t, x0, y0, x1, y1);

  const buf = t.buf;
  const dx = bx - ax;
  const dy = by - ay;
  const h = dx * dx + dy * dy;
  const bb = raC - rbC;
  const degenerate = h <= bb * bb + 1e-6;
  // Degenerate: one circle contains the other; draw the bigger one.
  const cxD = raC >= rbC ? ax : bx;
  const cyD = raC >= rbC ? ay : by;
  const crD = raC >= rbC ? raC : rbC;
  const cfD = raC >= rbC ? fa : fb;
  const cpD = raC >= rbC ? pa : pb;
  const invH = degenerate ? 0 : 1 / h;
  const cx = degenerate ? 0 : Math.sqrt(h - bb * bb);
  const tex = grain ? grain.tex : null;
  const lut = grain ? grain.lut : null;

  for (let y = y0; y <= y1; y++) {
    const py = y + 0.5 - ay;
    let i = y * W + x0;
    const trow = (y & 255) << 8;
    for (let x = x0; x <= x1; x++, i++) {
      const px = x + 0.5 - ax;
      let sd: number;
      let tt: number;
      if (degenerate) {
        sd = Math.hypot(x + 0.5 - cxD, y + 0.5 - cyD) - crD;
        tt = -1;
      } else {
        let qx = (px * dy - py * dx) * invH;
        if (qx < 0) qx = -qx;
        const qy = (px * dx + py * dy) * invH;
        const k = cx * qy - bb * qx;
        const n = qx * qx + qy * qy;
        if (k < 0) sd = Math.sqrt(h * n) - raC;
        else if (k > cx) sd = Math.sqrt(h * (n + 1 - 2 * qy)) - rbC;
        else sd = cx * qx + bb * qy - raC;
        tt = qy < 0 ? 0 : qy > 1 ? 1 : qy;
      }
      let a = 0.5 - sd;
      if (a <= 0) continue;
      if (a > 1) a = 1;
      if (tt < 0) {
        a *= cfD * opacity;
        if (lut && tex) {
          // Grain shows more toward the edge of the stroke (lighter, broken edges; solid centre).
          let e = -sd / (0.6 * crD);
          if (e > 1) e = 1;
          else if (e < 0) e = 0;
          const pe = cpD * (0.55 + 0.45 * e);
          a *= lut[(((pe * 31 + 0.5) | 0) << 8) | tex[trow | (x & 255)]];
        }
      } else {
        a *= (fa + (fb - fa) * tt) * opacity;
        if (lut && tex) {
          let e = -sd / (0.6 * (raC + (rbC - raC) * tt));
          if (e > 1) e = 1;
          else if (e < 0) e = 0;
          const pe = (pa + (pb - pa) * tt) * (0.55 + 0.45 * e);
          a *= lut[(((pe * 31 + 0.5) | 0) << 8) | tex[trow | (x & 255)]];
        }
      }
      if (a > buf[i]) buf[i] = a;
    }
  }
}

/** Soft round dab that accumulates (airbrush): buf = buf + a * (1 - buf). */
export function softDab(t: Target, cx: number, cy: number, r: number, flow: number): void {
  const W = t.W;
  const x0 = Math.max(0, Math.floor(cx - r));
  const x1 = Math.min(W - 1, Math.ceil(cx + r));
  const y0 = Math.max(0, Math.floor(cy - r));
  const y1 = Math.min(t.H - 1, Math.ceil(cy + r));
  if (x0 > x1 || y0 > y1 || r <= 0) return;
  touch(t, x0, y0, x1, y1);
  const inv = 1 / (r * r);
  const buf = t.buf;
  for (let y = y0; y <= y1; y++) {
    const dy = y + 0.5 - cy;
    let i = y * W + x0;
    for (let x = x0; x <= x1; x++, i++) {
      const dx = x + 0.5 - cx;
      const d2 = (dx * dx + dy * dy) * inv;
      if (d2 >= 1) continue;
      const f = 1 - d2;
      const a = flow * f * f;
      buf[i] += a * (1 - buf[i]);
    }
  }
}

/** A hard-edged square of `size` px (pixel-art brush); the square's centre is at pixel (px, py). */
export function stampSquare(t: Target, px: number, py: number, size: number, value = 1): void {
  const s = Math.max(1, Math.round(size));
  const x0 = Math.max(0, px - ((s - 1) >> 1));
  const y0 = Math.max(0, py - ((s - 1) >> 1));
  const x1 = Math.min(t.W - 1, px - ((s - 1) >> 1) + s - 1);
  const y1 = Math.min(t.H - 1, py - ((s - 1) >> 1) + s - 1);
  if (x0 > x1 || y0 > y1) return;
  touch(t, x0, y0, x1, y1);
  for (let y = y0; y <= y1; y++) t.buf.fill(value, y * t.W + x0, y * t.W + x1 + 1);
}

/**
 * Anti-aliased polygon coverage (nonzero winding, 4 sub-rows per pixel with exact horizontal coverage),
 * max-combined into t.buf. Used for filled shapes, lasso fill and selection masks.
 */
export function fillPolygon(t: Target, pts: Point[], opacity: number): void {
  const n = pts.length;
  if (n < 3) return;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  const x0 = Math.max(0, Math.floor(minX));
  const x1 = Math.min(t.W - 1, Math.ceil(maxX));
  const y0 = Math.max(0, Math.floor(minY));
  const y1 = Math.min(t.H - 1, Math.ceil(maxY));
  if (x0 > x1 || y0 > y1) return;
  touch(t, x0, y0, x1, y1);

  // Edge list sorted by top y: [ya, yb, xa, slope, dir].
  const edges: Array<[number, number, number, number, number]> = [];
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    if (a.y === b.y) continue;
    const dir = b.y > a.y ? 1 : -1;
    const top = dir > 0 ? a : b;
    const bot = dir > 0 ? b : a;
    edges.push([top.y, bot.y, top.x, (bot.x - top.x) / (bot.y - top.y), dir]);
  }
  edges.sort((p, q) => p[0] - q[0]);
  const SS = 4;
  const w = x1 - x0 + 1;
  const row = new Float32Array(w + 1);
  const xs: number[] = [];
  const dirs: number[] = [];
  let next = 0;
  const active: Array<[number, number, number, number, number]> = [];
  for (let y = y0; y <= y1; y++) {
    row.fill(0);
    for (let k = 0; k < SS; k++) {
      const sy = y + (k + 0.5) / SS;
      while (next < edges.length && edges[next][0] <= sy) active.push(edges[next++]);
      for (let e = active.length - 1; e >= 0; e--) if (active[e][1] <= sy) active.splice(e, 1);
      xs.length = 0;
      dirs.length = 0;
      for (const e of active) {
        if (e[0] > sy) continue;
        const x = e[2] + (sy - e[0]) * e[3];
        let j = xs.length;
        while (j > 0 && xs[j - 1] > x) j--;
        xs.splice(j, 0, x);
        dirs.splice(j, 0, e[4]);
      }
      let wind = 0;
      for (let j = 0; j < xs.length - 1; j++) {
        wind += dirs[j];
        if (wind === 0) continue;
        spanCoverage(row, xs[j] - x0, xs[j + 1] - x0, w, 1 / SS);
      }
    }
    const buf = t.buf;
    const base = y * t.W + x0;
    for (let i = 0; i < w; i++) {
      let a = row[i];
      if (a <= 0) continue;
      if (a > 1) a = 1;
      a *= opacity;
      if (a > buf[base + i]) buf[base + i] = a;
    }
  }
}

/** Adds `weight` times the covered fraction of each pixel in [xa, xb) to row. */
function spanCoverage(row: Float32Array, xa: number, xb: number, w: number, weight: number): void {
  if (xb <= 0 || xa >= w || xb <= xa) return;
  if (xa < 0) xa = 0;
  if (xb > w) xb = w;
  const ia = Math.floor(xa);
  const ib = Math.floor(xb);
  if (ia === ib) {
    row[ia] += (xb - xa) * weight;
    return;
  }
  row[ia] += (ia + 1 - xa) * weight;
  for (let i = ia + 1; i < ib; i++) row[i] += weight;
  if (ib < w) row[ib] += (xb - ib) * weight;
}

export function clearRect(buf: Float32Array, W: number, r: Rect): void {
  for (let y = r.y0; y < r.y1; y++) buf.fill(0, y * W + r.x0, y * W + r.x1);
}
