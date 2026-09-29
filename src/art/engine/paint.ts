/**
 * The painter applies drawing operations to a Board: strokes (live, sample by sample, or from the log),
 * fills and shapes. The live surface and the headless replay share it, so a replayed log produces the same
 * pixels as the drawing session that recorded it.
 */
import { type Brush, STEADY_MAX_PX, brushFor } from './brushes';
import { type RGB, parseColor } from './color';
import { type Point, type Rect, emptyRect, isEmpty, toPixels, unionInto } from './geom';
import { type BlendMode, blendCoverage, blendMask, compositeLayer } from './blend';
import type { Board } from './board';
import { type Analysis, type FillParams, type FillResult, analyze, fillRegion, uniformSeed, wallsFromColor } from './fill';
import { grainFor } from './grain';
import { type LogFill, type LogShape, type LogStroke, sampleTimes } from './log';
import { EXPORTED_ROLES } from './model';
import { PixelStroke } from './pixel';
import { type Target, fillPolygon } from './raster';
import { type PerfectShape, recognize, shapeOutline } from './shape';
import { type BeginOpts, StrokeEngine, type Symmetry, symmetryMaps } from './stroke';
import { tilesFromFlags, tilesOf } from './history';

export interface StrokeSpec {
  frame: string;
  layer: string;
  brush: Brush;
  rgb: RGB;
  /** Pen or script input: real pressure and pen tapers. */
  realPressure: boolean;
  /** Virtual screen px per document px (the zoom it was drawn at). */
  scale: number;
  /** Pulled-string radius, screen px. */
  stabilizer: number;
  predictMs: number;
  symmetry: Symmetry | null;
}

export interface PainterHooks {
  /** Called just before pixels of (frame, layer) change within these tiles (history snapshots here). */
  before?(frame: string, layer: string, tiles: Rect[]): void;
}

/** One stroke in progress. */
export class StrokeSession {
  readonly spec: StrokeSpec;
  readonly mode: BlendMode;
  private readonly engine: StrokeEngine | null;
  private readonly pixel: PixelStroke | null;
  private done = false;
  /** Control points before the finish-line catch-up (for "make it perfect" after the stroke). */
  pointsBeforeFinish: Point[] = [];
  snapped: PerfectShape | null = null;

  constructor(
    private painter: Painter,
    spec: StrokeSpec,
    x: number,
    y: number,
    p: number,
    t: number,
  ) {
    this.spec = spec;
    const layer = painter.board.layer(spec.layer);
    const lock = !!layer?.alphaLock;
    this.mode = spec.brush.blend === 'erase' ? 'erase' : spec.brush.blend === 'multiply' ? 'multiply' : lock ? 'atop' : 'over';
    const usePixel = spec.brush.kind === 'pixel' || painter.board.pixelArt;
    this.engine = usePixel ? null : painter.strokeEngine();
    this.pixel = usePixel ? painter.pixelStroke() : null;
    painter.board.pixels(spec.frame, spec.layer, true);
    if (this.pixel) this.pixel.begin(spec.brush.kind === 'pixel' ? spec.brush.size : Math.max(1, Math.round(spec.brush.size)), spec.symmetry, x, y);
    else if (this.engine) this.engine.begin(this.beginOpts(), x, y, p, t);
  }

  private beginOpts(): BeginOpts {
    const s = this.spec;
    return {
      brush: s.brush,
      realPressure: s.realPressure,
      scale: s.scale,
      stabilizer: s.stabilizer,
      predictMs: s.predictMs,
      symmetry: s.symmetry,
      grain: s.brush.texture ? grainFor(s.brush.texture) : null,
    };
  }

  get isPixel(): boolean {
    return this.pixel !== null;
  }

  get locked(): boolean {
    return this.engine?.shapeLocked ?? false;
  }

  add(x: number, y: number, p: number, t: number): void {
    if (this.pixel) this.pixel.addSample(x, y);
    else this.engine?.addSample(x, y, p, t);
  }

  /** Renders what changed; returns the dirty integer rect. */
  update(): Rect {
    if (this.pixel) return this.pixel.update();
    const e = this.engine;
    if (!e) return emptyRect();
    return toPixels(e.update(), e.W, e.H);
  }

  /** Hold to perfect: snaps the stroke so far to a shape. Returns the shape, or null when nothing fits. */
  snap(): { shape: PerfectShape; dirty: Rect } | null {
    const e = this.engine;
    if (!e || e.shapeLocked || e.kind !== 'capsule') return null;
    const shape = recognize(e.pts);
    if (!shape) return null;
    this.snapped = shape;
    return { shape, dirty: toPixels(e.snapTo(shape.pts), e.W, e.H) };
  }

  finish(): Rect {
    if (this.done) return emptyRect();
    this.done = true;
    if (this.pixel) return this.pixel.finish();
    const e = this.engine;
    if (!e) return emptyRect();
    this.pointsBeforeFinish = e.pts.map((q) => ({ x: q.x, y: q.y }));
    return toPixels(e.finish(), e.W, e.H);
  }

  cancel(): Rect {
    this.done = true;
    const r = this.pixel ? this.pixel.cancel() : this.engine ? toPixels(this.engine.cancel(), this.engine.W, this.engine.H, 2) : emptyRect();
    return r;
  }

  private target(): { prefix: Target; tail: Float32Array | null; W: number; H: number } {
    if (this.pixel) return { prefix: this.pixel.prefix, tail: null, W: this.pixel.W, H: this.pixel.H };
    const e = this.engine!;
    return { prefix: e.prefix, tail: e.kind === 'capsule' ? e.tail.buf : null, W: e.W, H: e.H };
  }

  /** Writes layer-plus-stroke pixels for rect r into `out` (a board-sized RGBA buffer), for display. */
  preview(out: Uint8ClampedArray, r: Rect): void {
    if (isEmpty(r)) return;
    const src = this.painter.board.pixels(this.spec.frame, this.spec.layer, true);
    const t = this.target();
    blendCoverage(src, out, t.W, r, t.prefix.buf, this.done ? null : t.tail, this.spec.rgb, this.spec.brush.opacity, this.mode);
  }

  /** The stroke's integer box. */
  box(): Rect {
    return this.pixel ? this.pixel.box() : this.engine ? this.engine.box() : emptyRect();
  }

  /**
   * Applies the finished stroke to its layer; returns the changed box. `preview`: the buffer every change
   * of this stroke was previewed into (after finish); it already holds the blended pixels, so they are
   * copied rather than blended again (same values, a faster pen-up).
   */
  commit(preview: Uint8ClampedArray | null = null): Rect {
    this.finish();
    const board = this.painter.board;
    const t = this.target();
    const box = this.box();
    if (!isEmpty(box)) {
      const tiles = tilesFromFlags(t.prefix.tiles!, t.prefix.tilesW, board.W, board.H);
      this.painter.hooks.before?.(this.spec.frame, this.spec.layer, tiles);
      const data = board.pixels(this.spec.frame, this.spec.layer, true);
      if (preview && this.mode !== 'atop') copyCovered(data, preview, board.W, box, t.prefix.buf, this.spec.brush.opacity);
      else blendCoverage(data, data, board.W, box, t.prefix.buf, null, this.spec.rgb, this.spec.brush.opacity, this.mode);
      board.changed(this.spec.frame, this.spec.layer, box);
    }
    if (this.pixel) this.pixel.clearBuffers();
    else this.engine?.clearBuffers();
    return box;
  }
}

/**
 * Copies the pixels a stroke covers from its preview, run by run (blendCoverage leaves the same ones
 * alone), as whole 32-bit pixels.
 */
function copyCovered(data: Uint8ClampedArray, preview: Uint8ClampedArray, W: number, box: Rect, cov: Float32Array, opacity: number): void {
  const d32 = new Uint32Array(data.buffer, data.byteOffset, data.length >> 2);
  const p32 = new Uint32Array(preview.buffer, preview.byteOffset, preview.length >> 2);
  for (let y = box.y0; y < box.y1; y++) {
    const end = y * W + box.x1;
    let i = y * W + box.x0;
    while (i < end) {
      while (i < end && !(cov[i] * opacity > 0)) i++;
      const s = i;
      while (i < end && cov[i] * opacity > 0) i++;
      if (i > s) d32.set(p32.subarray(s, i), s);
    }
  }
}

/** The spec a logged stroke was drawn with. */
export function specOfLog(op: LogStroke): StrokeSpec {
  return {
    frame: op.frame,
    layer: op.layer,
    brush: brushFor(op.brush, { size: op.size, opacity: op.opacity, soft: op.soft }),
    rgb: parseColor(op.color) ?? [0, 0, 0],
    realPressure: op.input === 'pen',
    scale: op.scale,
    stabilizer: Math.max(0, Math.min(1, op.steady)) * STEADY_MAX_PX,
    predictMs: 0,
    symmetry: op.mirror,
  };
}

export interface FillRequest {
  frame: string;
  layer: string;
  x: number;
  y: number;
  tolerance: number;
  sample: LogFill['sample'];
  params: FillParams;
}

export class Painter {
  readonly board: Board;
  hooks: PainterHooks;
  private engine: StrokeEngine | null = null;
  private pixel: PixelStroke | null = null;
  private linesCache: { key: string; a: Analysis } | null = null;

  constructor(board: Board, hooks: PainterHooks = {}) {
    this.board = board;
    this.hooks = hooks;
  }

  strokeEngine(): StrokeEngine {
    this.engine ??= new StrokeEngine(this.board.W, this.board.H);
    return this.engine;
  }

  pixelStroke(): PixelStroke {
    this.pixel ??= new PixelStroke(this.board.W, this.board.H);
    return this.pixel;
  }

  begin(spec: StrokeSpec, x: number, y: number, p: number, t: number): StrokeSession {
    return new StrokeSession(this, spec, x, y, p, t);
  }

  /** Replays a logged stroke in one go and commits it; returns the changed box. */
  paintLogStroke(op: LogStroke): Rect {
    const n = op.dts.length;
    if (!n || !this.board.layer(op.layer)) return emptyRect();
    const times = sampleTimes(op.dts);
    const xyp = op.xyp;
    const s = this.begin(specOfLog(op), xyp[0], xyp[1], xyp[2], times[0]);
    for (let i = 1; i < n; i++) {
      if (op.snap === i) s.snap();
      s.add(xyp[i * 3], xyp[i * 3 + 1], xyp[i * 3 + 2], times[i]);
    }
    if (op.snap === n) s.snap();
    return s.commit();
  }

  // ------------------------------------------------------------------------------------------ fill

  /** Walls for "fill under the lines": the visible lines layers of the frame (alpha > ~30%). */
  linesWalls(frame: string): Uint8Array {
    const { W, H } = this.board;
    const wall = new Uint8Array(W * H);
    for (const l of this.board.layers) {
      if (l.role !== 'lines' || !l.visible) continue;
      const d = this.board.pixels(frame, l.id);
      if (!d) continue;
      for (let i = 0, j = 3; i < wall.length; i++, j += 4) if (d[j] > 80) wall[i] = 1;
    }
    return wall;
  }

  /** Cache key of the lines analysis (changes whenever a visible lines layer changes). */
  linesKey(frame: string, maxGap: number): string {
    const parts = this.board.layers.filter((l) => l.role === 'lines' && l.visible).map((l) => `${l.id}:${this.board.version(frame, l.id)}`);
    return `${frame}|${maxGap}|${parts.join(',')}`;
  }

  /** The lines analysis, cached until the lines change. */
  linesAnalysis(frame: string, maxGap: number): Analysis {
    const key = this.linesKey(frame, maxGap);
    if (this.linesCache?.key === key) return this.linesCache.a;
    const a = analyze(this.linesWalls(frame), this.board.W, this.board.H, maxGap);
    this.linesCache = { key, a };
    return a;
  }

  /** Adopts an analysis computed elsewhere (the fill worker). */
  adoptLinesAnalysis(key: string, a: Analysis): void {
    this.linesCache = { key, a };
  }

  hasVisibleLines(frame: string): boolean {
    return this.board.layers.some((l) => l.role === 'lines' && l.visible && this.board.hasCel(frame, l.id));
  }

  /** Visible layers (never trace) composited on transparency: what a colour fill sees. */
  composite(frame: string, only?: string): Uint8ClampedArray {
    const { W, H } = this.board;
    const out = new Uint8ClampedArray(W * H * 4);
    for (const l of this.board.layers) {
      if (only ? l.id !== only : !l.visible || l.role === 'trace') continue;
      const d = this.board.pixels(frame, l.id);
      if (d) compositeLayer(out, d, W, H, null, only ? 1 : l.opacity, only ? 'normal' : l.blend);
    }
    return out;
  }

  /** Works out the fill region (synchronously; the surface uses the worker for the same computation). */
  computeFill(req: FillRequest): FillResult | null {
    const { W, H } = this.board;
    const x = Math.floor(req.x);
    const y = Math.floor(req.y);
    if (x < 0 || y < 0 || x >= W || y >= H) return null;
    const maxGap = Math.max(...req.params.gaps, req.params.fallbackGap);
    if (req.sample === 'lines') return fillRegion(this.linesAnalysis(req.frame, maxGap), x, y, req.params);
    const rgba = this.composite(req.frame, req.sample === 'layer' ? req.layer : undefined);
    const tol = this.board.pixelArt ? 0 : req.tolerance;
    const [sx, sy] = this.board.pixelArt ? [x, y] : uniformSeed(rgba, W, H, x, y, tol);
    const a = analyze(wallsFromColor(rgba, W, H, sx, sy, tol), W, H, maxGap);
    return fillRegion(a, sx, sy, req.params);
  }

  /** Paints a computed fill region onto its layer. */
  applyFill(req: FillRequest, res: FillResult, rgb: RGB): Rect {
    const board = this.board;
    const data = board.pixels(req.frame, req.layer, true);
    const tapX = Math.max(0, Math.min(board.W - 1, Math.floor(req.x)));
    const tapY = Math.max(0, Math.min(board.H - 1, Math.floor(req.y)));
    const behind = data[(tapY * board.W + tapX) * 4 + 3] < 8;
    // Walls drawn on the target layer itself: the part of the fill under them goes behind the ink.
    const target = board.layer(req.layer);
    const sameLayer = req.sample !== 'lines' || target?.role === 'lines';
    this.hooks.before?.(req.frame, req.layer, tilesOf(res.box, board.W, board.H));
    blendMask(data, board.W, res.box, res.mask, sameLayer ? res.under : null, rgb, behind);
    board.changed(req.frame, req.layer, res.box);
    return res.box;
  }

  /** Replays a logged fill; returns the result or null when there was nothing to fill. */
  paintLogFill(op: LogFill): FillResult | null {
    if (!this.board.layer(op.layer)) return null;
    const req: FillRequest = {
      frame: op.frame,
      layer: op.layer,
      x: op.x,
      y: op.y,
      tolerance: op.tolerance,
      sample: op.sample,
      params: { gaps: op.gaps, fallbackGap: op.fallbackGap, expand: this.board.pixelArt ? 0 : 2, soften: !this.board.pixelArt, innerCheck: !this.board.pixelArt },
    };
    const res = this.computeFill(req);
    if (res) this.applyFill(req, res, parseColor(op.color) ?? [0, 0, 0]);
    return res;
  }

  // ------------------------------------------------------------------------------------------ shapes

  /** Draws a shape (outline with the brush, optionally filled) and commits it. */
  paintShape(op: LogShape): Rect {
    const board = this.board;
    if (!board.layer(op.layer)) return emptyRect();
    const o = shapeOutline(op.shape, op.points.map(([x, y]) => ({ x, y })));
    if (!o) return emptyRect();
    const brush = brushFor(op.brush, { size: op.size, opacity: op.opacity });
    const spec: StrokeSpec = {
      frame: op.frame,
      layer: op.layer,
      brush,
      rgb: parseColor(op.color) ?? [0, 0, 0],
      realPressure: true,
      scale: 1,
      stabilizer: 0,
      predictMs: 0,
      symmetry: op.mirror,
    };
    const first = o.outline[0];
    const s = this.begin(spec, first.x, first.y, 1, 0);
    const t = this.shapeTarget(s, o.outline, spec);
    if (op.filled && o.polygon) {
      for (const m of symmetryMaps(op.mirror)) fillPolygon(t, o.polygon.map((p) => ({ x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] })), 1);
      if (board.pixelArt) hardenCoverage(t);
    }
    return s.commit();
  }

  private shapeTarget(s: StrokeSession, outline: Point[], spec: StrokeSpec): Target {
    if (s.isPixel) {
      const px = this.pixelStroke();
      for (const p of outline.slice(1)) px.addSample(p.x, p.y);
      return px.prefix;
    }
    const e = this.strokeEngine();
    e.polyline(
      {
        brush: spec.brush,
        realPressure: true,
        scale: 1,
        stabilizer: 0,
        predictMs: 0,
        symmetry: spec.symmetry,
        grain: spec.brush.texture ? grainFor(spec.brush.texture) : null,
      },
      outline,
      1,
    );
    return e.prefix;
  }
}

/** Pixel art: coverage below one half is dropped, the rest is solid. */
function hardenCoverage(t: Target): void {
  const r = toPixels(t.box, t.W, t.H);
  for (let y = r.y0; y < r.y1; y++)
    for (let x = r.x0; x < r.x1; x++) {
      const i = y * t.W + x;
      t.buf[i] = t.buf[i] >= 0.5 ? 1 : 0;
    }
}

/** Layers whose pixels leave the editor (for export, palette and hot swap). */
export function exportedLayers(board: Board): string[] {
  return board.layers.filter((l) => l.visible && EXPORTED_ROLES(l.role)).map((l) => l.id);
}

export function unionRects(rs: Rect[]): Rect {
  const r = emptyRect();
  for (const x of rs) unionInto(r, x);
  return r;
}
