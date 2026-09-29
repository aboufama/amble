/** Axis-aligned rectangles in document pixels (x1/y1 exclusive) and small math helpers. */
export interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface Point {
  x: number;
  y: number;
}

export function emptyRect(): Rect {
  return { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
}

export function isEmpty(r: Rect): boolean {
  return !(r.x1 > r.x0 && r.y1 > r.y0);
}

export function reset(r: Rect): void {
  r.x0 = r.y0 = Infinity;
  r.x1 = r.y1 = -Infinity;
}

export function addPoint(r: Rect, x: number, y: number, pad: number): void {
  if (x - pad < r.x0) r.x0 = x - pad;
  if (y - pad < r.y0) r.y0 = y - pad;
  if (x + pad > r.x1) r.x1 = x + pad;
  if (y + pad > r.y1) r.y1 = y + pad;
}

export function unionInto(a: Rect, b: Rect): void {
  if (isEmpty(b)) return;
  if (b.x0 < a.x0) a.x0 = b.x0;
  if (b.y0 < a.y0) a.y0 = b.y0;
  if (b.x1 > a.x1) a.x1 = b.x1;
  if (b.y1 > a.y1) a.y1 = b.y1;
}

export function union(a: Rect, b: Rect): Rect {
  const r = copyRect(a);
  unionInto(r, b);
  return r;
}

export function intersect(a: Rect, b: Rect): Rect {
  return { x0: Math.max(a.x0, b.x0), y0: Math.max(a.y0, b.y0), x1: Math.min(a.x1, b.x1), y1: Math.min(a.y1, b.y1) };
}

export function copyRect(r: Rect): Rect {
  return { x0: r.x0, y0: r.y0, x1: r.x1, y1: r.y1 };
}

export function rectOf(x: number, y: number, w: number, h: number): Rect {
  return { x0: x, y0: y, x1: x + w, y1: y + h };
}

/** Integer pixel bounds, padded, clamped to [0,W]x[0,H]. */
export function toPixels(r: Rect, W: number, H: number, pad = 0): Rect {
  return {
    x0: Math.max(0, Math.floor(r.x0 - pad)),
    y0: Math.max(0, Math.floor(r.y0 - pad)),
    x1: Math.min(W, Math.ceil(r.x1 + pad)),
    y1: Math.min(H, Math.ceil(r.y1 + pad)),
  };
}

/** Expands an integer rect outward to whole tiles, clamped to the board. */
export function tileAlign(r: Rect, tile: number, W: number, H: number): Rect {
  return {
    x0: Math.max(0, Math.floor(r.x0 / tile) * tile),
    y0: Math.max(0, Math.floor(r.y0 / tile) * tile),
    x1: Math.min(W, Math.ceil(r.x1 / tile) * tile),
    y1: Math.min(H, Math.ceil(r.y1 / tile) * tile),
  };
}

export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const smoothstep = (e0: number, e1: number, x: number): number => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};

/** Distance from p to the segment ab. */
export function segDist(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const h = dx * dx + dy * dy || 1;
  const t = clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / h, 0, 1);
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}
