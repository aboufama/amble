/**
 * The stroke engine: input samples -> 1-euro filter -> optional pulled string -> centripetal Catmull-Rom ->
 * flattened vertices with pressure and arc length -> width model (pressure/speed, start and end tapers) ->
 * rasterized capsules (or soft dabs for the airbrush).
 *
 * Incremental rendering: segments that can no longer change are COMMITTED into `prefix` once; the unstable
 * tail (last spline segment, live end taper, predicted points) is re-rendered into `tail` every frame.
 * The stroke's coverage is max(prefix, tail), so the join is invisible and the per-frame cost does not grow
 * with the stroke length.
 *
 * Samples arrive in document px. The filters run in "virtual screen" px (document px times `scale`, the
 * zoom at which the stroke was drawn), so the feel does not change with zoom and a logged stroke replays
 * exactly without the view.
 */
import type { Brush } from './brushes';
import { type Point, type Rect, addPoint, clamp, emptyRect, isEmpty, reset, toPixels, unionInto } from './geom';
import { OneEuro2D, PulledString, SimulatedPressure } from './filters';
import { type CtrlPt, type Vtx, flatten } from './spline';
import { type Grain, type Target, capsule, clearRect, makeTarget, softDab } from './raster';

/** Mirror axes (document px) and/or radial symmetry. Radial wins when both are set. */
export interface Symmetry {
  /** Vertical mirror axis at this x, or null. */
  x: number | null;
  /** Horizontal mirror axis at this y, or null. */
  y: number | null;
  radial?: { cx: number; cy: number; n: number } | null;
}

export interface BeginOpts {
  brush: Brush;
  /** True for pens (and stroke scripts): pressure comes from the input, pen tapers apply. */
  realPressure: boolean;
  /** Virtual screen px per document px. */
  scale: number;
  /** Pulled-string radius in screen px (0 = off). */
  stabilizer: number;
  /** Prediction horizon in ms (0 = off); only ever affects the live tail, never the final pixels. */
  predictMs: number;
  symmetry: Symmetry | null;
  grain: Grain | null;
}

/** Affine maps [a, b, c, d, e, f]: x' = a x + c y + e, y' = b x + d y + f. */
type Affine = [number, number, number, number, number, number];

const TOL = 0.05; // flattening tolerance, doc px
const MARGIN = 2;
const DEDUP = 0.2; // doc px

function taperShape(t: number): number {
  const u = 1 - t;
  return 0.05 + 0.95 * (1 - u * u);
}

/** The isometries a symmetry setting emits (identity first). */
export function symmetryMaps(sym: Symmetry | null): Affine[] {
  const maps: Affine[] = [[1, 0, 0, 1, 0, 0]];
  if (!sym) return maps;
  const r = sym.radial;
  if (r && r.n >= 2) {
    const n = Math.min(24, Math.round(r.n));
    for (let k = 1; k < n; k++) {
      const a = (2 * Math.PI * k) / n;
      const c = Math.cos(a);
      const s = Math.sin(a);
      maps.push([c, s, -s, c, r.cx - c * r.cx + s * r.cy, r.cy - s * r.cx - c * r.cy]);
    }
    return maps;
  }
  if (sym.x !== null) maps.push([-1, 0, 0, 1, 2 * sym.x, 0]);
  if (sym.y !== null) maps.push([1, 0, 0, -1, 0, 2 * sym.y]);
  if (sym.x !== null && sym.y !== null) maps.push([-1, 0, 0, -1, 2 * sym.x, 2 * sym.y]);
  return maps;
}

export class StrokeEngine {
  readonly W: number;
  readonly H: number;
  readonly prefix: Target;
  readonly tail: Target;
  private o: BeginOpts | null = null;
  pts: CtrlPt[] = [];
  private maps: Affine[] = [[1, 0, 0, 1, 0, 0]];
  private euro = new OneEuro2D();
  private string = new PulledString();
  private simP = new SimulatedPressure();
  private pSmooth = 0;
  private lastT = 0;
  private lastRawX = 0;
  private lastRawY = 0;
  private cSeg = 0;
  private cLast: Vtx = { x: 0, y: 0, p: 0, s: 0 };
  private dabSince = 0;
  private dabGap = 0;
  private ts = 0;
  private te = 0;
  private tailBox: Rect = emptyRect();
  private predicted: CtrlPt[] = [];
  active = false;
  /** Capsules emitted (for stats). */
  capsules = 0;
  /** Set by snapTo (hold to perfect): further input no longer changes the geometry. */
  shapeLocked = false;

  constructor(W: number, H: number) {
    this.W = W;
    this.H = H;
    this.prefix = makeTarget(W, H, true);
    this.tail = makeTarget(W, H, false);
  }

  get opts(): BeginOpts {
    if (!this.o) throw new Error('StrokeEngine: no stroke');
    return this.o;
  }

  get kind(): Brush['kind'] {
    return this.opts.brush.kind;
  }

  begin(o: BeginOpts, x: number, y: number, pRaw: number, t: number): void {
    this.o = o;
    this.active = true;
    this.maps = symmetryMaps(o.symmetry);
    const b = o.brush;
    this.euro.minCutoff = b.euro[0];
    this.euro.beta = b.euro[1];
    this.euro.reset();
    const sx = x * o.scale;
    const sy = y * o.scale;
    this.euro.filter(sx, sy, t);
    this.string.radius = o.stabilizer;
    this.string.reset(sx, sy);
    this.simP.reset();
    this.pSmooth = pRaw;
    const p0 = o.realPressure ? pRaw : this.simP.p;
    this.pts = [{ x, y, p: p0 }];
    this.lastT = t;
    this.lastRawX = x;
    this.lastRawY = y;
    this.cSeg = 0;
    this.cLast = { x, y, p: p0, s: 0 };
    this.dabSince = 0;
    this.dabGap = 0;
    this.ts = (o.realPressure ? b.penTaperStart : b.taperStart) * b.size;
    this.te = (o.realPressure ? b.penTaperEnd : b.taperEnd) * b.size;
    reset(this.prefix.box);
    this.prefix.tiles?.fill(0);
    reset(this.tailBox);
    this.predicted = [];
    this.capsules = 0;
    this.shapeLocked = false;
  }

  addSample(x: number, y: number, pRaw: number, t: number): void {
    if (this.shapeLocked || !this.active) return;
    const o = this.opts;
    const dt = Math.max(0.5, t - this.lastT);
    this.lastT = Math.max(this.lastT, t);
    this.lastRawX = x;
    this.lastRawY = y;
    this.euro.filter(x * o.scale, y * o.scale, t);
    const speed = Math.hypot(this.euro.vx, this.euro.vy) / 1000; // screen px per ms
    let p: number;
    if (o.realPressure) {
      this.pSmooth += (pRaw - this.pSmooth) * 0.5;
      p = this.pSmooth;
    } else p = this.simP.update(speed, dt, o.brush.thinning);
    const last = this.pts[this.pts.length - 1];
    if (o.realPressure && this.pts.length === 1 && last.p < 0.02) {
      // Some pens report 0 on contact.
      last.p = p;
      this.cLast.p = p;
    }
    if (!this.string.update(this.euro.x, this.euro.y)) {
      last.p = p;
      if (this.pts.length === 1) this.cLast.p = p;
      return;
    }
    const nx = this.string.x / o.scale;
    const ny = this.string.y / o.scale;
    if (Math.hypot(nx - last.x, ny - last.y) < DEDUP) {
      last.p = p;
      if (this.pts.length === 1) this.cLast.p = p;
      return;
    }
    this.pts.push({ x: nx, y: ny, p });
  }

  private predict(): void {
    this.predicted.length = 0;
    const o = this.opts;
    if (!o.predictMs || o.stabilizer > 0 || this.pts.length < 3) return;
    const vx = this.euro.vx;
    const vy = this.euro.vy;
    const sp = Math.hypot(vx, vy);
    if (sp < 60) return;
    let k = o.predictMs / 1000;
    const maxD = 24;
    if (sp * k > maxD) k = maxD / sp;
    const px = (this.string.x + vx * k) / o.scale;
    const py = (this.string.y + vy * k) / o.scale;
    const last = this.pts[this.pts.length - 1];
    if (Math.hypot(px - last.x, py - last.y) < 0.5) return;
    this.predicted.push({ x: px, y: py, p: last.p });
  }

  private radius(p: number, s: number, Lend: number): number {
    const b = this.opts.brush;
    let r = b.size * 0.5;
    if (b.pressureWidth) r *= b.minWidth + (1 - b.minWidth) * Math.pow(clamp(p, 0, 1), b.gamma);
    if (this.ts > 0 && s < this.ts) r *= taperShape(s / this.ts);
    if (this.te > 0 && Lend - s < this.te) r *= taperShape(Math.max(0, Lend - s) / this.te);
    return r;
  }

  private emit(t: Target, ax: number, ay: number, ra: number, pa: number, bx: number, by: number, rb: number, pb: number, box: Rect): void {
    const g = this.opts.grain;
    for (const m of this.maps) {
      const x1 = m[0] * ax + m[2] * ay + m[4];
      const y1 = m[1] * ax + m[3] * ay + m[5];
      const x2 = m[0] * bx + m[2] * by + m[4];
      const y2 = m[1] * bx + m[3] * by + m[5];
      capsule(t, x1, y1, ra, pa, x2, y2, rb, pb, 1, g);
      addPoint(box, x1, y1, ra + 2);
      addPoint(box, x2, y2, rb + 2);
      this.capsules++;
    }
  }

  /** Renders what changed since the last call; returns the dirty document rect. */
  update(): Rect {
    const dirty = emptyRect();
    if (!this.active) return dirty;
    if (this.kind === 'dab') return this.dabs(false, dirty);
    this.predict();
    this.clearTail(dirty);
    this.tessellate(false, dirty);
    return dirty;
  }

  /** Ends the stroke, catching up to the last raw sample (the stabilizer's "finish line"). */
  finish(): Rect {
    const dirty = emptyRect();
    if (!this.active) return dirty;
    if (!this.shapeLocked) {
      const last = this.pts[this.pts.length - 1];
      if (Math.hypot(this.lastRawX - last.x, this.lastRawY - last.y) > DEDUP) this.pts.push({ x: this.lastRawX, y: this.lastRawY, p: last.p });
    }
    this.predicted = [];
    this.clearTail(dirty);
    if (this.kind === 'dab') this.dabs(true, dirty);
    else this.tessellate(true, dirty);
    this.active = false;
    return dirty;
  }

  /** Abandons the stroke; returns the rect that held its pixels. */
  cancel(): Rect {
    const dirty = copy(this.prefix.box);
    unionInto(dirty, this.tailBox);
    this.clearTail(emptyRect());
    this.clearBuffers();
    this.active = false;
    return dirty;
  }

  private clearTail(dirty: Rect): void {
    if (isEmpty(this.tailBox)) return;
    const tr = toPixels(this.tailBox, this.W, this.H);
    clearRect(this.tail.buf, this.W, tr);
    unionInto(dirty, tr);
    reset(this.tailBox);
    reset(this.tail.box);
  }

  private tessellate(final: boolean, dirty: Rect): void {
    const nReal = this.pts.length;
    const pts = this.predicted.length && !final ? this.pts.concat(this.predicted) : this.pts;
    const n = pts.length;
    const verts: Vtx[] = [this.cLast];
    const segEnds: number[] = [];
    const maxLen = Math.max(1.5, this.opts.brush.size * 0.25);
    const Lext = n > 1 ? flatten(pts, n, this.cSeg, n - 1, this.cLast.s, TOL, maxLen, verts, segEnds) : this.cLast.s;
    const realSegs = nReal - 1 - this.cSeg;
    const L = realSegs > 0 ? verts[segEnds[realSegs - 1]].s : this.cLast.s;
    let commitSegs = 0;
    if (final) {
      commitSegs = realSegs;
      if (this.cSeg === 0 && L < this.ts + this.te) {
        // Short stroke: shrink both tapers so it keeps some body.
        const k = L / (this.ts + this.te);
        this.ts *= k;
        this.te *= k;
      }
    } else if (L > this.ts + this.te + MARGIN) {
      const sLimit = L - this.te - MARGIN;
      for (let j = 0; j < realSegs; j++) {
        if (this.cSeg + j >= nReal - 2) break; // the last real segment still depends on the next point
        if (verts[segEnds[j]].s <= sLimit) commitSegs = j + 1;
        else break;
      }
    }
    const Lc = final ? L : Infinity;
    const endIdx = commitSegs > 0 ? segEnds[commitSegs - 1] : 0;
    if (endIdx > 0) {
      let ra = this.radius(verts[0].p, verts[0].s, Lc);
      for (let k = 1; k <= endIdx; k++) {
        const a = verts[k - 1];
        const b = verts[k];
        const rb = this.radius(b.p, b.s, Lc);
        this.emit(this.prefix, a.x, a.y, ra, a.p, b.x, b.y, rb, b.p, dirty);
        ra = rb;
      }
      this.cSeg += commitSegs;
      this.cLast = verts[endIdx];
    }
    if (final) {
      if (L < 0.3) this.dot(this.prefix, dirty);
      return;
    }
    // Tail: re-rendered every frame with the end taper at the (predicted) tip.
    if (verts.length - 1 === endIdx) {
      if (this.cSeg === 0) this.dot(this.tail, this.tailBox);
    } else {
      let ra = this.radius(verts[endIdx].p, verts[endIdx].s, Lext);
      for (let k = endIdx + 1; k < verts.length; k++) {
        const a = verts[k - 1];
        const b = verts[k];
        const rb = this.radius(b.p, b.s, Lext);
        this.emit(this.tail, a.x, a.y, ra, a.p, b.x, b.y, rb, b.p, this.tailBox);
        ra = rb;
      }
    }
    unionInto(dirty, this.tailBox);
  }

  /** A tap: a round dot sized by pressure (no taper). */
  private dot(t: Target, box: Rect): void {
    const v = this.pts[this.pts.length - 1];
    const b = this.opts.brush;
    let r = b.size * 0.5;
    if (b.pressureWidth) r *= b.minWidth + (1 - b.minWidth) * Math.pow(clamp(v.p, 0, 1), b.gamma);
    r = Math.max(0.6, r * 0.9);
    this.emit(t, v.x, v.y, r, v.p, v.x, v.y, r, v.p, box);
  }

  /** Dab brushes (airbrush): accumulate soft dabs along the stable part of the curve; no tail. */
  private dabs(final: boolean, dirty: Rect): Rect {
    const nReal = this.pts.length;
    const b = this.opts.brush;
    const flow = b.flow ?? 0.05;
    const stableEnd = final ? nReal - 1 : nReal - 2;
    if (final && nReal === 1) {
      const v = this.pts[0];
      this.dab(v.x, v.y, this.radius(v.p, 1e9, Infinity), flow * 3, dirty);
      return dirty;
    }
    if (stableEnd <= this.cSeg) return dirty;
    const verts: Vtx[] = [this.cLast];
    const segEnds: number[] = [];
    flatten(this.pts, nReal, this.cSeg, stableEnd, this.cLast.s, TOL, 2, verts, segEnds);
    for (let k = 1; k < verts.length; k++) {
      const a = verts[k - 1];
      const c = verts[k];
      const len = c.s - a.s;
      let pos = 0;
      while (this.dabSince + (len - pos) >= this.dabGap) {
        pos += this.dabGap - this.dabSince;
        const f = len > 0 ? pos / len : 1;
        const x = a.x + (c.x - a.x) * f;
        const y = a.y + (c.y - a.y) * f;
        const p = a.p + (c.p - a.p) * f;
        const r = this.radius(p, a.s + pos, Infinity);
        this.dab(x, y, r, flow * (0.3 + 0.7 * p), dirty);
        this.dabSince = 0;
        this.dabGap = Math.max(0.75, (b.spacing ?? 0.1) * r);
      }
      this.dabSince += len - pos;
    }
    this.cSeg = stableEnd;
    this.cLast = verts[verts.length - 1];
    return dirty;
  }

  private dab(x: number, y: number, r: number, flow: number, box: Rect): void {
    for (const m of this.maps) {
      const mx = m[0] * x + m[2] * y + m[4];
      const my = m[1] * x + m[3] * y + m[5];
      softDab(this.prefix, mx, my, r, flow);
      addPoint(box, mx, my, r + 2);
    }
  }

  /**
   * Hold to perfect: replaces the stroke so far with a perfected outline (no tapers, the stroke's median
   * pressure) and re-renders it. Further input no longer changes the geometry.
   */
  snapTo(points: Point[]): Rect {
    const dirty = emptyRect();
    const pr = toPixels(this.prefix.box, this.W, this.H, 2);
    if (!isEmpty(pr)) {
      clearRect(this.prefix.buf, this.W, pr);
      unionInto(dirty, pr);
    }
    reset(this.prefix.box);
    this.prefix.tiles?.fill(0);
    this.clearTail(dirty);
    const ps = this.pts.map((q) => q.p).sort((a, b) => a - b);
    const p = ps[Math.floor(ps.length / 2)];
    this.pts = points.map((q) => ({ x: q.x, y: q.y, p }));
    this.cSeg = 0;
    this.cLast = { x: this.pts[0].x, y: this.pts[0].y, p, s: 0 };
    this.ts = 0;
    this.te = 0;
    this.predicted = [];
    this.shapeLocked = true;
    this.tessellate(false, dirty);
    return dirty;
  }

  /**
   * Draws a finished polyline (shapes): constant pressure, no tapers, no filtering. Call finish() after.
   * The points should already be dense (a few px apart); corners stay sharp.
   */
  polyline(o: BeginOpts, points: Point[], p: number): Rect {
    this.begin(o, points[0].x, points[0].y, p, 0);
    this.ts = 0;
    this.te = 0;
    this.pts = points.map((q) => ({ x: q.x, y: q.y, p }));
    this.shapeLocked = true;
    const dirty = emptyRect();
    const b = o.brush;
    let r = b.size * 0.5;
    if (b.pressureWidth) r *= b.minWidth + (1 - b.minWidth) * Math.pow(clamp(p, 0, 1), b.gamma);
    if (points.length === 1) {
      this.emit(this.prefix, points[0].x, points[0].y, r, p, points[0].x, points[0].y, r, p, dirty);
    }
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1];
      const c = points[i];
      this.emit(this.prefix, a.x, a.y, r, p, c.x, c.y, r, p, dirty);
    }
    this.active = false;
    return dirty;
  }

  /** Ends a just-begun stroke without drawing anything (a shape that is only filled). */
  lockEmpty(): void {
    this.pts = [];
    this.shapeLocked = true;
    this.active = false;
  }

  /** Whole-stroke integer bounding box (for committing). */
  box(): Rect {
    return toPixels(this.prefix.box, this.W, this.H, 1);
  }

  /** Clears the stroke buffers after a commit. */
  clearBuffers(): void {
    const r = toPixels(this.prefix.box, this.W, this.H, 2);
    if (!isEmpty(r)) clearRect(this.prefix.buf, this.W, r);
    reset(this.prefix.box);
    this.prefix.tiles?.fill(0);
  }
}

function copy(r: Rect): Rect {
  return { x0: r.x0, y0: r.y0, x1: r.x1, y1: r.y1 };
}
