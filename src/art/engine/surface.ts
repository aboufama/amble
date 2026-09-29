/**
 * The drawing surface: the framework-free controller the Draw room UI wraps. It owns the document (CPU
 * pixels), the painter, undo, the stroke log, the view and input, and talks to the UI through methods and
 * coarse events (never per pointer event).
 */
import { BRUSH_IDS, type BrushId, STEADY_MAX_PX, brushFor, defaultSteady } from './brushes';
import { type RGB, isColor, normalizeColor, parseColor, toHex } from './color';
import { type Point, type Rect, emptyRect, isEmpty, toPixels, unionInto } from './geom';
import { Board } from './board';
import { Compositor } from './compositor';
import { Emitter, Rolling } from './events';
import { type ArtExport, type ExportOptions, type FrameExport, autoAnchor, exportFrames, flatten, resize, trimBox } from './export';
import { defaultFillParams, type FillParams, type FillResult } from './fill';
import { PressureCalibrator } from './filters';
import { grainFor } from './grain';
import type { Guide } from './guide';
import { History, type Step, tilesOf } from './history';
import { InputController, type DownInfo, type InputSink, type PointerKind, type Sample } from './input';
import { type FillSample, type LogOp, type LogShape, type LogStroke, SampleBuffer, logSamples } from './log';
import { type ArtDoc, type ArtLayer, EXPORTED_ROLES, LIMITS, type LayerRole, isPartRole, makeLayer, uid } from './model';
import { Painter, type StrokeSession, type StrokeSpec } from './paint';
import { recognize, simplifyPath, type PerfectKind } from './shape';
import { ShapeTool } from './shape-tool';
import { SelectionTool } from './selection-tool';
import { type CelCache, type DocMeta, artDocToBoard, boardToArtDoc, newDocMeta, readLog } from './serialize';
import { addFrame, addLayer, clearLayer, duplicateLayer, mergeDown, moveFrame, moveLayer, removeFrame, removeLayer, setFrameHold, setLayer, type Snapshotter } from './structure';
import type { Symmetry } from './stroke';
import type { ArtSurface, ArtSurfaceOptions, BrushSettings, FrameInfo, HistoryState, LayerInfo, PerfStats, SelectionInfo, SurfaceEvents, ToolId, ToolState } from './surface-types';
import { type ViewState, clampZoom, docToView, fitView, snapRotation, viewToDoc, zoomAt } from './view';
import { type BoardCopy, type WorkerResponse } from './worker-core';
import { EngineWorker, engineWorker } from './worker-client';
import { isSoftwareGL } from './platform';
import { type SelectionTransform, apply as applyAffine, copyLayer } from './select';
import { alphaBounds } from './blend';

const DEFAULT_LAYERS: LayerRole[] = ['sketch', 'colors', 'lines'];
const HOLD_MS = 450;
const POUR_MS = 120;

interface StrokeCtx {
  session: StrokeSession;
  buf: SampleBuffer;
  tool: BrushId;
  input: PointerKind;
  steady: number;
  scale: number;
  color: string;
  soft: boolean;
  anchor: { vx: number; vy: number; t: number };
  snapAt?: number;
  holdTimer: number;
  lastVx: number;
  lastVy: number;
}

function defaultBrushes(pixelArt: boolean): Record<BrushId, BrushSettings> {
  const out = {} as Record<BrushId, BrushSettings>;
  for (const id of BRUSH_IDS) {
    const b = brushFor(id);
    out[id] = { size: pixelArt && id === 'eraser' ? 1 : b.size, opacity: b.opacity, steady: null, soft: false };
  }
  return out;
}

function prefersReducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

class Surface implements ArtSurface {
  readonly ready: Promise<void>;
  private readonly host: HTMLElement;
  private readonly o: ArtSurfaceOptions;
  private readonly em = new Emitter<SurfaceEvents>();
  private b: Board | null = null;
  private painter!: Painter;
  private hist!: History;
  private comp!: Compositor;
  private input!: InputController;
  private sel!: SelectionTool;
  private readonly worker: EngineWorker;
  private meta!: DocMeta;
  private ops: LogOp[] = [];
  private recording = true;
  private state: ToolState;
  private frameId = '';
  private layerId = '';
  private stroke: StrokeCtx | null = null;
  private panDrag: { x: number; y: number; start: ViewState } | null = null;
  private busy = false;
  /** Input that arrived while busy, replayed in order. */
  private queued: Array<() => void> = [];
  private pouring: { finish: () => void } | null = null;
  private previewBuf!: Uint8ClampedArray;
  private previewImg!: ImageData;
  private dirty = false;
  private readonly celCache: CelCache = new Map();
  private guide: Guide | null = null;
  private readonly calibrator = new PressureCalibrator();
  private pending: Step[] = [];
  private suppressUpload: string | null = null;
  private lastStroke: { op: LogStroke; points: Point[] } | null = null;
  /** Where the last brush stroke ended (Shift-click draws a straight line from there). */
  private lastEnd: Point | null = null;
  /** A finger held still at the start of a stroke picks a colour instead (long press). */
  private pressTimer = 0;
  private shapes!: ShapeTool;
  /** The outline being drawn with Lasso fill, board px. */
  private lassoFill: Point[] | null = null;
  private linesTimer = 0;
  private idleTimer = 0;
  private resizeObs: ResizeObserver | null = null;
  private destroyed = false;
  private readonly reducedMotion: boolean;
  private readonly st = {
    latency: new Rolling(),
    work: new Rolling(),
    commit: new Rolling(),
    raster: new Rolling(),
    blend: new Rolling(),
    upload: new Rolling(),
    composite: new Rolling(),
    fills: [] as PerfStats['fills'],
  };
  private layerSig = '';

  constructor(host: HTMLElement, doc: ArtDoc | null, o: ArtSurfaceOptions) {
    this.host = host;
    this.o = o;
    this.recording = o.record !== false;
    this.reducedMotion = o.reducedMotion ?? prefersReducedMotion();
    this.worker = o.worker === false ? new EngineWorker(false) : engineWorker();
    const pixelArt = doc ? doc.pixelArt : !!o.pixelArt;
    this.state = {
      tool: pixelArt ? 'pixel' : 'ink',
      color: '#2b1d16',
      brushes: defaultBrushes(pixelArt),
      mirror: { x: null, y: null },
      holdToPerfect: !pixelArt,
      fill: { gaps: 'auto', tolerance: 40, all: false },
      pressure: { feel: 'normal', calibrate: true },
      select: { scope: 'drawing' },
      shape: { kind: 'line', filled: false },
      tapToInk: false,
    };
    if (doc) {
      this.ready = (async () => {
        const board = await artDocToBoard(doc);
        const log = this.recording ? await readLog(doc).catch(() => null) : null;
        if (this.destroyed) return;
        this.setup(board, { id: doc.id, name: doc.name, kind: doc.kind, rig: doc.rig, anchor: doc.anchor, created: doc.created, version: doc.version }, log);
      })();
    } else {
      const W = Math.round(o.width ?? 1024);
      const H = Math.round(o.height ?? 1024);
      const board = new Board(W, H, pixelArt);
      const roles = o.layers?.length ? o.layers : pixelArt ? (['paint'] as LayerRole[]) : DEFAULT_LAYERS;
      board.layers = roles.map((r) => {
        const l = makeLayer(uid('l'), r);
        if (r === 'sketch' && !o.layers) l.visible = false;
        return l;
      });
      board.frames = [{ id: uid('f'), hold: 1 }];
      this.setup(board, newDocMeta(o.name ?? 'Drawing', o.kind ?? 'character', o.rig), null);
      this.ready = Promise.resolve();
    }
    this.ready.catch((err: unknown) => this.em.emit('error', { message: err instanceof Error ? err.message : String(err) }));
  }

  // ------------------------------------------------------------------------------------------ setup

  private get board(): Board {
    if (!this.b) throw new Error('ArtSurface is not ready yet (await surface.ready)');
    return this.b;
  }

  private setup(board: Board, meta: DocMeta, log: LogOp[] | null): void {
    this.b = board;
    this.meta = meta;
    this.frameId = board.frames[0].id;
    const editable = [...board.layers].reverse().find((l) => l.visible && EXPORTED_ROLES(l.role));
    this.layerId = (editable ?? board.layers[board.layers.length - 1]).id;
    this.ops = this.recording ? (log && log.length && log[0].op === 'init' ? log : [{ op: 'init', width: board.W, height: board.H, pixelArt: board.pixelArt, layers: board.layers.map((l) => ({ ...l })), frames: board.frames.map((f) => ({ ...f })) }]) : [];
    this.previewBuf = new Uint8ClampedArray(board.W * board.H * 4);
    this.previewImg = new ImageData(this.previewBuf as Uint8ClampedArray<ArrayBuffer>, board.W, board.H);
    this.painter = new Painter(board, { before: (f, l, tiles) => this.pending.push({ pixels: this.hist.snapshot(f, l, tiles) }) });
    this.hist = new History(board, this.o.historyBytes ?? LIMITS.historyBytes, {
      pack: async (data) => ((await this.worker.call({ type: 'pack', data: data.slice() })) as Extract<WorkerResponse, { type: 'pack' }>).z,
      unpack: async (z) => ((await this.worker.call({ type: 'unpack', z })) as Extract<WorkerResponse, { type: 'unpack' }>).data,
    });
    if (getComputedStyle(this.host).position === 'static') this.host.style.position = 'relative';
    this.host.style.overflow = 'hidden';
    this.host.style.background = this.o.workspace ?? '#e6e1d8';
    if (!this.host.hasAttribute('tabindex')) this.host.tabIndex = 0;
    this.host.setAttribute('role', this.o.a11y?.role ?? 'img');
    this.comp = new Compositor(this.host, board, this.frameId, this.layerId, { paper: this.o.paper ?? '#fffdf7', workspace: this.o.workspace ?? '#e6e1d8', desynchronized: this.o.desynchronized ?? !isSoftwareGL() });
    this.comp.forceRaster = !!this.o.perfProbe;
    this.sel = new SelectionTool({
      board,
      comp: this.comp,
      history: this.hist,
      frame: () => this.frameId,
      layer: () => this.layerId,
      scope: () => this.state.select.scope,
      view: () => this.comp.view,
      preview: () => ({ buf: this.previewBuf, img: this.previewImg }),
      commit: (label, steps, op) => this.record(label, steps, op, op.layer),
      setActiveLayer: (id) => this.setActiveLayer(id),
      canAddLayer: () => board.layers.length < board.maxLayers(),
      toast: (message) => this.em.emit('toast', { message, kind: 'info' }),
      changed: (info) => {
        this.em.emit('selection', info);
        this.em.emit('change', { reason: 'selection' });
      },
    });
    this.shapes = new ShapeTool({
      comp: this.comp,
      view: () => this.comp.view,
      frame: () => this.frameId,
      size: () => ({ W: board.W, H: board.H }),
      style: () => {
        const b = this.state.brushes.ink;
        return { brush: board.pixelArt ? 'pixel' : 'ink', size: board.pixelArt ? this.state.brushes.pixel.size : b.size, opacity: b.opacity, color: this.state.color };
      },
      mirror: () => this.symmetry(),
      outlineLayer: () => this.editableLayer()?.id ?? null,
      fillLayer: () => this.fillTarget()?.layer.id ?? null,
      commit: (op) => {
        this.painter.paintShape(op);
        this.record(op.filled ? 'Filled shape' : 'Shape', this.takePending(), op, op.layer);
        this.comp.flush();
      },
      undo: () => this.undoStep(),
      changed: () => this.comp.flush(),
    });
    this.shapes.setState(this.state.shape);
    this.input = new InputController(this.host, this.sink());
    this.input.rotate = this.o.rotate !== false;
    this.input.tapToInk = this.state.tapToInk;
    this.layerSig = this.sigOf();
    board.listen((kind, frame, layer, rect) => this.onBoard(kind, frame, layer, rect));
    this.comp.reload();
    this.resizeObs = new ResizeObserver(() => {
      const fitted = this.isFitted();
      if (this.comp.measure()) {
        if (fitted) this.comp.view = fitView(board.W, board.H, this.comp.cssW, this.comp.cssH);
        this.comp.renderAll();
        this.em.emit('view', this.comp.view);
      }
    });
    this.resizeObs.observe(this.host);
    this.describe();
    this.scheduleLinesAnalysis();
    // Start the worker now so the first fill does not wait for it to load.
    void this.worker.call({ type: 'pack', data: new Uint8Array(1) }).catch(() => undefined);
    // Build the paper grain while idle, so the first pencil or crayon stroke does not pay for it.
    if (!board.pixelArt) {
      const warm = (): void => {
        grainFor('pencil');
        grainFor('crayon');
      };
      if (typeof requestIdleCallback === 'function') requestIdleCallback(warm, { timeout: 3000 });
      else setTimeout(warm, 500);
    }
  }

  private sigOf(): string {
    return this.b ? this.b.layers.map((l) => l.id).join(',') + '|' + this.b.frames.map((f) => f.id).join(',') : '';
  }

  private isFitted(): boolean {
    const f = fitView(this.board.W, this.board.H, this.comp.cssW, this.comp.cssH);
    const v = this.comp.view;
    return Math.abs(f.zoom - v.zoom) < 1e-6 && Math.abs(f.panX - v.panX) < 0.5 && Math.abs(f.panY - v.panY) < 0.5 && v.rot === 0;
  }

  private onBoard(kind: 'pixels' | 'layers' | 'frames', frame: string | null, layer: string | null, rect: Rect | null): void {
    const board = this.board;
    // Anything else changing the pixels ends a running pour first (its reveal would paint over it).
    if (this.pouring && this.suppressUpload === null) this.finishPour();
    if (kind === 'pixels') {
      if (frame === this.frameId && layer) {
        const r = rect ?? { x0: 0, y0: 0, x1: board.W, y1: board.H };
        if (this.suppressUpload === layer) this.comp.invalidateDoc(r);
        else this.comp.layerChanged(layer, r);
        if (board.layer(layer)?.role === 'lines') this.scheduleLinesAnalysis();
      } else if (frame && this.comp.onionEnabled) this.comp.markOnionStale();
      this.markDirty();
      this.em.emit('change', { reason: 'pixels' });
      return;
    }
    const sig = this.sigOf();
    if (!board.layer(this.layerId)) this.layerId = [...board.layers].reverse().find((l) => l.role !== 'trace')?.id ?? board.layers[0].id;
    if (board.frameIndex(this.frameId) < 0) this.frameId = board.frames[0].id;
    this.comp.active = this.layerId;
    if (this.comp.frame !== this.frameId) {
      const f = this.frameId;
      void board.ensureFrame(f).then(() => {
        if (this.frameId === f) this.comp.setFrame(f);
      });
    } else if (sig !== this.layerSig) this.comp.reload();
    else {
      this.comp.rebuildCaches(null);
      this.comp.renderAll();
    }
    this.layerSig = sig;
    this.comp.markOnionStale();
    void this.comp.refreshOnion();
    this.markDirty();
    this.scheduleLinesAnalysis();
    if (kind === 'layers') {
      this.em.emit('layers', this.layers());
      this.em.emit('change', { reason: 'layers' });
    } else {
      this.em.emit('frames', this.frames());
      this.em.emit('change', { reason: 'frames' });
    }
    this.describe();
  }

  private markDirty(): void {
    if (this.dirty) return;
    this.dirty = true;
    this.em.emit('dirty', true);
  }

  private describe(): void {
    const b = this.board;
    const summary = `${this.meta.name}, drawing, ${b.layers.length} layers, ${b.frames.length} ${b.frames.length === 1 ? 'page' : 'pages'}`;
    if (this.o.a11y) {
      this.host.setAttribute('aria-label', this.o.a11y.label);
      this.host.setAttribute('aria-description', summary);
    } else this.host.setAttribute('aria-label', summary);
  }

  on<K extends keyof SurfaceEvents>(type: K, fn: (e: SurfaceEvents[K]) => void): () => void {
    return this.em.on(type, fn);
  }

  get width(): number {
    return this.board.W;
  }

  get height(): number {
    return this.board.H;
  }

  get pixelArt(): boolean {
    return this.board.pixelArt;
  }

  // ------------------------------------------------------------------------------------------ recording

  /**
   * Pushes a history step and logs its op; the one place operations are committed. An operation that changed
   * nothing (a stroke on the desk beside the paper) is neither: every logged op is exactly one undo step, so
   * the log's undo marks take back what the student's undos took back, and replays match the drawing.
   */
  private record(label: string, steps: Step[], op: Exclude<LogOp, { op: 'undo' } | { op: 'redo' } | { op: 'init' }>, layer: string | null): void {
    if (!steps.length) return;
    this.hist.push({ label, steps });
    if (this.recording) {
      if (logSamples(this.ops) + (op.op === 'stroke' ? op.dts.length : 0) > LIMITS.logSamples) this.recording = false;
      else this.ops.push(op);
    }
    this.markDirty();
    this.em.emit('history', this.historyState());
    this.em.emit('commit', { op: op.op, label, layer, frame: this.frameId });
    this.scheduleIdle();
  }

  private takePending(): Step[] {
    const p = this.pending;
    this.pending = [];
    return p;
  }

  private snapshotter(): Snapshotter {
    return (f, l, tiles) => this.hist.snapshot(f, l, tiles);
  }

  /** Compresses old undo steps when the page is idle. */
  private scheduleIdle(): void {
    clearTimeout(this.idleTimer);
    this.idleTimer = window.setTimeout(() => {
      // Packing happens in the worker a tile at a time, so it runs on even when the page never idles; it
      // pauses while drawing or filling and picks up again later.
      const run = (): void => {
        void this.hist.compressIdle(3, () => this.destroyed || this.stroke !== null || this.busy).then((done) => {
          if (this.destroyed) return;
          if (done) void this.packFrames();
          else this.scheduleIdle();
        });
      };
      if (typeof requestIdleCallback === 'function') requestIdleCallback(run, { timeout: 4000 });
      else run();
    }, 1500);
  }

  private async packFrames(): Promise<void> {
    const b = this.board;
    if (b.frames.length < 2) return;
    const at = b.frameIndex(this.frameId);
    const keep = new Set(b.frames.filter((_, i) => Math.abs(i - at) <= 2).map((f) => f.id));
    await b.packIdle(keep);
  }

  // ------------------------------------------------------------------------------------------ input sink

  private sink(): InputSink {
    return {
      down: (s, info) => this.down(s, info),
      move: (samples) => this.move(samples),
      up: (s, cancelled) => this.up(s, cancelled),
      tapTool: () => this.state.tool === 'fill' || this.state.tool === 'eyedropper',
      hover: (s, kind) => this.hover(s, kind),
      render: () => this.render(),
      view: () => this.comp.view,
      setView: (v) => this.moveView(v),
      gestureStart: () => {
        this.hover(null, 'mouse');
        this.comp.startGesture();
      },
      gestureEnd: () => {
        this.comp.endGesture();
        this.em.emit('view', this.comp.view);
      },
      undo: () => void this.undo(),
      redo: () => void this.redo(),
      key: (e, down) => (down ? this.key(e) : false),
      isStroke: () => this.stroke !== null,
    };
  }

  private down(s: Sample, info: DownInfo): boolean {
    if (!this.b || this.comp.playing) return false;
    if (this.busy) {
      // A fill is being worked out: hold this interaction and replay it in order right after.
      this.queued.push(() => void this.down(s, info));
      return true;
    }
    this.finishPour();
    const tool: ToolId = info.eraser ? 'eraser' : info.barrel ? 'eyedropper' : this.state.tool;
    this.hover(null, info.kind);
    switch (tool) {
      case 'fill':
        void this.fillAt(s.x, s.y, { all: this.state.fill.all });
        return true;
      case 'eyedropper':
        this.setColor(this.pickColor(s.x, s.y));
        this.em.emit('color', { color: this.state.color });
        return true;
      case 'lasso':
      case 'select':
        return this.sel.down(s, tool);
      case 'shape':
        if (this.sel.active) this.sel.commit();
        return this.shapes.down(s, !!info.shift);
      case 'lassofill':
        if (this.sel.active) this.sel.commit();
        this.lassoFill = [{ x: s.x, y: s.y }];
        this.showLasso(this.lassoFill);
        return true;
      case 'pan':
        this.panDrag = { x: s.vx, y: s.vy, start: { ...this.comp.view } };
        this.comp.startGesture();
        return true;
      default:
        if (this.sel.active) this.sel.commit();
        if (info.shift && this.lastEnd && info.kind !== 'touch') {
          this.straightStroke(this.lastEnd, s, info, tool);
          return false;
        }
        if (!this.beginStroke(s, info, tool)) return false;
        if (info.kind === 'touch') this.watchLongPress(s);
        return true;
    }
  }

  /** Shift-click: a straight stroke from where the last one ended, with the current brush. */
  private straightStroke(from: Point, to: Sample, info: DownInfo, tool: BrushId): void {
    const n = Math.max(2, Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) / 2));
    const z = this.comp.view.zoom;
    const at = (k: number): Sample => {
      const x = from.x + ((to.x - from.x) * k) / n;
      const y = from.y + ((to.y - from.y) * k) / n;
      return { x, y, vx: to.vx + (x - to.x) * z, vy: to.vy + (y - to.y) * z, p: 0.5, t: to.t - (n - k) * 8 };
    };
    if (!this.beginStroke(at(0), { ...info, shift: false }, tool)) return;
    for (let k = 1; k <= n; k++) this.addSample(at(k));
    this.endStroke(at(n), false);
  }

  /** Long press (a finger held still ~0.6 s where a stroke starts): pick the colour there instead. */
  private watchLongPress(s: Sample): void {
    clearTimeout(this.pressTimer);
    const st = this.stroke;
    this.pressTimer = window.setTimeout(() => {
      if (!st || this.stroke !== st || Math.hypot(st.lastVx - s.vx, st.lastVy - s.vy) > 6) return;
      this.endStroke(null, true);
      this.setColor(this.pickColor(s.x, s.y));
      this.em.emit('color', { color: this.state.color });
    }, 600);
  }

  /** Shows (or hides) the lasso fill's outline. */
  private showLasso(pts: Point[] | null): void {
    const c = this.comp;
    const before = c.overlayViewBounds();
    c.overlays.lasso = pts;
    const after = c.overlayViewBounds();
    for (const r of [before, after]) if (r) c.invalidateView(r.x0 - 2, r.y0 - 2, r.x1 + 2, r.y1 + 2);
  }

  /** Lasso fill: whatever was drawn around fills with the current colour, under the lines. */
  private endLassoFill(): void {
    const pts = this.lassoFill;
    this.lassoFill = null;
    this.showLasso(null);
    this.comp.flush();
    if (!pts || pts.length < 3) return;
    let area = 0;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      area += a.x * b.y - b.x * a.y;
    }
    if (Math.abs(area) / 2 < 16) {
      this.em.emit('toast', { message: 'Draw all the way around what to fill', kind: 'fill' });
      return;
    }
    const target = this.fillTarget();
    if (!target) return;
    const simple = simplifyPath(pts, 0.75);
    const op: LogShape = {
      op: 'shape',
      layer: target.layer.id,
      frame: this.frameId,
      shape: 'polygon',
      brush: 'ink',
      size: 1,
      color: this.state.color,
      opacity: 1,
      points: simple.map((p) => [Math.round(p.x * 8) / 8, Math.round(p.y * 8) / 8]),
      filled: true,
      mirror: this.symmetry(),
      outline: false,
    };
    const box = this.painter.paintShape(op);
    this.record('Lasso fill', this.takePending(), op, op.layer);
    this.startPour(op.layer, box, pts[0].x, pts[0].y);
  }

  private move(samples: Sample[]): void {
    if (this.busy) {
      this.queued.push(() => this.move(samples));
      return;
    }
    if (this.stroke) {
      for (const s of samples) this.addSample(s);
      return;
    }
    const last = samples[samples.length - 1];
    if (this.state.tool === 'shape') {
      this.shapes.move(samples);
      return;
    }
    if (this.lassoFill) {
      for (const s of samples) {
        const p = this.lassoFill[this.lassoFill.length - 1];
        if (Math.hypot(s.x - p.x, s.y - p.y) * this.comp.view.zoom >= 1.5) this.lassoFill.push({ x: s.x, y: s.y });
      }
      this.showLasso(this.lassoFill);
      return;
    }
    if (this.panDrag && last) {
      const st = this.panDrag.start;
      this.moveView({ ...st, panX: st.panX + last.vx - this.panDrag.x, panY: st.panY + last.vy - this.panDrag.y });
      return;
    }
    // Every sample: a lasso outline needs the whole path, not one point per frame.
    if (this.sel.active) for (const s of samples) this.sel.move(s);
  }

  private up(s: Sample | null, cancelled: boolean): void {
    if (this.busy) {
      this.queued.push(() => this.up(s, cancelled));
      return;
    }
    if (this.stroke) {
      this.endStroke(s, cancelled);
      return;
    }
    if (this.state.tool === 'shape') {
      this.shapes.up(cancelled ? null : s);
      return;
    }
    if (this.lassoFill) {
      if (s && !cancelled) this.lassoFill.push({ x: s.x, y: s.y });
      if (cancelled) this.lassoFill = null;
      this.endLassoFill();
      return;
    }
    if (this.panDrag) {
      this.panDrag = null;
      this.comp.endGesture();
      this.em.emit('view', this.comp.view);
      return;
    }
    if (this.sel.active) {
      if (s) this.sel.move(s);
      this.sel.up();
      this.sel.render();
      this.comp.flush();
    }
  }

  /** Engine + composite work for pending input (under the input's render budget). */
  private render(): void {
    if (this.busy) {
      this.input.pendingStamps.length = 0;
      return;
    }
    const t0 = performance.now();
    if (this.stroke) {
      const st = this.stroke;
      const r = st.session.update();
      this.st.raster.push(performance.now() - t0);
      this.showStroke(st.session, r);
    } else if (this.sel.active) this.sel.render();
    const t1 = performance.now();
    this.comp.flush();
    const now = performance.now();
    this.st.composite.push(now - t1);
    this.st.work.push(now - t0);
    for (const t of this.input.pendingStamps) this.st.latency.push(now - t);
    this.input.pendingStamps.length = 0;
  }

  /** Shows the layer with the live stroke in rect r (the preview is exactly what commit will write). */
  private showStroke(session: StrokeSession, r: Rect): void {
    if (isEmpty(r)) return;
    const t0 = performance.now();
    session.preview(this.previewBuf, r);
    const t1 = performance.now();
    this.comp.showPreview(session.spec.layer, this.previewImg, r);
    this.st.blend.push(t1 - t0);
    this.st.upload.push(performance.now() - t1);
    this.comp.invalidateDoc(r);
  }

  private hover(s: Sample | null, kind: PointerKind): void {
    const c = this.comp;
    if (!c) return;
    if (this.state.tool === 'shape') this.shapes.hover(s);
    const old = c.overlays.cursor;
    const tool = this.state.tool;
    const brush = (BRUSH_IDS as readonly string[]).includes(tool) ? this.state.brushes[tool as BrushId] : null;
    const next = s && brush && kind !== 'touch' ? { x: s.vx, y: s.vy, r: (brush.size / 2) * c.view.zoom } : null;
    if (!old && !next) return;
    c.overlays.cursor = next;
    for (const q of [old, next]) if (q) c.invalidateView(q.x - q.r - 3, q.y - q.r - 3, q.x + q.r + 3, q.y + q.r + 3);
  }

  previewBrush(id: BrushId | null): void {
    const c = this.comp;
    if (!c) return;
    const old = c.overlays.cursor;
    const next = id ? { x: c.cssW / 2, y: c.cssH / 2, r: Math.max(1, (this.state.brushes[id].size / 2) * c.view.zoom) } : null;
    if (!old && !next) return;
    c.overlays.cursor = next;
    for (const q of [old, next]) if (q) c.invalidateView(q.x - q.r - 3, q.y - q.r - 3, q.x + q.r + 3, q.y + q.r + 3);
  }

  private moveView(v: ViewState): void {
    this.comp.setView({ ...v, zoom: clampZoom(v.zoom) });
    if (!this.comp.inGesture) this.em.emit('view', this.comp.view);
  }

  // ------------------------------------------------------------------------------------------ strokes

  private symmetry(): Symmetry | null {
    const m = this.state.mirror;
    return m.x === null && m.y === null ? null : { x: m.x, y: m.y, radial: null };
  }

  private rgb(): RGB {
    return parseColor(this.state.color) ?? [0, 0, 0];
  }

  private pressure(raw: number, kind: PointerKind): number {
    if (kind !== 'pen') return 0.5;
    this.calibrator.observe(raw);
    return this.calibrator.apply(raw);
  }

  private editableLayer(): ArtLayer | null {
    const l = this.board.layer(this.layerId);
    if (!l) return null;
    if (l.locked) {
      this.em.emit('toast', { message: 'This layer is locked', kind: 'info' });
      return null;
    }
    if (!l.visible) {
      this.em.emit('toast', { message: 'This layer is hidden', kind: 'info' });
      return null;
    }
    return l;
  }

  private beginStroke(s: Sample, info: DownInfo, tool: BrushId): boolean {
    const layer = this.editableLayer();
    if (!layer) return false;
    const bs = this.state.brushes[tool];
    const steady = bs.steady ?? defaultSteady(info.kind);
    const brush = brushFor(tool, { size: bs.size, opacity: bs.opacity, soft: tool === 'eraser' && bs.soft });
    const scale = this.comp.view.zoom;
    const buf = new SampleBuffer();
    const q = buf.push(s.x, s.y, this.pressure(s.p, info.kind), s.t);
    const spec: StrokeSpec = {
      frame: this.frameId,
      layer: layer.id,
      brush,
      rgb: this.rgb(),
      realPressure: info.kind === 'pen',
      scale,
      stabilizer: steady * STEADY_MAX_PX,
      predictMs: steady > 0 ? 0 : 12,
      symmetry: this.symmetry(),
    };
    const session = this.painter.begin(spec, q.x, q.y, q.p, q.t);
    const holds = this.state.holdToPerfect && !session.isPixel && brush.kind === 'capsule';
    this.stroke = {
      session,
      buf,
      tool,
      input: info.kind,
      steady,
      scale,
      color: this.state.color,
      soft: tool === 'eraser' && bs.soft,
      anchor: { vx: s.vx, vy: s.vy, t: performance.now() },
      holdTimer: holds ? window.setInterval(() => this.checkHold(), 60) : 0,
      lastVx: s.vx,
      lastVy: s.vy,
    };
    return true;
  }

  private addSample(s: Sample): void {
    const st = this.stroke;
    if (!st) return;
    const q = st.buf.push(s.x, s.y, this.pressure(s.p, st.input), s.t);
    st.session.add(q.x, q.y, q.p, q.t);
    st.lastVx = s.vx;
    st.lastVy = s.vy;
    if (Math.hypot(s.vx - st.anchor.vx, s.vy - st.anchor.vy) > 4) st.anchor = { vx: s.vx, vy: s.vy, t: performance.now() };
  }

  private checkHold(): void {
    const st = this.stroke;
    if (!st || st.session.locked) {
      if (st) clearInterval(st.holdTimer);
      return;
    }
    if (performance.now() - st.anchor.t < HOLD_MS) return;
    clearInterval(st.holdTimer);
    st.holdTimer = 0;
    const r = st.session.snap();
    if (!r) return;
    st.snapAt = st.buf.n;
    this.showStroke(st.session, r.dirty);
    this.comp.flush();
    this.em.emit('toast', { message: `Perfect ${r.shape.kind}!`, kind: 'shape', shape: r.shape.kind });
  }

  private endStroke(s: Sample | null, cancelled: boolean): void {
    const st = this.stroke;
    if (!st) return;
    this.stroke = null;
    clearTimeout(this.pressTimer);
    if (st.holdTimer) clearInterval(st.holdTimer);
    const layer = st.session.spec.layer;
    if (cancelled) {
      const r = st.session.cancel();
      this.comp.layerChanged(layer, r);
      this.comp.invalidateDoc(r);
      this.comp.flush();
      return;
    }
    const t0 = performance.now();
    if (s && !st.session.locked) {
      const last = st.buf.n - 1;
      const lx = st.buf.xyp[last * 3];
      const ly = st.buf.xyp[last * 3 + 1];
      if (Math.hypot(s.x - lx, s.y - ly) > 0.05) this.addSample(s);
    }
    // Samples whose render was deferred to the next frame are shown first, then the final taper.
    this.showStroke(st.session, st.session.update());
    const fin = st.session.finish();
    this.showStroke(st.session, fin);
    // The preview already shows exactly the committed pixels: skip re-uploading the stroke's box.
    this.suppressUpload = layer;
    st.session.commit(this.previewBuf);
    this.suppressUpload = null;
    const { xyp, dts } = st.buf.take();
    if (dts.length) this.lastEnd = { x: xyp[(dts.length - 1) * 3], y: xyp[(dts.length - 1) * 3 + 1] };
    const op: LogStroke = {
      op: 'stroke',
      layer,
      frame: this.frameId,
      brush: st.tool,
      size: st.session.spec.brush.size,
      color: st.color,
      opacity: st.session.spec.brush.opacity,
      steady: st.steady,
      ...(st.soft ? { soft: true } : {}),
      input: st.input,
      scale: st.scale,
      mirror: st.session.spec.symmetry,
      ...(st.snapAt !== undefined ? { snap: st.snapAt } : {}),
      xyp,
      dts,
    };
    const steps = this.takePending();
    // A stroke that left no ink (all of it off the paper) is nothing "Make it perfect" could take back.
    this.lastStroke = steps.length ? { op, points: st.session.pointsBeforeFinish } : null;
    this.record(st.session.spec.brush.label, steps, op, layer);
    this.comp.flush();
    this.st.commit.push(performance.now() - t0);
  }

  async makeLastStrokePerfect(): Promise<PerfectKind | null> {
    const last = this.lastStroke;
    const top = this.ops[this.ops.length - 1];
    if (!last || last.op.snap !== undefined || (this.recording && top !== last.op)) return null;
    const shape = recognize(last.points);
    if (!shape) return null;
    if (!(await this.undo())) return null;
    const op: LogStroke = { ...last.op, snap: last.op.dts.length };
    await this.board.ensureFrame(op.frame);
    this.painter.paintLogStroke(op);
    this.lastStroke = { op, points: last.points };
    this.record(`Perfect ${shape.kind}`, this.takePending(), op, op.layer);
    this.em.emit('toast', { message: `Perfect ${shape.kind}!`, kind: 'shape', shape: shape.kind });
    return shape.kind;
  }

  // ------------------------------------------------------------------------------------------ fill

  /**
   * Where a fill lands (§7.3, §7.4): under the lines. Tapping Fill on a plain lines layer paints on the
   * colors layer below it (created if missing); on a part's lines layer, on that part's colours; a body part
   * is walled by its own pair's lines, anything else by every visible lines layer.
   */
  private fillTarget(): { layer: ArtLayer; sample: FillSample; lines: string | null } | null {
    const board = this.board;
    const plan = this.painter.fillPlan(this.frameId, this.layerId);
    if (!plan) return null;
    let layer = board.layer(plan.target);
    if (!layer) return null;
    if (layer.role === 'lines') {
      const i = board.layerIndex(layer.id);
      let colors = [...board.layers.slice(0, i)].reverse().find((l) => l.role === 'colors');
      if (!colors) {
        const id = this.addLayer('colors', { index: i });
        colors = id ? board.layer(id) : undefined;
      }
      if (colors) layer = colors;
    }
    if (layer.locked) {
      this.em.emit('toast', { message: 'This layer is locked', kind: 'info' });
      return null;
    }
    if (!layer.visible) {
      this.em.emit('toast', { message: 'This layer is hidden', kind: 'info' });
      return null;
    }
    if (layer.id === plan.target) return { layer, sample: plan.sample, lines: plan.lines };
    const lines = this.painter.hasVisibleLines(this.frameId);
    return { layer, sample: lines ? 'lines' : isPartRole(layer.role) ? 'layer' : 'all', lines: null };
  }

  /**
   * Fills at a board point with the current colour: the gap-closing fill, or with `all`, every pixel of the
   * tapped colour on the target layer ("Fill all of this colour").
   */
  async fillAt(x: number, y: number, o: { all?: boolean } = {}): Promise<boolean> {
    if (this.busy) return new Promise((resolve) => this.queued.push(() => void this.fillAt(x, y, o).then(resolve)));
    if (this.stroke) return false;
    this.finishPour();
    if (this.sel.active) this.sel.commit();
    const board = this.board;
    if (!(x >= 0 && y >= 0 && x < board.W && y < board.H)) return false;
    const target = this.fillTarget();
    if (!target) return false;
    if (o.all) return this.fillAll(target.layer.id, x, y);
    // While the worker works, input is queued (not dropped) so the log stays in order.
    this.busy = true;
    const t0 = performance.now();
    try {
      const params = defaultFillParams(this.state.fill.gaps, board.W, board.H, board.pixelArt);
      const req = { frame: this.frameId, layer: target.layer.id, x, y, tolerance: this.state.fill.tolerance, sample: target.sample, params, lines: target.lines };
      const { result, analyzeMs } = await this.computeFill(req.sample, req.layer, x, y, req.tolerance, params, req.lines);
      if (!result) {
        this.em.emit('toast', { message: 'Tap inside a shape to fill it', kind: 'fill' });
        return false;
      }
      // Paint the pixels now; the screen catches up with the pour.
      this.suppressUpload = req.layer;
      this.painter.applyFill(req, result, this.rgb());
      this.suppressUpload = null;
      this.record('Fill', this.takePending(), { op: 'fill', layer: req.layer, frame: req.frame, x, y, color: this.state.color, tolerance: req.tolerance, sample: req.sample, gaps: params.gaps, fallbackGap: params.fallbackGap, ...(req.lines ? { lines: req.lines } : {}) }, req.layer);
      this.startPour(req.layer, result.box, x, y);
      this.st.fills.push({ ms: performance.now() - t0, analyzeMs, gap: result.gap, background: result.background, split: result.split, area: result.area, mode: req.sample });
      if (this.st.fills.length > 50) this.st.fills.shift();
      if (result.gap > 0 && !result.background) this.em.emit('toast', { message: `Closed a ${result.gap} px gap`, kind: 'fill', gap: result.gap });
      return true;
    } catch (err) {
      this.em.emit('error', { message: err instanceof Error ? err.message : String(err) });
      return false;
    } finally {
      this.busy = false;
      const q = this.queued;
      this.queued = [];
      for (const f of q) f();
      this.checkSettled();
    }
  }

  /** "Fill all of this colour" on `layer` at a board point (one undo step). */
  private fillAll(layer: string, x: number, y: number): boolean {
    const tolerance = this.board.pixelArt ? 0 : this.state.fill.tolerance;
    const box = this.painter.recolorAll(this.frameId, layer, x, y, tolerance, this.rgb());
    if (!box) {
      this.em.emit('toast', { message: 'Tap a colour to change all of it', kind: 'fill' });
      return false;
    }
    const params = defaultFillParams(this.state.fill.gaps, this.board.W, this.board.H, this.board.pixelArt);
    this.record('Fill', this.takePending(), { op: 'fill', layer, frame: this.frameId, x, y, color: this.state.color, tolerance, sample: 'layer', gaps: params.gaps, fallbackGap: params.fallbackGap, all: true }, layer);
    this.comp.flush();
    return true;
  }

  private async computeFill(sample: FillSample, layer: string, x: number, y: number, tolerance: number, params: FillParams, only: string | null = null): Promise<{ result: FillResult | null; analyzeMs: number }> {
    const board = this.board;
    const maxGap = Math.max(...params.gaps, params.fallbackGap);
    if (sample === 'lines') {
      const key = this.painter.linesKey(this.frameId, maxGap, only);
      const send = async (withWalls: boolean): Promise<WorkerResponse> => {
        const walls = withWalls ? this.painter.linesWalls(this.frameId, only) : undefined;
        const res = await this.worker.call({ type: 'fillLines', key, x, y, params, walls, W: board.W, H: board.H, maxGap }, walls ? [walls.buffer as ArrayBuffer] : []);
        this.worker.known.add(key);
        return res;
      };
      let res: WorkerResponse;
      try {
        res = await send(!this.worker.known.has(key));
      } catch {
        this.worker.known.delete(key);
        res = await send(true);
      }
      const r = res as Extract<WorkerResponse, { type: 'fill' }>;
      return { result: r.result, analyzeMs: r.analyzeMs };
    }
    const rgba = this.painter.composite(this.frameId, sample === 'layer' ? layer : undefined);
    const res = (await this.worker.call({ type: 'fillColor', rgba, W: board.W, H: board.H, x, y, tolerance: board.pixelArt ? 0 : tolerance, nudge: !board.pixelArt, params }, [rgba.buffer as ArrayBuffer])) as Extract<WorkerResponse, { type: 'fill' }>;
    return { result: res.result, analyzeMs: res.analyzeMs };
  }

  /**
   * Precomputes the lines analysis in the worker ~300 ms after the lines change, so a tap only pays for its
   * region: the active part's own lines when drawing on the bones, every lines layer otherwise.
   */
  private scheduleLinesAnalysis(): void {
    clearTimeout(this.linesTimer);
    this.linesTimer = window.setTimeout(() => {
      if (!this.b || this.destroyed || !this.worker.threaded) return;
      const only = this.painter.fillPlan(this.frameId, this.layerId)?.lines ?? null;
      if (!this.painter.hasVisibleLines(this.frameId, only)) return;
      const p = defaultFillParams(this.state.fill.gaps, this.board.W, this.board.H, this.board.pixelArt);
      const maxGap = Math.max(...p.gaps, p.fallbackGap);
      const key = this.painter.linesKey(this.frameId, maxGap, only);
      if (this.worker.known.has(key)) return;
      const walls = this.painter.linesWalls(this.frameId, only);
      this.worker.known.add(key);
      this.worker.call({ type: 'analyze', key, W: this.board.W, H: this.board.H, maxGap, walls }, [walls.buffer as ArrayBuffer]).catch(() => this.worker.known.delete(key));
    }, 300);
  }

  /**
   * The "pour": the fill (already in the pixels) is revealed on screen from the tap outward over ~120 ms.
   * It never blocks input: anything that starts drawing finishes it at once. Skipped with reduced motion.
   */
  private startPour(layer: string, b: Rect, x: number, y: number): void {
    this.finishPour();
    const done = (): void => {
      if (this.pouring !== job) return;
      this.pouring = null;
      if (this.destroyed) return;
      this.comp.layerChanged(layer, b);
      this.comp.invalidateDoc(b);
      this.comp.flush();
      this.checkSettled();
    };
    const job = { finish: done };
    this.pouring = job;
    const w = b.x1 - b.x0;
    const h = b.y1 - b.y0;
    const data = this.board.pixels(this.frameId, layer);
    const stage = this.reducedMotion || !data ? null : new OffscreenCanvas(w, h);
    const sctx = stage?.getContext('2d');
    if (!stage || !sctx || !data) {
      done();
      return;
    }
    const img = sctx.createImageData(w, h);
    for (let yy = 0; yy < h; yy++) img.data.set(data.subarray(((b.y0 + yy) * this.board.W + b.x0) * 4, ((b.y0 + yy) * this.board.W + b.x1) * 4), yy * w * 4);
    sctx.putImageData(img, 0, 0);
    const rMax = Math.max(Math.hypot(x - b.x0, y - b.y0), Math.hypot(x - b.x1, y - b.y0), Math.hypot(x - b.x0, y - b.y1), Math.hypot(x - b.x1, y - b.y1));
    const t0 = performance.now();
    const step = (): void => {
      if (this.pouring !== job || this.destroyed) return;
      const t = Math.min(1, (performance.now() - t0) / POUR_MS);
      if (t >= 1) {
        done();
        return;
      }
      const r = rMax * (1 - (1 - t) * (1 - t));
      this.comp.paintLayer(layer, b, (ctx) => {
        ctx.beginPath();
        ctx.rect(b.x0, b.y0, w, h);
        ctx.clip();
        ctx.beginPath();
        ctx.arc(x, y, Math.max(0.5, r), 0, Math.PI * 2);
        ctx.clip();
        ctx.globalCompositeOperation = 'copy';
        ctx.drawImage(stage, b.x0, b.y0);
      });
      this.comp.flush();
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  private finishPour(): void {
    this.pouring?.finish();
  }

  private settledWaiters: Array<() => void> = [];

  /** Resolves when no fill is being worked out and the screen shows the final pixels (tests, exports). */
  settled(): Promise<void> {
    return new Promise((resolve) => {
      this.settledWaiters.push(resolve);
      this.checkSettled();
    });
  }

  private checkSettled(): void {
    if (this.busy || this.pouring || this.queued.length) return;
    const w = this.settledWaiters;
    this.settledWaiters = [];
    for (const f of w) f();
  }

  pickColor(x: number, y: number): string {
    const board = this.board;
    const px = Math.max(0, Math.min(board.W - 1, Math.floor(x)));
    const py = Math.max(0, Math.min(board.H - 1, Math.floor(y)));
    let [r, g, b] = this.comp.paperRgb();
    for (const l of board.layers) {
      if (!l.visible) continue;
      const d = board.pixels(this.frameId, l.id);
      if (!d) continue;
      const j = (py * board.W + px) * 4;
      const a = (d[j + 3] / 255) * l.opacity;
      if (a <= 0) continue;
      const [sr, sg, sb] = l.blend === 'multiply' ? [(d[j] * r) / 255, (d[j + 1] * g) / 255, (d[j + 2] * b) / 255] : [d[j], d[j + 1], d[j + 2]];
      r = sr * a + r * (1 - a);
      g = sg * a + g * (1 - a);
      b = sb * a + b * (1 - a);
    }
    return toHex([r, g, b]);
  }

  // ------------------------------------------------------------------------------------------ tools

  toolState(): ToolState {
    return structuredClone(this.state);
  }

  private emitTool(): void {
    this.em.emit('tool', this.toolState());
  }

  setTool(tool: ToolId): void {
    if (tool === this.state.tool) return;
    if (this.b && this.sel.active && tool !== 'lasso' && tool !== 'select') this.sel.commit();
    if (this.b) {
      this.input.endTapInk(null);
      this.shapes.end();
    }
    this.state.tool = tool;
    this.emitTool();
  }

  setShape(o: Partial<ToolState['shape']>): void {
    this.state.shape = { kind: o.kind ?? this.state.shape.kind, filled: o.filled ?? this.state.shape.filled };
    if (this.b) this.shapes.setState(this.state.shape);
    this.emitTool();
  }

  setTapToInk(on: boolean): void {
    this.state.tapToInk = on;
    if (this.b) {
      this.input.tapToInk = on;
      if (!on) this.input.endTapInk(null);
    }
    this.emitTool();
  }

  /**
   * Draws a shape with the current colour and Ink size (keyboard shapes, scripted drawing): an outline on the
   * active layer, or a filled shape on the fill layer (under the lines). One undo step.
   */
  drawShape(o: { shape: LogShape['shape']; points: Array<[number, number]>; filled?: boolean }): boolean {
    const filled = !!o.filled && o.shape !== 'line';
    const layer = filled ? this.fillTarget()?.layer : this.editableLayer();
    if (!layer) return false;
    const b = this.state.brushes.ink;
    const op: LogShape = {
      op: 'shape',
      layer: layer.id,
      frame: this.frameId,
      shape: o.shape,
      brush: this.board.pixelArt ? 'pixel' : 'ink',
      size: this.board.pixelArt ? this.state.brushes.pixel.size : b.size,
      color: this.state.color,
      opacity: b.opacity,
      points: o.points.map(([x, y]) => [x, y]),
      filled,
      mirror: this.symmetry(),
      ...(filled ? { outline: false } : {}),
    };
    const box = this.painter.paintShape(op);
    if (isEmpty(box)) return false;
    this.record(filled ? 'Filled shape' : 'Shape', this.takePending(), op, op.layer);
    this.comp.flush();
    return true;
  }

  /**
   * Copies layers onto other layers through a board transform, replacing them (one undo step): "Copy it to
   * the other side" mirrors a body part's colours and lines onto the opposite part's pair.
   */
  copyLayers(pairs: Array<[string, string]>, matrix: [number, number, number, number, number, number]): boolean {
    const b = this.board;
    const ok = pairs.filter(([from, to]) => b.layer(from) && b.layer(to) && from !== to);
    if (!ok.length) return false;
    if (this.sel.active) this.sel.commit();
    // Undo keeps the tiles each copy can touch: what the target held and where the copy lands.
    const steps: Step[] = [];
    for (const [from, to] of ok) {
      const r = emptyRect();
      const old = b.pixels(this.frameId, to);
      const had = old ? alphaBounds(old, b.W, b.H) : null;
      if (had) unionInto(r, had);
      const src = b.pixels(this.frameId, from);
      const box = src ? alphaBounds(src, b.W, b.H) : null;
      if (box)
        for (const [x, y] of [
          [box.x0, box.y0],
          [box.x1, box.y0],
          [box.x0, box.y1],
          [box.x1, box.y1],
        ]) {
          const q = applyAffine(matrix, x, y);
          unionInto(r, { x0: Math.floor(q.x) - 2, y0: Math.floor(q.y) - 2, x1: Math.ceil(q.x) + 2, y1: Math.ceil(q.y) + 2 });
        }
      const clip: Rect = { x0: Math.max(0, r.x0), y0: Math.max(0, r.y0), x1: Math.min(b.W, r.x1), y1: Math.min(b.H, r.y1) };
      if (!isEmpty(clip)) steps.push({ pixels: this.hist.snapshot(this.frameId, to, tilesOf(clip, b.W, b.H)) });
    }
    let any = false;
    for (const [from, to] of ok) if (copyLayer(b, this.frameId, from, to, matrix)) any = true;
    if (!any) return false;
    this.record('Copy to the other side', steps, { op: 'copy', frame: this.frameId, pairs: ok.map(([f, t]) => [f, t]), matrix }, ok[0][1]);
    this.comp.flush();
    return true;
  }

  setBrush(patch: Partial<BrushSettings>, brush?: BrushId): void {
    const id = brush ?? ((BRUSH_IDS as readonly string[]).includes(this.state.tool) ? (this.state.tool as BrushId) : 'ink');
    const cur = this.state.brushes[id];
    const next = { ...cur, ...patch };
    const b = brushFor(id, { size: next.size, opacity: next.opacity });
    this.state.brushes[id] = { size: b.size, opacity: b.opacity, steady: next.steady === null ? null : Math.max(0, Math.min(1, next.steady)), soft: !!next.soft };
    this.emitTool();
  }

  setColor(color: string): void {
    if (!isColor(color)) return;
    this.state.color = normalizeColor(color);
    this.emitTool();
  }

  setMirror(m: { x?: boolean | number | null; y?: boolean | number | null } | null): void {
    const axis = (v: boolean | number | null | undefined, size: number, cur: number | null): number | null => (v === undefined ? cur : v === true ? size / 2 : typeof v === 'number' && Number.isFinite(v) ? v : null);
    this.state.mirror = m ? { x: axis(m.x, this.board.W, this.state.mirror.x), y: axis(m.y, this.board.H, this.state.mirror.y) } : { x: null, y: null };
    this.comp.overlays.symmetry = this.symmetry();
    this.comp.renderAll();
    this.emitTool();
  }

  setHoldToPerfect(on: boolean): void {
    this.state.holdToPerfect = on;
    this.emitTool();
  }

  setFill(o: Partial<ToolState['fill']>): void {
    this.state.fill = { gaps: o.gaps ?? this.state.fill.gaps, tolerance: Math.max(0, Math.min(255, o.tolerance ?? this.state.fill.tolerance)), all: o.all ?? this.state.fill.all };
    this.emitTool();
  }

  setSelect(o: Partial<ToolState['select']>): void {
    this.state.select = { scope: o.scope === 'layer' ? 'layer' : o.scope === 'drawing' ? 'drawing' : this.state.select.scope };
    this.emitTool();
  }

  setPressure(o: Partial<ToolState['pressure']>): void {
    this.state.pressure = { ...this.state.pressure, ...o };
    this.calibrator.feel = this.state.pressure.feel;
    this.calibrator.enabled = this.state.pressure.calibrate;
    this.emitTool();
  }

  // ------------------------------------------------------------------------------------------ undo

  historyState(): HistoryState {
    const l = this.hist.labels();
    return { canUndo: this.hist.canUndo, canRedo: this.hist.canRedo, undoLabel: l.undo, redoLabel: l.redo, bytes: this.hist.bytes };
  }

  async undo(): Promise<boolean> {
    if (this.busy) return new Promise((resolve) => this.queued.push(() => void this.undo().then(resolve)));
    if (!this.b || this.stroke) return false;
    // The shape being edited is the step an undo takes back: it stops being editable.
    this.shapes.end();
    return this.undoStep();
  }

  /** One undo step (the Shapes tool uses this to take a shape back while its handles move). */
  private async undoStep(): Promise<boolean> {
    if (this.busy) return new Promise((resolve) => this.queued.push(() => void this.undoStep().then(resolve)));
    if (!this.b || this.stroke) return false;
    this.finishPour();
    if (this.sel.floating) {
      this.sel.cancel();
      return true;
    }
    return this.stepHistory('undo');
  }

  async redo(): Promise<boolean> {
    if (this.busy) return new Promise((resolve) => this.queued.push(() => void this.redo().then(resolve)));
    if (!this.b || this.stroke) return false;
    this.finishPour();
    return this.stepHistory('redo');
  }

  /**
   * One undo or redo, with input held meanwhile. The step can wait on the worker (old steps are packed there,
   * tile by tile), and a stroke begun during that wait would be committed before the undo landed and then
   * painted over by it. So, as during a fill, input is queued and replayed in order once the step is done and
   * logged. A step that cannot run (the worker failed) changes nothing and is reported, never thrown.
   */
  private async stepHistory(which: 'undo' | 'redo'): Promise<boolean> {
    this.busy = true;
    try {
      const e = await (which === 'undo' ? this.hist.undo() : this.hist.redo());
      if (!e) return false;
      if (this.recording) this.ops.push({ op: which });
      if (which === 'undo') this.lastStroke = null;
      this.afterHistory();
      return true;
    } catch (err) {
      this.em.emit('error', { message: err instanceof Error ? err.message : String(err) });
      return false;
    } finally {
      this.busy = false;
      const q = this.queued;
      this.queued = [];
      for (const f of q) f();
      this.checkSettled();
    }
  }

  private afterHistory(): void {
    this.comp.flush();
    this.markDirty();
    this.em.emit('history', this.historyState());
    this.em.emit('commit', { op: 'undo', label: 'Undo', layer: null, frame: this.frameId });
  }

  // ------------------------------------------------------------------------------------------ layers

  layers(): LayerInfo[] {
    const b = this.board;
    return b.layers.map((l) => ({
      id: l.id,
      name: l.name,
      role: l.role,
      visible: l.visible,
      locked: l.locked,
      opacity: l.opacity,
      blend: l.blend,
      alphaLock: l.alphaLock,
      exported: EXPORTED_ROLES(l.role),
      active: l.id === this.layerId,
      empty: !b.hasCel(this.frameId, l.id),
    }));
  }

  activeLayer(): string {
    return this.layerId;
  }

  setActiveLayer(id: string): void {
    if (!this.board.layer(id) || id === this.layerId) return;
    if (this.sel.active) this.sel.commit();
    this.layerId = id;
    this.comp.setActive(id);
    this.em.emit('layers', this.layers());
    // A body part fills against its own lines: warm that analysis up for the new part.
    this.scheduleLinesAnalysis();
  }

  private layerOp(label: string, step: ReturnType<typeof addLayer> | null, op: Extract<LogOp, { op: 'layer' }>): void {
    if (!step) return;
    this.record(label, [{ struct: step }], op, op.id);
  }

  addLayer(role: LayerRole, o: { name?: string; index?: number; blend?: ArtLayer['blend']; id?: string } = {}): string | null {
    const b = this.board;
    const limit = isPartRole(role) ? LIMITS.maxLayersWithParts : b.maxLayers();
    if (b.layers.length >= limit) {
      this.em.emit('toast', { message: 'That is a lot of layers! Merge some to add more.', kind: 'limit' });
      return null;
    }
    const layer = makeLayer(o.id && !b.layer(o.id) ? o.id : uid('l'), role, o.name);
    if (o.blend) layer.blend = o.blend;
    const index = o.index ?? b.layerIndex(this.layerId) + 1;
    this.layerOp('Add layer', addLayer(b, layer, index), { op: 'layer', action: 'add', id: layer.id, layer: { ...layer }, index });
    this.setActiveLayer(layer.id);
    return layer.id;
  }

  removeLayer(id: string): void {
    if (this.board.layers.length <= 1) return;
    if (this.sel.active) this.sel.commit();
    this.layerOp('Delete layer', removeLayer(this.board, id), { op: 'layer', action: 'remove', id });
  }

  moveLayer(id: string, index: number): void {
    this.layerOp('Move layer', moveLayer(this.board, id, index), { op: 'layer', action: 'move', id, index });
  }

  duplicateLayer(id: string): string | null {
    const b = this.board;
    const src = b.layer(id);
    if (!src || b.layers.length >= b.maxLayers()) return null;
    const copy: ArtLayer = { ...src, id: uid('l'), name: `${src.name} copy` };
    const index = b.layerIndex(id) + 1;
    this.layerOp('Duplicate layer', duplicateLayer(b, id, copy, index), { op: 'layer', action: 'duplicate', id: copy.id, layer: { ...copy }, index, source: id });
    this.setActiveLayer(copy.id);
    return copy.id;
  }

  async mergeDown(id: string): Promise<void> {
    if (this.sel.active) this.sel.commit();
    const steps = await mergeDown(this.board, id, this.snapshotter());
    if (steps) this.record('Merge down', steps, { op: 'layer', action: 'merge', id }, id);
  }

  setLayer(id: string, patch: Partial<Pick<LayerInfo, 'name' | 'visible' | 'locked' | 'opacity' | 'blend' | 'alphaLock'>>): void {
    const clean: Partial<Omit<ArtLayer, 'id'>> = {};
    if (patch.name !== undefined) clean.name = String(patch.name).slice(0, 40);
    if (patch.visible !== undefined) clean.visible = !!patch.visible;
    if (patch.locked !== undefined) clean.locked = !!patch.locked;
    if (patch.opacity !== undefined) clean.opacity = Math.max(0, Math.min(1, patch.opacity));
    if (patch.blend !== undefined) clean.blend = patch.blend === 'multiply' ? 'multiply' : 'normal';
    if (patch.alphaLock !== undefined) clean.alphaLock = !!patch.alphaLock;
    const step = setLayer(this.board, id, clean);
    if (!step) return;
    const merge = Object.keys(clean).length === 1 && clean.opacity !== undefined ? `opacity:${id}` : undefined;
    // A slider drag is one step, in the history and in the log alike: the log's last op can take the new
    // value only when it is this layer's opacity, and it does exactly when the history joins the two steps
    // (which it does only within 1.5 s), or the log's undo marks would take back the wrong thing.
    const last = this.recording ? this.ops[this.ops.length - 1] : undefined;
    const logTop = merge && last?.op === 'layer' && last.action === 'set' && last.id === id && last.patch && Object.keys(last.patch).length === 1 && last.patch.opacity !== undefined ? last : null;
    const prev = this.hist.undoStack[this.hist.undoStack.length - 1];
    const entry = this.hist.push({ label: 'Layer change', steps: [{ struct: step }], merge }, { merge: !this.recording || logTop !== null });
    if (this.recording) {
      if (logTop && entry === prev) logTop.patch = { opacity: clean.opacity };
      else this.ops.push({ op: 'layer', action: 'set', id, patch: clean });
    }
    this.markDirty();
    this.em.emit('history', this.historyState());
    this.em.emit('commit', { op: 'layer', label: 'Layer change', layer: id, frame: this.frameId });
  }

  async clearLayer(id?: string, allFrames = false): Promise<void> {
    const lid = id ?? this.layerId;
    if (this.sel.active) this.sel.commit();
    const steps = await clearLayer(this.board, lid, allFrames ? null : this.frameId, this.snapshotter());
    if (steps.length) this.record('Clear layer', steps, { op: 'layer', action: 'clear', id: lid, ...(allFrames ? {} : { frame: this.frameId }) }, lid);
  }

  async importTrace(image: ImageBitmap | HTMLImageElement | HTMLCanvasElement | OffscreenCanvas | Blob, o: { role?: 'trace' | 'lines'; name?: string } = {}): Promise<string | null> {
    const b = this.board;
    if (b.layers.length >= b.maxLayers()) {
      this.em.emit('toast', { message: 'That is a lot of layers! Merge some to add more.', kind: 'limit' });
      return null;
    }
    const src = image instanceof Blob ? await createImageBitmap(image) : image;
    const sw = 'naturalWidth' in src ? src.naturalWidth : src.width;
    const sh = 'naturalHeight' in src ? src.naturalHeight : src.height;
    if (!sw || !sh) return null;
    // Fit the photo inside the board, centred.
    const k = Math.min(b.W / sw, b.H / sh);
    const w = Math.round(sw * k);
    const h = Math.round(sh * k);
    const c = new OffscreenCanvas(b.W, b.H);
    const ctx = c.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(src, Math.round((b.W - w) / 2), Math.round((b.H - h) / 2), w, h);
    const photo = new Uint8ClampedArray(ctx.getImageData(0, 0, b.W, b.H).data);
    // A photo to trace goes at the bottom; a photo's lines (paper removed on the device) go on top.
    const lines = o.role === 'lines';
    const layer = makeLayer(uid('l'), lines ? 'lines' : 'trace', o.name ?? (lines ? 'Photo lines' : 'Photo to trace'));
    const frame = this.frameId;
    const index = lines ? b.layers.length : 0;
    const add = addLayer(b, layer, index);
    const put = (): void => {
      b.setPixels(frame, layer.id, photo.slice());
      b.changed(frame, layer.id, null);
    };
    put();
    // One undo step: the layer and its photo come and go together.
    const step = {
      undo: add.undo,
      redo: () => {
        add.redo();
        put();
      },
      bytes: photo.length,
    };
    this.record('Add photo', [{ struct: step }], { op: 'trace', layer: { ...layer }, index }, layer.id);
    if (lines) this.setActiveLayer(layer.id);
    return layer.id;
  }

  // ------------------------------------------------------------------------------------------ frames

  frames(): FrameInfo[] {
    return this.board.frames.map((f, index) => ({ id: f.id, hold: f.hold, index, active: f.id === this.frameId }));
  }

  activeFrame(): string {
    return this.frameId;
  }

  async setActiveFrame(id: string): Promise<void> {
    const b = this.board;
    if (b.frameIndex(id) < 0 || id === this.frameId) return;
    if (this.sel.active) this.sel.commit();
    await b.ensureFrame(id);
    this.frameId = id;
    this.comp.setFrame(id);
    this.comp.markOnionStale();
    await this.comp.refreshOnion();
    this.scheduleLinesAnalysis();
    this.em.emit('frames', this.frames());
    this.em.emit('layers', this.layers());
    this.em.emit('change', { reason: 'frames' });
    this.scheduleIdle();
  }

  async addFrame(o: { after?: string; copy?: boolean } = {}): Promise<string | null> {
    const b = this.board;
    if (b.frames.length >= LIMITS.maxFrames) {
      this.em.emit('toast', { message: `A flipbook can have ${LIMITS.maxFrames} pages`, kind: 'limit' });
      return null;
    }
    const after = o.after ?? this.frameId;
    await b.ensureFrame(after);
    const frame = { id: uid('f'), hold: 1 };
    const index = b.frameIndex(after) + 1;
    const copyOf = o.copy ? after : null;
    const step = addFrame(b, frame, index, copyOf);
    this.record(o.copy ? 'Duplicate page' : 'Add page', [{ struct: step }], { op: 'frame', action: 'add', id: frame.id, index, copyOf, hold: 1 }, null);
    await this.setActiveFrame(frame.id);
    return frame.id;
  }

  removeFrame(id: string): void {
    const step = removeFrame(this.board, id);
    if (step) this.record('Delete page', [{ struct: step }], { op: 'frame', action: 'remove', id }, null);
  }

  moveFrame(id: string, index: number): void {
    const step = moveFrame(this.board, id, index);
    if (step) this.record('Move page', [{ struct: step }], { op: 'frame', action: 'move', id, index }, null);
  }

  setFrameHold(id: string, hold: number): void {
    const step = setFrameHold(this.board, id, hold);
    if (step) this.record('Page timing', [{ struct: step }], { op: 'frame', action: 'hold', id, hold: this.board.frames.find((f) => f.id === id)?.hold ?? 1 }, null);
  }

  setOnion(o: { enabled?: boolean; range?: number }): void {
    this.comp.setOnion(o.enabled ?? this.comp.onionEnabled, o.range ?? this.comp.onionSpan);
    if (!this.comp.onionEnabled) {
      this.comp.rebuildCaches(null);
      this.comp.renderAll();
    } else void this.comp.refreshOnion();
  }

  playFrames(fps: number, onFrame?: (index: number) => void): Promise<() => void> {
    if (this.sel.active) this.sel.commit();
    return this.comp.play(fps, onFrame);
  }

  private flatOrLayer(layer: string | null, frame: string): Uint8ClampedArray | null {
    const b = this.board;
    if (layer === null) return flatten(b, frame);
    return b.pixels(frame, layer);
  }

  async thumbnail(layer: string | null, maxSize: number, frame?: string): Promise<ImageBitmap> {
    const b = this.board;
    const f = frame ?? this.frameId;
    await b.ensureFrame(f);
    const src = this.flatOrLayer(layer, f) ?? new Uint8ClampedArray(b.W * b.H * 4);
    const k = Math.min(1, maxSize / Math.max(b.W, b.H));
    const w = Math.max(1, Math.round(b.W * k));
    const h = Math.max(1, Math.round(b.H * k));
    const px = k === 1 ? src.slice() : resize(src, b.W, b.H, w, h);
    return createImageBitmap(new ImageData(px as Uint8ClampedArray<ArrayBuffer>, w, h));
  }

  readPixels(layer: string | null, x: number, y: number, w: number, h: number, frame?: string): Uint8ClampedArray {
    const b = this.board;
    const src = this.flatOrLayer(layer, frame ?? this.frameId);
    const out = new Uint8ClampedArray(Math.max(0, w) * Math.max(0, h) * 4);
    if (!src) return out;
    for (let yy = 0; yy < h; yy++) {
      const sy = y + yy;
      if (sy < 0 || sy >= b.H) continue;
      for (let xx = 0; xx < w; xx++) {
        const sx = x + xx;
        if (sx < 0 || sx >= b.W) continue;
        out.set(src.subarray((sy * b.W + sx) * 4, (sy * b.W + sx) * 4 + 4), (yy * w + xx) * 4);
      }
    }
    return out;
  }

  // ------------------------------------------------------------------------------------------ view

  view(): ViewState & { cssW: number; cssH: number } {
    return { ...this.comp.view, cssW: this.comp.cssW, cssH: this.comp.cssH };
  }

  setView(v: Partial<ViewState>): void {
    const cur = this.comp.view;
    this.comp.view = { zoom: clampZoom(v.zoom ?? cur.zoom), rot: v.rot ?? cur.rot, panX: v.panX ?? cur.panX, panY: v.panY ?? cur.panY };
    this.comp.renderAll();
    this.em.emit('view', this.comp.view);
  }

  fit(): void {
    this.comp.measure();
    this.comp.view = fitView(this.board.W, this.board.H, this.comp.cssW, this.comp.cssH);
    this.comp.renderAll();
    this.em.emit('view', this.comp.view);
  }

  zoomTo(zoom: number, at?: { x: number; y: number }): void {
    const v = this.comp.view;
    const c = at ? docToView(v, at.x, at.y) : { x: this.comp.cssW / 2, y: this.comp.cssH / 2 };
    this.comp.view = zoomAt(v, clampZoom(zoom) / v.zoom, c.x, c.y);
    this.comp.renderAll();
    this.em.emit('view', this.comp.view);
  }

  setRotation(radians: number): void {
    const v = this.comp.view;
    const cx = this.comp.cssW / 2;
    const cy = this.comp.cssH / 2;
    const d = viewToDoc(v, cx, cy);
    const rot = snapRotation(radians);
    const next = { ...v, rot };
    const p = docToView(next, d.x, d.y);
    this.comp.view = { ...next, panX: next.panX + cx - p.x, panY: next.panY + cy - p.y };
    this.comp.renderAll();
    this.em.emit('view', this.comp.view);
  }

  docToClient(x: number, y: number): { x: number; y: number } {
    const r = this.host.getBoundingClientRect();
    const p = docToView(this.comp.view, x, y);
    return { x: p.x + r.left, y: p.y + r.top };
  }

  clientToDoc(x: number, y: number): { x: number; y: number } {
    const r = this.host.getBoundingClientRect();
    return viewToDoc(this.comp.view, x - r.left, y - r.top);
  }

  // ------------------------------------------------------------------------------------------ selection

  selection(): SelectionInfo | null {
    return this.sel.info();
  }

  selectAll(): void {
    this.sel.selectAll();
  }

  transformSelection(patch: Partial<SelectionTransform>): void {
    this.sel.transform(patch);
  }

  flipSelection(axis: 'h' | 'v'): void {
    this.sel.flip(axis);
  }

  commitSelection(): void {
    this.sel.commit();
    this.comp.flush();
  }

  cancelSelection(): void {
    this.sel.cancel();
    this.comp.flush();
  }

  deleteSelection(): void {
    this.sel.remove();
    this.comp.flush();
  }

  selectionToPart(name: string): string | null {
    const id = this.sel.toPart(name);
    this.comp.flush();
    return id;
  }

  // ------------------------------------------------------------------------------------------ guide and anchor

  setGuide(g: Guide | null): void {
    this.guide = g;
    this.comp.setGuide(g, this.anchor());
    this.em.emit('change', { reason: 'guide' });
  }

  setAnchor(a: [number, number] | null): void {
    this.meta.anchor = a ? [a[0], a[1]] : null;
    this.comp.setAnchor(this.anchor());
    this.markDirty();
    this.em.emit('change', { reason: 'anchor' });
  }

  anchor(): [number, number] | null {
    if (this.meta.anchor) return [this.meta.anchor[0], this.meta.anchor[1]];
    const b = this.board;
    const flat = flatten(b, this.frameId);
    const box = this.meta.kind === 'background' ? { x0: 0, y0: 0, x1: b.W, y1: b.H } : trimBox(flat, b.W, b.H);
    if (!box) return this.guide?.groundY !== undefined && this.guide?.groundY !== null ? [b.W / 2, this.guide.groundY] : null;
    return autoAnchor(this.meta.kind, flat, b.W, box);
  }

  // ------------------------------------------------------------------------------------------ saving and export

  /** Copies of the cels (for the worker; their buffers are transferred). */
  private copyBoard(frames: 'all' | string): { copy: BoardCopy; transfer: ArrayBuffer[] } {
    const b = this.board;
    const cels: BoardCopy['cels'] = [];
    for (const [frame, layer, cel] of b.entries()) {
      if (frames !== 'all' && frame !== frames) continue;
      if (cel.data) cels.push({ frame, layer, data: cel.data.slice() });
    }
    return {
      copy: { W: b.W, H: b.H, pixelArt: b.pixelArt, layers: b.layers.map((l) => ({ ...l })), frames: b.frames.map((f) => ({ ...f })), cels },
      transfer: cels.map((c) => c.data.buffer as ArrayBuffer),
    };
  }

  async toArtDoc(): Promise<ArtDoc> {
    if (this.sel.active) this.sel.commit();
    const b = this.board;
    for (const f of b.frames) await b.ensureFrame(f.id);
    const encode = async (board: Board, frame: string, layer: string): Promise<import('./model').ArtCel | null> => {
      const d = board.pixels(frame, layer);
      if (!d) return null;
      const copy = d.slice();
      const res = (await this.worker.call({ type: 'encodeCel', W: board.W, H: board.H, frame, layer, data: copy }, [copy.buffer as ArrayBuffer])) as Extract<WorkerResponse, { type: 'encodeCel' }>;
      return res.cel;
    };
    this.meta.version++;
    return boardToArtDoc(b, this.meta, this.recording || this.ops.length ? this.ops : null, this.celCache, encode);
  }

  isDirty(): boolean {
    return this.dirty;
  }

  markSaved(): void {
    if (!this.dirty) return;
    this.dirty = false;
    this.em.emit('dirty', false);
  }

  async export(o: ExportOptions = {}): Promise<ArtExport | null> {
    if (this.sel.active) this.sel.commit();
    const frame = o.frame ?? this.board.frames[0].id;
    await this.board.ensureFrame(frame);
    const { copy, transfer } = this.copyBoard(frame);
    const res = (await this.worker.call({ type: 'export', board: copy, opts: { kind: this.meta.kind, anchor: this.meta.anchor, ...o, frame } }, transfer)) as Extract<WorkerResponse, { type: 'export' }>;
    return res.result;
  }

  async exportFrames(o: { scale?: number } = {}): Promise<{ box: [number, number, number, number]; scale: number; frames: FrameExport[] } | null> {
    if (this.sel.active) this.sel.commit();
    for (const f of this.board.frames) await this.board.ensureFrame(f.id);
    return exportFrames(this.board, o);
  }

  log(): readonly LogOp[] {
    return this.ops;
  }

  // ------------------------------------------------------------------------------------------ keyboard

  private key(e: KeyboardEvent): boolean {
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    if (mod && k === 'z') {
      void (e.shiftKey ? this.redo() : this.undo());
      return true;
    }
    if (mod && k === 'y') {
      void this.redo();
      return true;
    }
    if (this.state.tool === 'shape' && !mod && this.shapes.key(e)) return true;
    if (this.sel.floating) {
      if (e.key === 'Enter') return this.commitSelection(), true;
      if (e.key === 'Escape') return this.cancelSelection(), true;
      if (e.key === 'Delete' || e.key === 'Backspace') return this.deleteSelection(), true;
      const step = e.shiftKey ? 10 : 1;
      const info = this.sel.info();
      if (info && e.key.startsWith('Arrow')) {
        const t = info.transform;
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
        this.transformSelection({ tx: t.tx + dx, ty: t.ty + dy });
        return true;
      }
    }
    if (mod || e.altKey || this.o.keyboard === false) return false;
    const tools: Record<string, ToolId> = { b: 'ink', p: 'pencil', m: 'marker', c: 'crayon', a: 'airbrush', e: 'eraser', g: 'fill', i: 'eyedropper', l: 'lasso', v: 'select', h: 'pan', u: 'shape' };
    if (tools[k]) {
      this.setTool(this.board.pixelArt && k === 'b' ? 'pixel' : tools[k]);
      return true;
    }
    if (k === '[' || k === ']') {
      const id = (BRUSH_IDS as readonly string[]).includes(this.state.tool) ? (this.state.tool as BrushId) : 'ink';
      const size = this.state.brushes[id].size;
      this.setBrush({ size: id === 'pixel' ? size + (k === ']' ? 1 : -1) : size * (k === ']' ? 1.2 : 1 / 1.2) }, id);
      return true;
    }
    if (k === '0') return this.fit(), true;
    if (k === '1') return this.zoomTo(1), true;
    if (k === ',' || k === '.') {
      const i = this.board.frameIndex(this.frameId) + (k === ',' ? -1 : 1);
      const f = this.board.frames[i];
      if (f) void this.setActiveFrame(f.id);
      return true;
    }
    return false;
  }

  // ------------------------------------------------------------------------------------------ stats and teardown

  stats(): PerfStats {
    return {
      latency: this.st.latency.summary(),
      work: this.st.work.summary(),
      commit: this.st.commit.summary(),
      parts: { raster: this.st.raster.summary(), blend: this.st.blend.summary(), upload: this.st.upload.summary(), composite: this.st.composite.summary() },
      fills: this.st.fills.slice(),
      history: { steps: this.hist.undoStack.length, bytes: this.hist.bytes },
      pixels: this.board.residentBytes(),
      desynchronized: this.comp.desynchronized,
      rawUpdates: 'onpointerrawupdate' in window,
      worker: this.worker.threaded,
      renderCost: Math.round(this.input.renderCost * 100) / 100,
    };
  }

  /** Clears the perf samples (tests measure one scenario at a time). */
  resetStats(): void {
    for (const r of [this.st.latency, this.st.work, this.st.commit, this.st.raster, this.st.blend, this.st.upload, this.st.composite]) r.clear();
    this.st.fills = [];
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    clearTimeout(this.linesTimer);
    clearTimeout(this.idleTimer);
    if (this.stroke?.holdTimer) clearInterval(this.stroke.holdTimer);
    this.resizeObs?.disconnect();
    if (this.b) {
      this.input.destroy();
      this.comp.destroy();
    }
    this.em.clear();
  }
}

/**
 * Mounts a drawing surface in `host` (it fills the host; give the host a size). `doc` null starts a new
 * drawing from the options.
 */
export function createArtSurface(host: HTMLElement, doc: ArtDoc | null, opts: ArtSurfaceOptions = {}): ArtSurface {
  return new Surface(host, doc, opts);
}

export type { StrokeSpec };
export { emptyRect, toPixels, unionInto };
