/**
 * The view. The only DOM canvas is an opaque, desynchronized <canvas> filling the host, with nothing on top
 * of it. Each layer of the active frame is mirrored from the CPU pixels into an OffscreenCanvas; the layers
 * below and above the active one are cached, so a stroke frame is a few small drawImage calls of the dirty
 * rect whatever the layer count. Dirty rects are clipped on whole device pixels (an anti-aliased clip edge
 * would leave grainy seams along strokes). During pan/zoom/rotate gestures the canvas is moved with a CSS
 * transform and re-rendered crisply afterwards.
 */
import { type Point, type Rect, emptyRect, isEmpty, toPixels, unionInto } from './geom';
import type { Board } from './board';
import { compositeLayer } from './blend';
import { EXPORTED_ROLES } from './model';
import type { Symmetry } from './stroke';
import { type ViewState, cssTransformBetween, docToView, fitView, viewMatrix } from './view';
import { type Guide, drawGuide } from './guide';
import { parseColor } from './color';

type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

interface Surface2D {
  canvas: OffscreenCanvas;
  ctx: OffscreenCanvasRenderingContext2D;
}

interface Display extends Surface2D {
  data: Uint8ClampedArray | null;
  img: ImageData | null;
}

export interface SelectionOverlay {
  /** Closed outline, board px. */
  outline: Point[];
  /** Corner handles and the rotate handle, board px (null = no handles, e.g. while drawing the lasso). */
  handles: Point[] | null;
  rotate: Point | null;
}

export interface Overlays {
  symmetry: Symmetry | null;
  selection: SelectionOverlay | null;
  /** The lasso being drawn, board px. */
  lasso: Point[] | null;
  /** Brush outline at the pointer: view CSS px and radius. */
  cursor: { x: number; y: number; r: number } | null;
}

function make(W: number, H: number): Surface2D {
  const canvas = new OffscreenCanvas(W, H);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('No 2D canvas context');
  return { canvas, ctx };
}

/** Whole device-pixel rect (x1/y1 exclusive). */
interface DRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

interface Playback {
  frames: Array<OffscreenCanvas | null>;
  timer: number;
  index: number;
  /** Ticks left on the current frame (its hold). */
  left: number;
}

const ONION_TINTS: Array<[number, number, number]> = [
  [235, 80, 80],
  [50, 180, 110],
];

export class Compositor {
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  readonly desynchronized: boolean;
  view: ViewState = { zoom: 1, rot: 0, panX: 0, panY: 0 };
  cssW = 1;
  cssH = 1;
  dpr = 1;
  frame: string;
  active: string;
  paper: string;
  workspace: string;
  readonly overlays: Overlays = { symmetry: null, selection: null, lasso: null, cursor: null };
  private readonly board: Board;
  private readonly displays = new Map<string, Display>();
  private readonly below: Surface2D;
  private readonly above: Surface2D;
  private aboveSimple = true;
  private onion: Surface2D | null = null;
  private onionOn = false;
  private onionRange = 2;
  private onionStale = true;
  private guide: Guide | null = null;
  private guideLayer: Surface2D | null = null;
  private pending: DRect | null = null;
  private raf = 0;
  private gestureFrom: ViewState | null = null;
  private gestureAt = 0;
  private playback: Playback | null = null;
  /** Called after each render with its cost in ms (for the render budget and stats). */
  onRender: ((ms: number, full: boolean) => void) | null = null;
  /** Measurement only: read a pixel back after each render so the timing includes the raster. */
  forceRaster = false;

  constructor(host: HTMLElement, board: Board, frame: string, active: string, o: { paper: string; workspace: string; desynchronized: boolean }) {
    this.board = board;
    this.frame = frame;
    this.active = active;
    this.paper = o.paper;
    this.workspace = o.workspace;
    const canvas = document.createElement('canvas');
    canvas.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;display:block;touch-action:none;transform-origin:0 0;';
    canvas.setAttribute('aria-hidden', 'true');
    host.appendChild(canvas);
    this.canvas = canvas;
    const ctx = canvas.getContext('2d', { alpha: false, desynchronized: o.desynchronized });
    if (!ctx) throw new Error('No 2D canvas context');
    this.ctx = ctx;
    const attrs = ctx.getContextAttributes() as CanvasRenderingContext2DSettings & { desynchronized?: boolean };
    this.desynchronized = !!attrs.desynchronized;
    this.below = make(board.W, board.H);
    this.above = make(board.W, board.H);
    this.measure();
    this.view = fitView(board.W, board.H, this.cssW, this.cssH);
  }

  /** Re-reads the canvas size (call on resize). Returns true when it changed. */
  measure(): boolean {
    const r = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(r.width * dpr));
    const h = Math.max(1, Math.round(r.height * dpr));
    const changed = w !== this.canvas.width || h !== this.canvas.height || dpr !== this.dpr;
    this.cssW = Math.max(1, r.width);
    this.cssH = Math.max(1, r.height);
    this.dpr = dpr;
    if (changed) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    return changed;
  }

  // ------------------------------------------------------------------------------------------ layers

  private display(layer: string): Display {
    let d = this.displays.get(layer);
    if (!d) {
      d = { ...make(this.board.W, this.board.H), data: null, img: null };
      this.displays.set(layer, d);
    }
    return d;
  }

  /** Copies board pixels of (active frame, layer) in rect into the layer's canvas. */
  upload(layer: string, r: Rect | null): void {
    const { W, H } = this.board;
    const d = this.display(layer);
    const rect = r ? toPixels(r, W, H) : { x0: 0, y0: 0, x1: W, y1: H };
    if (isEmpty(rect)) return;
    let data: Uint8ClampedArray | null = null;
    try {
      data = this.board.pixels(this.frame, layer);
    } catch {
      data = null; // packed: shown once unpacked
    }
    if (!data) {
      d.ctx.clearRect(rect.x0, rect.y0, rect.x1 - rect.x0, rect.y1 - rect.y0);
      return;
    }
    if (d.data !== data || !d.img) {
      d.data = data;
      d.img = new ImageData(data as Uint8ClampedArray<ArrayBuffer>, W, H);
    }
    d.ctx.putImageData(d.img, 0, 0, rect.x0, rect.y0, rect.x1 - rect.x0, rect.y1 - rect.y0);
  }

  /** Shows preview pixels (a board-sized buffer, e.g. the layer with a live stroke) for rect r of a layer. */
  showPreview(layer: string, preview: ImageData, r: Rect): void {
    if (isEmpty(r)) return;
    this.display(layer).ctx.putImageData(preview, 0, 0, r.x0, r.y0, r.x1 - r.x0, r.y1 - r.y0);
  }

  /** Draws directly on a layer's display canvas (animations such as the fill's pour), then marks r dirty. */
  paintLayer(layer: string, r: Rect, fn: (ctx: OffscreenCanvasRenderingContext2D) => void): void {
    const ctx = this.display(layer).ctx;
    ctx.save();
    fn(ctx);
    ctx.restore();
    if (layer !== this.active) this.rebuildCaches(r);
    this.invalidateDoc(r);
  }

  /** Rebuilds every layer canvas of the active frame and the caches, then renders everything. */
  reload(): void {
    for (const id of [...this.displays.keys()]) if (!this.board.layer(id)) this.displays.delete(id);
    for (const l of this.board.layers) this.upload(l.id, null);
    this.onionStale = true;
    this.rebuildCaches(null);
    this.renderAll();
  }

  setActive(layer: string): void {
    this.active = layer;
    this.rebuildCaches(null);
    this.renderAll();
  }

  setFrame(frame: string): void {
    this.frame = frame;
    this.reload();
  }

  private drawLayer(ctx: Ctx2D, id: string, S: Rect | null): void {
    const l = this.board.layer(id);
    if (!l || !l.visible || l.opacity <= 0) return;
    const d = this.display(id);
    ctx.globalAlpha = l.opacity;
    ctx.globalCompositeOperation = l.blend === 'multiply' ? 'multiply' : 'source-over';
    if (S) ctx.drawImage(d.canvas, S.x0, S.y0, S.x1 - S.x0, S.y1 - S.y0, S.x0, S.y0, S.x1 - S.x0, S.y1 - S.y0);
    else ctx.drawImage(d.canvas, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  /** Rebuilds the below/above caches (in rect r, or all). */
  rebuildCaches(r: Rect | null): void {
    const { W, H } = this.board;
    const S = r ? toPixels(r, W, H) : { x0: 0, y0: 0, x1: W, y1: H };
    if (isEmpty(S)) return;
    const sw = S.x1 - S.x0;
    const sh = S.y1 - S.y0;
    const layers = this.board.layers;
    const ai = Math.max(0, this.board.layerIndex(this.active));
    const b = this.below.ctx;
    b.globalAlpha = 1;
    b.globalCompositeOperation = 'source-over';
    b.fillStyle = this.paper;
    b.fillRect(S.x0, S.y0, sw, sh);
    if (this.onionOn && this.onion) b.drawImage(this.onion.canvas, S.x0, S.y0, sw, sh, S.x0, S.y0, sw, sh);
    if (this.guideLayer && !this.guide?.onTop) b.drawImage(this.guideLayer.canvas, S.x0, S.y0, sw, sh, S.x0, S.y0, sw, sh);
    for (let i = 0; i < ai; i++) this.drawLayer(b, layers[i].id, S);
    const a = this.above.ctx;
    a.clearRect(S.x0, S.y0, sw, sh);
    this.aboveSimple = layers.slice(ai + 1).every((l) => l.blend === 'normal');
    if (this.aboveSimple) for (let i = ai + 1; i < layers.length; i++) this.drawLayer(a, layers[i].id, S);
  }

  /** A non-active layer changed in r: refresh its canvas and the cache it lives in. */
  layerChanged(layer: string, r: Rect): void {
    this.upload(layer, r);
    if (layer !== this.active) this.rebuildCaches(r);
    this.invalidateDoc(r);
  }

  // ------------------------------------------------------------------------------------------ onion skin

  setOnion(on: boolean, range: number): void {
    this.onionOn = on;
    this.onionRange = Math.max(1, Math.min(2, Math.round(range)));
    this.onionStale = true;
  }

  get onionEnabled(): boolean {
    return this.onionOn;
  }

  get onionSpan(): number {
    return this.onionRange;
  }

  markOnionStale(): void {
    this.onionStale = true;
  }

  /**
   * Rebuilds the onion skin: neighbour frames tinted (earlier red, later green), fading with distance. Dark
   * pixels (the lines) ghost stronger than light fills, so the previous page's lines stay easy to follow.
   */
  async refreshOnion(): Promise<void> {
    if (!this.onionOn || !this.onionStale) return;
    this.onionStale = false;
    const { W, H } = this.board;
    const frames = this.board.frames;
    const at = this.board.frameIndex(this.frame);
    const rgba = new Uint8ClampedArray(W * H * 4);
    for (let dist = this.onionRange; dist >= 1; dist--)
      for (const dir of [-1, 1]) {
        const f = frames[at + dir * dist];
        if (!f) continue;
        await this.board.ensureFrame(f.id);
        const flat = new Uint8ClampedArray(W * H * 4);
        for (const l of this.board.layers) {
          if (!l.visible || !EXPORTED_ROLES(l.role)) continue;
          const d = this.board.pixels(f.id, l.id);
          if (d) compositeLayer(flat, d, W, H, null, l.opacity, 'normal');
        }
        const [r, g, b] = ONION_TINTS[dir < 0 ? 0 : 1];
        const fade = dist === 1 ? 1 : 0.45;
        for (let j = 3; j < flat.length; j += 4) {
          if (!flat[j]) continue;
          const lum = (0.3 * flat[j - 3] + 0.59 * flat[j - 2] + 0.11 * flat[j - 1]) / 255;
          flat[j] = flat[j] * (0.6 - 0.44 * lum) * fade;
          flat[j - 3] = r;
          flat[j - 2] = g;
          flat[j - 1] = b;
        }
        compositeLayer(rgba, flat, W, H, null, 1, 'normal');
      }
    this.onion ??= make(W, H);
    this.onion.ctx.putImageData(new ImageData(rgba as Uint8ClampedArray<ArrayBuffer>, W, H), 0, 0);
    this.rebuildCaches(null);
    this.renderAll();
  }

  // ------------------------------------------------------------------------------------------ guide

  setGuide(g: Guide | null, anchor: [number, number] | null): void {
    this.guide = g;
    if (!g) this.guideLayer = null;
    else {
      this.guideLayer ??= make(this.board.W, this.board.H);
      drawGuide(this.guideLayer.ctx, this.board.W, this.board.H, g, anchor);
    }
    this.rebuildCaches(null);
    this.renderAll();
  }

  /** Moves the anchor pin (drawn only when the guide shows it). */
  setAnchor(anchor: [number, number] | null): void {
    if (this.guide?.showAnchor) this.setGuide(this.guide, anchor);
  }

  // ------------------------------------------------------------------------------------------ view

  setView(v: ViewState): void {
    this.view = v;
    if (this.gestureFrom) {
      this.canvas.style.transform = cssTransformBetween(this.gestureFrom, v);
      // Long gestures re-render now and then so newly exposed areas fill in.
      if (performance.now() - this.gestureAt > 150) this.startGesture();
    } else this.scheduleAll();
  }

  /** Starts moving the view with a CSS transform (no re-raster during the gesture). */
  startGesture(): void {
    this.canvas.style.transform = '';
    this.renderAll();
    this.gestureFrom = { ...this.view };
    this.gestureAt = performance.now();
  }

  endGesture(): void {
    if (!this.gestureFrom) return;
    this.gestureFrom = null;
    this.canvas.style.transform = '';
    this.renderAll();
  }

  get inGesture(): boolean {
    return this.gestureFrom !== null;
  }

  // ------------------------------------------------------------------------------------------ rendering

  private smoothing(v: Ctx2D): void {
    // Bilinear below 2x, crisp pixels at 2x and above (and always for pixel art). 'medium'/'high' would
    // mipmap the source sub-rect, so partial redraws would not match full ones.
    v.imageSmoothingEnabled = !this.board.pixelArt && this.view.zoom < 2;
    v.imageSmoothingQuality = 'low';
  }

  private drawDoc(v: Ctx2D, S: Rect): void {
    const sw = S.x1 - S.x0;
    const sh = S.y1 - S.y0;
    if (this.playback) return;
    v.drawImage(this.below.canvas, S.x0, S.y0, sw, sh, S.x0, S.y0, sw, sh);
    this.drawLayer(v, this.active, S);
    if (this.aboveSimple) v.drawImage(this.above.canvas, S.x0, S.y0, sw, sh, S.x0, S.y0, sw, sh);
    else {
      const layers = this.board.layers;
      for (let i = Math.max(0, this.board.layerIndex(this.active)) + 1; i < layers.length; i++) this.drawLayer(v, layers[i].id, S);
    }
    if (this.guideLayer && this.guide?.onTop) v.drawImage(this.guideLayer.canvas, S.x0, S.y0, sw, sh, S.x0, S.y0, sw, sh);
  }

  private drawPaper(v: Ctx2D, shadow: boolean): void {
    if (shadow) {
      v.shadowColor = 'rgba(40,30,20,0.22)';
      v.shadowBlur = 14 * this.dpr;
      v.shadowOffsetY = 3 * this.dpr;
    }
    v.fillStyle = this.paper;
    v.fillRect(0, 0, this.board.W, this.board.H);
    v.shadowColor = 'transparent';
    v.shadowBlur = 0;
    v.shadowOffsetY = 0;
  }

  /** Full redraw now. */
  renderAll(): void {
    if (this.raf) {
      cancelAnimationFrame(this.raf);
      this.raf = 0;
    }
    this.pending = null;
    const t0 = performance.now();
    const v = this.ctx;
    v.setTransform(1, 0, 0, 1, 0, 0);
    v.fillStyle = this.workspace;
    v.fillRect(0, 0, this.canvas.width, this.canvas.height);
    v.save();
    v.setTransform(...viewMatrix(this.view, this.dpr));
    this.drawPaper(v, true);
    this.smoothing(v);
    if (this.playback) this.drawPlayback(v);
    else this.drawDoc(v, { x0: 0, y0: 0, x1: this.board.W, y1: this.board.H });
    v.restore();
    this.drawOverlays({ x0: 0, y0: 0, x1: this.canvas.width, y1: this.canvas.height });
    if (this.forceRaster) this.ctx.getImageData(0, 0, 1, 1);
    this.onRender?.(performance.now() - t0, true);
  }

  scheduleAll(): void {
    this.pending = { x0: 0, y0: 0, x1: this.canvas.width, y1: this.canvas.height };
    this.schedule();
  }

  private schedule(): void {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      this.flush();
    });
  }

  /** Device rect covering board rect r. */
  private deviceRectOf(r: Rect): DRect | null {
    const D = toPixels(r, this.board.W, this.board.H, 1);
    if (isEmpty(D)) return null;
    const m = viewMatrix(this.view, this.dpr);
    let dx0 = Infinity;
    let dy0 = Infinity;
    let dx1 = -Infinity;
    let dy1 = -Infinity;
    for (const [x, y] of [
      [D.x0, D.y0],
      [D.x1, D.y0],
      [D.x0, D.y1],
      [D.x1, D.y1],
    ]) {
      const X = m[0] * x + m[2] * y + m[4];
      const Y = m[1] * x + m[3] * y + m[5];
      dx0 = Math.min(dx0, X);
      dy0 = Math.min(dy0, Y);
      dx1 = Math.max(dx1, X);
      dy1 = Math.max(dy1, Y);
    }
    return this.clampDevice({ x0: Math.floor(dx0) - 1, y0: Math.floor(dy0) - 1, x1: Math.ceil(dx1) + 1, y1: Math.ceil(dy1) + 1 });
  }

  private clampDevice(d: DRect): DRect | null {
    const r = { x0: Math.max(0, d.x0), y0: Math.max(0, d.y0), x1: Math.min(this.canvas.width, d.x1), y1: Math.min(this.canvas.height, d.y1) };
    return r.x1 > r.x0 && r.y1 > r.y0 ? r : null;
  }

  /** Marks a board rect for redraw (rendered on flush or the next frame). */
  invalidateDoc(r: Rect): void {
    const d = this.deviceRectOf(r);
    if (d) this.invalidateDevice(d);
  }

  /** Marks a view rect (CSS px) for redraw. */
  invalidateView(x0: number, y0: number, x1: number, y1: number): void {
    const k = this.dpr;
    const d = this.clampDevice({ x0: Math.floor(x0 * k) - 2, y0: Math.floor(y0 * k) - 2, x1: Math.ceil(x1 * k) + 2, y1: Math.ceil(y1 * k) + 2 });
    if (d) this.invalidateDevice(d);
  }

  private invalidateDevice(d: DRect): void {
    if (this.pending) {
      this.pending.x0 = Math.min(this.pending.x0, d.x0);
      this.pending.y0 = Math.min(this.pending.y0, d.y0);
      this.pending.x1 = Math.max(this.pending.x1, d.x1);
      this.pending.y1 = Math.max(this.pending.y1, d.y1);
    } else this.pending = { ...d };
    this.schedule();
  }

  /** Renders whatever is pending right now (the low-latency stroke path calls this per input event). */
  flush(): void {
    const d = this.pending;
    if (!d) return;
    this.pending = null;
    if (this.raf) {
      cancelAnimationFrame(this.raf);
      this.raf = 0;
    }
    if (this.gestureFrom) {
      this.renderAll();
      return;
    }
    if (d.x0 <= 0 && d.y0 <= 0 && d.x1 >= this.canvas.width && d.y1 >= this.canvas.height) {
      this.renderAll();
      return;
    }
    this.renderDevice(d);
  }

  private renderDevice(d: DRect): void {
    const t0 = performance.now();
    const m = viewMatrix(this.view, this.dpr);
    const det = m[0] * m[3] - m[1] * m[2];
    let sx0 = Infinity;
    let sy0 = Infinity;
    let sx1 = -Infinity;
    let sy1 = -Infinity;
    for (const [X, Y] of [
      [d.x0, d.y0],
      [d.x1, d.y0],
      [d.x0, d.y1],
      [d.x1, d.y1],
    ]) {
      const u = X - m[4];
      const w = Y - m[5];
      const x = (m[3] * u - m[2] * w) / det;
      const y = (-m[1] * u + m[0] * w) / det;
      sx0 = Math.min(sx0, x);
      sy0 = Math.min(sy0, y);
      sx1 = Math.max(sx1, x);
      sy1 = Math.max(sy1, y);
    }
    const v = this.ctx;
    v.save();
    v.setTransform(1, 0, 0, 1, 0, 0);
    v.beginPath();
    v.rect(d.x0, d.y0, d.x1 - d.x0, d.y1 - d.y0);
    v.clip();
    v.fillStyle = this.workspace;
    v.fillRect(d.x0, d.y0, d.x1 - d.x0, d.y1 - d.y0);
    v.setTransform(...m);
    // The shadow only shows where the redrawn area reaches past the paper's edge.
    this.drawPaper(v, sx0 < 0 || sy0 < 0 || sx1 > this.board.W || sy1 > this.board.H);
    this.smoothing(v);
    const S = toPixels({ x0: sx0, y0: sy0, x1: sx1, y1: sy1 }, this.board.W, this.board.H, 2);
    if (!isEmpty(S)) {
      if (this.playback) this.drawPlayback(v);
      else this.drawDoc(v, S);
    }
    v.restore();
    this.drawOverlays(d);
    if (this.forceRaster) this.ctx.getImageData(0, 0, 1, 1);
    this.onRender?.(performance.now() - t0, false);
  }

  // ------------------------------------------------------------------------------------------ overlays

  /** View rect (CSS px) covered by the current overlays (for invalidating them when they move). */
  overlayViewBounds(): Rect | null {
    const r = emptyRect();
    const o = this.overlays;
    const add = (p: Point, pad: number): void => {
      const q = docToView(this.view, p.x, p.y);
      unionInto(r, { x0: q.x - pad, y0: q.y - pad, x1: q.x + pad, y1: q.y + pad });
    };
    if (o.selection) {
      for (const p of o.selection.outline) add(p, 3);
      for (const p of o.selection.handles ?? []) add(p, 16);
      if (o.selection.rotate) add(o.selection.rotate, 16);
    }
    if (o.lasso) for (const p of o.lasso) add(p, 3);
    if (o.cursor) unionInto(r, { x0: o.cursor.x - o.cursor.r - 3, y0: o.cursor.y - o.cursor.r - 3, x1: o.cursor.x + o.cursor.r + 3, y1: o.cursor.y + o.cursor.r + 3 });
    return isEmpty(r) ? null : r;
  }

  private drawOverlays(clip: DRect): void {
    const o = this.overlays;
    const v = this.ctx;
    const k = this.dpr;
    const grid = this.board.pixelArt && this.view.zoom >= 8;
    if (!o.symmetry && !o.selection && !o.lasso && !o.cursor && !grid) return;
    v.save();
    v.setTransform(1, 0, 0, 1, 0, 0);
    v.beginPath();
    v.rect(clip.x0, clip.y0, clip.x1 - clip.x0, clip.y1 - clip.y0);
    v.clip();
    const toDev = (x: number, y: number): Point => {
      const p = docToView(this.view, x, y);
      return { x: p.x * k, y: p.y * k };
    };
    if (grid) this.drawGrid(v, toDev);
    if (o.symmetry) {
      v.strokeStyle = 'rgba(80,120,255,0.6)';
      v.lineWidth = 1.5 * k;
      v.setLineDash([6 * k, 6 * k]);
      const { W, H } = this.board;
      const line = (a: Point, b: Point): void => {
        v.beginPath();
        v.moveTo(a.x, a.y);
        v.lineTo(b.x, b.y);
        v.stroke();
      };
      const s = o.symmetry;
      if (s.radial) {
        for (let i = 0; i < s.radial.n; i++) {
          const a = (2 * Math.PI * i) / s.radial.n - Math.PI / 2;
          const R = Math.hypot(W, H);
          line(toDev(s.radial.cx, s.radial.cy), toDev(s.radial.cx + Math.cos(a) * R, s.radial.cy + Math.sin(a) * R));
        }
      } else {
        if (s.x !== null) line(toDev(s.x, 0), toDev(s.x, H));
        if (s.y !== null) line(toDev(0, s.y), toDev(W, s.y));
      }
      v.setLineDash([]);
    }
    const ants = (pts: Point[], closed: boolean): void => {
      if (pts.length < 2) return;
      v.beginPath();
      const p0 = toDev(pts[0].x, pts[0].y);
      v.moveTo(p0.x, p0.y);
      for (let i = 1; i < pts.length; i++) {
        const p = toDev(pts[i].x, pts[i].y);
        v.lineTo(p.x, p.y);
      }
      if (closed) v.closePath();
      v.lineWidth = 1.5 * k;
      v.setLineDash([]);
      v.strokeStyle = 'rgba(255,255,255,0.95)';
      v.stroke();
      v.setLineDash([5 * k, 4 * k]);
      v.strokeStyle = 'rgba(20,20,30,0.9)';
      v.stroke();
      v.setLineDash([]);
    };
    if (o.lasso) ants(o.lasso, false);
    if (o.selection) {
      ants(o.selection.outline, true);
      const handle = (p: Point, round: boolean): void => {
        const q = toDev(p.x, p.y);
        v.beginPath();
        if (round) v.arc(q.x, q.y, 7 * k, 0, Math.PI * 2);
        else v.rect(q.x - 6 * k, q.y - 6 * k, 12 * k, 12 * k);
        v.fillStyle = '#ffffff';
        v.fill();
        v.lineWidth = 2 * k;
        v.strokeStyle = '#2d6cdf';
        v.stroke();
      };
      for (const p of o.selection.handles ?? []) handle(p, false);
      if (o.selection.rotate) handle(o.selection.rotate, true);
    }
    if (o.cursor) {
      const { x, y, r } = o.cursor;
      v.beginPath();
      v.arc(x * k, y * k, Math.max(1.5, r) * k, 0, Math.PI * 2);
      v.lineWidth = 1 * k;
      v.strokeStyle = 'rgba(255,255,255,0.9)';
      v.stroke();
      v.beginPath();
      v.arc(x * k, y * k, Math.max(1.5, r) * k + k, 0, Math.PI * 2);
      v.strokeStyle = 'rgba(0,0,0,0.55)';
      v.stroke();
    }
    v.restore();
  }

  private drawGrid(v: CanvasRenderingContext2D, toDev: (x: number, y: number) => Point): void {
    const { W, H } = this.board;
    v.strokeStyle = 'rgba(0,0,0,0.12)';
    v.lineWidth = 1;
    v.beginPath();
    for (let x = 0; x <= W; x++) {
      const a = toDev(x, 0);
      const b = toDev(x, H);
      v.moveTo(a.x, a.y);
      v.lineTo(b.x, b.y);
    }
    for (let y = 0; y <= H; y++) {
      const a = toDev(0, y);
      const b = toDev(W, y);
      v.moveTo(a.x, a.y);
      v.lineTo(b.x, b.y);
    }
    v.stroke();
  }

  // ------------------------------------------------------------------------------------------ flipbook

  /** Plays the frames in place of the editable view until stopped. */
  async play(fps: number, onFrame?: (index: number) => void): Promise<() => void> {
    this.stopPlayback();
    const { W, H } = this.board;
    const frames: Array<OffscreenCanvas | null> = [];
    for (const f of this.board.frames) {
      await this.board.ensureFrame(f.id);
      const flat = new Uint8ClampedArray(W * H * 4);
      let any = false;
      for (const l of this.board.layers) {
        if (!l.visible || !EXPORTED_ROLES(l.role)) continue;
        const d = this.board.pixels(f.id, l.id);
        if (d) {
          compositeLayer(flat, d, W, H, null, l.opacity, l.blend);
          any = true;
        }
      }
      if (!any) {
        frames.push(null);
        continue;
      }
      const c = new OffscreenCanvas(W, H);
      c.getContext('2d')?.putImageData(new ImageData(flat, W, H), 0, 0);
      frames.push(c);
    }
    const holds = this.board.frames.map((f) => f.hold);
    const pb: Playback = { frames, timer: 0, index: 0, left: holds[0] ?? 1 };
    this.playback = pb;
    const tick = (): void => {
      if (this.playback !== pb) return;
      this.renderAll();
      onFrame?.(pb.index);
      pb.left--;
      if (pb.left <= 0) {
        pb.index = (pb.index + 1) % frames.length;
        pb.left = holds[pb.index] ?? 1;
      }
    };
    tick();
    pb.timer = window.setInterval(tick, 1000 / Math.max(1, Math.min(24, fps)));
    return () => this.stopPlayback();
  }

  get playing(): boolean {
    return this.playback !== null;
  }

  private drawPlayback(v: Ctx2D): void {
    const img = this.playback?.frames[this.playback.index];
    if (img) v.drawImage(img, 0, 0);
  }

  stopPlayback(): void {
    if (!this.playback) return;
    clearInterval(this.playback.timer);
    this.playback = null;
    this.renderAll();
  }

  // ------------------------------------------------------------------------------------------ misc

  /** The paper colour as RGB (for the eyedropper's empty-paper answer). */
  paperRgb(): [number, number, number] {
    return parseColor(this.paper) ?? [255, 255, 255];
  }

  destroy(): void {
    if (this.raf) cancelAnimationFrame(this.raf);
    if (this.playback) clearInterval(this.playback.timer);
    this.playback = null;
    this.canvas.remove();
    this.displays.clear();
  }
}
