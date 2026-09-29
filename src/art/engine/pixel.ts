/**
 * The pixel pen for pixel-art boards: hard squares on whole pixels, no smoothing and no anti-aliasing,
 * with Aseprite's "pixel perfect" rule for 1 px lines (the middle pixel of an L-shaped step is removed, so
 * freehand diagonals stay one pixel wide).
 */
import { type Rect, addPoint, emptyRect, isEmpty, reset, toPixels } from './geom';
import { type Target, clearRect, makeTarget, stampSquare } from './raster';
import { type Symmetry, symmetryMaps } from './stroke';

interface Px {
  x: number;
  y: number;
}

export class PixelStroke {
  readonly W: number;
  readonly H: number;
  readonly prefix: Target;
  private size = 1;
  private path: Px[] = [];
  private counts = new Map<number, number>();
  private maps = symmetryMaps(null);
  private dirty: Rect = emptyRect();
  active = false;

  constructor(W: number, H: number) {
    this.W = W;
    this.H = H;
    this.prefix = makeTarget(W, H, true);
  }

  begin(size: number, symmetry: Symmetry | null, x: number, y: number): void {
    this.size = Math.max(1, Math.round(size));
    this.maps = symmetryMaps(symmetry);
    this.path = [];
    this.counts.clear();
    reset(this.prefix.box);
    this.prefix.tiles?.fill(0);
    this.active = true;
    this.add(Math.floor(x), Math.floor(y));
  }

  addSample(x: number, y: number): void {
    if (!this.active) return;
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const last = this.path[this.path.length - 1];
    if (last.x === ix && last.y === iy) return;
    // Bresenham from the last pixel, one 8-connected step at a time.
    let x0 = last.x;
    let y0 = last.y;
    const dx = Math.abs(ix - x0);
    const dy = -Math.abs(iy - y0);
    const sx = x0 < ix ? 1 : -1;
    const sy = y0 < iy ? 1 : -1;
    let err = dx + dy;
    while (x0 !== ix || y0 !== iy) {
      const e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        x0 += sx;
      }
      if (e2 <= dx) {
        err += dx;
        y0 += sy;
      }
      this.add(x0, y0);
    }
  }

  private add(x: number, y: number): void {
    const n = this.path.length;
    if (this.size === 1 && n >= 2) {
      const a = this.path[n - 2];
      const b = this.path[n - 1];
      const orthoA = Math.abs(a.x - b.x) + Math.abs(a.y - b.y) === 1;
      const orthoC = Math.abs(x - b.x) + Math.abs(y - b.y) === 1;
      if (orthoA && orthoC && Math.abs(a.x - x) === 1 && Math.abs(a.y - y) === 1) {
        this.path.pop();
        this.stamp(b.x, b.y, -1);
      }
    }
    this.path.push({ x, y });
    this.stamp(x, y, 1);
  }

  private stamp(x: number, y: number, delta: 1 | -1): void {
    for (const m of this.maps) {
      // Pixel [x, x+1) maps to the pixel whose centre is the image of (x + 0.5, y + 0.5).
      const cx = m[0] * (x + 0.5) + m[2] * (y + 0.5) + m[4];
      const cy = m[1] * (x + 0.5) + m[3] * (y + 0.5) + m[5];
      const px = Math.floor(cx);
      const py = Math.floor(cy);
      if (px < 0 || py < 0 || px >= this.W || py >= this.H) continue;
      const key = py * this.W + px;
      const c = (this.counts.get(key) ?? 0) + delta;
      this.counts.set(key, c);
      if (delta > 0 && c === 1) stampSquare(this.prefix, px, py, this.size, 1);
      else if (delta < 0 && c === 0) stampSquare(this.prefix, px, py, this.size, 0);
      addPoint(this.dirty, px - this.size, py - this.size, 0);
      addPoint(this.dirty, px + this.size + 1, py + this.size + 1, 0);
    }
  }

  /** The rect changed since the last call. */
  update(): Rect {
    const r = toPixels(this.dirty, this.W, this.H);
    reset(this.dirty);
    return r;
  }

  finish(): Rect {
    this.active = false;
    return this.update();
  }

  cancel(): Rect {
    const r = this.box();
    this.clearBuffers();
    this.active = false;
    return r;
  }

  box(): Rect {
    return toPixels(this.prefix.box, this.W, this.H, 1);
  }

  clearBuffers(): void {
    const r = toPixels(this.prefix.box, this.W, this.H, 2);
    if (!isEmpty(r)) clearRect(this.prefix.buf, this.W, r);
    reset(this.prefix.box);
    this.prefix.tiles?.fill(0);
    this.counts.clear();
  }
}
