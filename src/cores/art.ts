/**
 * The art engine as the app sees it (§8.2): the drawing model, the drawing surface, export, headless
 * ArtScript replay and the time-lapse. Framework-free; the Desk (M3), the First page (M1) and the starter
 * tools (M8) use it. Modules import art APIs only from here.
 *
 * Over `src/art/engine` (the art core). Most names are the engine's own; this barrel adds:
 * - `ArtSurface`: the engine's surface plus the spec's names (§8.2) as one-line aliases (`setSize`,
 *   `makePerfect`, `selectLayer`, `canUndo`, `flush`, `doc`, the `penup` and `colour` events...) and
 *   `inked()` (the share of the board with exported ink, counted from `readPixels` after pixel changes).
 * - `newArtDoc` (a blank drawing), and `serializeArtDoc`/`deserializeArtDoc` in the STORAGE form: JSON with
 *   content-addressed cel refs plus the cel blobs (the stroke log split off for the device-only `strokes`
 *   store). The engine's single-file container is `packArtDoc`/`unpackArtDoc`.
 * - `exportArt(doc, { maxSide, scale })` over the engine's `exportArtDoc` (null for an empty drawing).
 * - `playStrokeLog(host, source)`: "Watch it drawn" over the engine's `playTimelapse`, from an ArtDoc, an
 *   ArtScript, a stroke log, or the chunks kept in `Store.strokes`.
 *
 * Not in the engine (M3 builds these in the Desk if it needs them): tap-to-ink, a shapes tool (the engine
 * has hold-to-perfect and `makePerfect`), fill all-of-colour and lasso fill, per-tool layer targets (set
 * the active layer before a tool: fills already land on the colours layer under the lines), a read-only
 * surface (use `playStrokeLog`), streaming stroke-log chunks (the log is in `(await doc()).strokeLog`),
 * and skeleton, facing or dashed-outline guides (draw them into an image and pass it as the guide's
 * `silhouette`).
 */
import {
  createArtSurface as createEngineSurface,
  deserializeArtDoc as unpackArtDocBytes,
  exportArtDoc,
  exportArtDocFrames,
  LIMITS,
  makeLayer,
  playTimelapse,
  replayArtScript as replayScript,
  serializeArtDoc as packArtDocBytes,
  type ArtCel,
  type ArtDoc,
  type ArtExport,
  type ArtKind,
  type ArtLayer,
  type ArtScript,
  type ArtSurface as EngineSurface,
  type ArtSurfaceOptions as EngineSurfaceOptions,
  type BrushId,
  type FrameExport,
  type GapsMode,
  type Guide,
  type LayerRole,
  type LogOp,
  type ReplayOptions,
  type RigKind,
  type SurfaceEvents,
  type Timelapse,
  type TimelapseOptions,
  type ToolId,
} from '../art/engine';
import { blobRefOf } from '../model/ids';
import type { BlobRef } from '../model/types';

/** 'real' since the art core merged. */
export const ART_CORE: 'stub' | 'real' = 'real';

// ------------------------------------------------------------------ the model and the engine's own names

export type {
  ArtCel,
  ArtDoc,
  ArtFrame,
  ArtLayer,
  ArtOp,
  ArtScript,
  BrushSettings,
  FrameExport,
  FrameInfo,
  GapsMode,
  Guide,
  GuideImage,
  GuideItem,
  HistoryState,
  LayerBlendMode,
  LayerExport,
  LayerInfo,
  LayerRole,
  LogOp,
  PerfectKind,
  PerfStats,
  PngImage,
  ReplayOptions,
  ScriptBrush,
  SelectionInfo,
  SelectionTransform,
  SelectScope,
  SurfaceEvents,
  Timelapse,
  TimelapseEvents,
  TimelapseOptions,
  ToastKind,
  ToolId,
  ToolState,
} from '../art/engine';
export type { BrushId } from '../art/engine';
export type { ArtKind as ArtDocKind, RigKind as ArtRigKind, ViewState as ArtView, Guide as ArtGuide, ArtExport as ArtExportResult, ExportOptions as ArtExportOptions } from '../art/engine';
export {
  artDocBytes,
  BRUSH_IDS,
  BRUSHES,
  decodePng,
  effectiveOps,
  encodePng,
  EXPORTED_ROLES,
  fitScale,
  isLayerRole,
  isPartRole,
  LIMITS as ART_LIMITS,
  makeLayer,
  partName,
  readLog,
  scriptToLog,
  STEADY_MAX_PX,
  TOOL_IDS,
  validateArtDoc,
  validateArtScript,
} from '../art/engine';

/** The engine's single-file container (meta, PNG cels and the stroke log in one byte array). */
export const packArtDoc: (doc: ArtDoc) => Promise<Uint8Array> = packArtDocBytes;
export const unpackArtDoc: (bytes: Uint8Array | ArrayBuffer | Blob) => Promise<ArtDoc> = unpackArtDocBytes;

// ------------------------------------------------------------------ a blank drawing

let docCounter = 0;
function docId(): string {
  docCounter = (docCounter + 1) % 1296;
  return 'art' + Date.now().toString(36).slice(-4) + docCounter.toString(36).padStart(2, '0') + Math.floor(Math.random() * 36 ** 6).toString(36).padStart(6, '0');
}

export interface NewArtDocOptions {
  name: string;
  kind: ArtKind;
  rig?: RigKind;
  width: number;
  height: number;
  pixelArt?: boolean;
  /**
   * 'freehand': Sketch (hidden), Colors, Lines, as the engine makes them (the Desk's default).
   * 'dock': Colors and Lines (the First page). Or explicit layers, bottom to top. Pixel art gets one
   * Paint layer unless layers are given.
   */
  layers?: 'freehand' | 'dock' | Array<{ id: string; role: LayerRole; name?: string }>;
  anchor?: [number, number] | null;
}

/** A blank drawing (the top visible exported layer, Lines, is where drawing starts). */
export function newArtDoc(o: NewArtDocOptions): ArtDoc {
  const pixelArt = o.pixelArt ?? false;
  let layers: ArtLayer[];
  if (Array.isArray(o.layers)) layers = o.layers.map((l) => makeLayer(l.id, l.role, l.name));
  else if (pixelArt && o.layers === undefined) layers = [makeLayer('paint', 'paint')];
  else if (o.layers === 'dock') layers = [makeLayer('colors', 'colors'), makeLayer('lines', 'lines')];
  else layers = [{ ...makeLayer('sketch', 'sketch'), visible: false }, makeLayer('colors', 'colors'), makeLayer('lines', 'lines')];
  const now = Date.now();
  return {
    format: 'amble-art',
    v: 1,
    id: docId(),
    name: o.name,
    kind: o.kind,
    ...(o.rig ? { rig: o.rig } : {}),
    width: Math.min(LIMITS.maxBoard, Math.max(1, Math.round(o.width))),
    height: Math.min(LIMITS.maxBoard, Math.max(1, Math.round(o.height))),
    pixelArt,
    layers,
    frames: [{ id: 'f1', hold: 1 }],
    cels: [],
    anchor: o.anchor ?? null,
    palette: [],
    strokeLog: null,
    created: now,
    updated: now,
    version: 1,
  };
}

// ------------------------------------------------------------------ storage form (ArtRecord.doc and .cels)

/** The JSON stored as `ArtRecord.doc`: the ArtDoc without pixels or the stroke log; cels point at blobs. */
export interface ArtDocJson extends Omit<ArtDoc, 'cels' | 'strokeLog'> {
  cels: Array<Omit<ArtCel, 'png'> & { ref: BlobRef }>;
}

export interface SerializedArtDoc {
  json: ArtDocJson;
  /** `json` as an application/json Blob, and its content address (what `ArtRecord.doc` holds). */
  docBlob: Blob;
  docRef: BlobRef;
  /** Every cel PNG with its content address (what `ArtRecord.cels` lists). */
  cels: Array<{ ref: BlobRef; blob: Blob }>;
  /** The stroke log, for the device-only `strokes` store. Never put it in a file or send it. */
  strokeLog: Blob | null;
}

/** Splits an ArtDoc into its JSON (with cel refs) and content-addressed cel blobs (§4.3). */
export async function serializeArtDoc(doc: ArtDoc): Promise<SerializedArtDoc> {
  const cels: Array<{ ref: BlobRef; blob: Blob }> = [];
  const jsonCels: ArtDocJson['cels'] = [];
  for (const c of doc.cels) {
    const ref = await blobRefOf(c.png);
    cels.push({ ref, blob: c.png });
    jsonCels.push({ frame: c.frame, layer: c.layer, x: c.x, y: c.y, w: c.w, h: c.h, ref });
  }
  const { cels: _cels, strokeLog, ...meta } = doc;
  const json: ArtDocJson = { ...meta, cels: jsonCels };
  const docBlob = new Blob([JSON.stringify(json)], { type: 'application/json' });
  return { json, docBlob, docRef: await blobRefOf(docBlob), cels, strokeLog };
}

/**
 * Rebuilds an ArtDoc from its JSON (or the stored JSON Blob) and a cel lookup. Missing cels are skipped.
 * The stroke log is not part of the stored JSON: pass it (a Blob, or the `Store.strokes` chunks) to keep
 * "Watch it drawn" and the log going.
 */
export async function deserializeArtDoc(source: ArtDocJson | Blob, getCel: (ref: BlobRef) => Promise<Blob | null>, strokeLog: Blob | Uint8Array[] | null = null): Promise<ArtDoc> {
  const json: ArtDocJson = source instanceof Blob ? (JSON.parse(await source.text()) as ArtDocJson) : source;
  if (json.format !== 'amble-art' || json.v !== 1) throw new Error('This is not an Amble drawing.');
  const cels: ArtCel[] = [];
  for (const c of json.cels) {
    const png = await getCel(c.ref);
    if (png) cels.push({ frame: c.frame, layer: c.layer, x: c.x, y: c.y, w: c.w, h: c.h, png });
  }
  const { cels: _cels, ...meta } = json;
  const log = strokeLog === null ? null : strokeLog instanceof Blob ? strokeLog : strokeLog.length ? new Blob(strokeLog as BlobPart[]) : null;
  return { ...meta, cels, strokeLog: log };
}

// ------------------------------------------------------------------ export, replay, time-lapse

export interface ExportArtOptions {
  /** A flipbook frame (default the base drawing). */
  frame?: string;
  /** Longest side of the flat image, px (default: no limit). */
  maxSide?: number;
  /** Export px per board px (default 1; lowered to fit `maxSide`). */
  scale?: number;
  /** Thumbnail's longest side (default 256). */
  thumbSize?: number;
  /** Only the flat image (no per-layer images or ink mask): faster previews. */
  flatOnly?: boolean;
  /** Body parts drawn on the bones to composite (their layer ids, bottom to top), even with `flatOnly`. */
  pairs?: Array<{ name: string; layers: string[] }>;
}

/**
 * The trimmed, transparent PNG with its anchor, per-layer PNGs, the body parts asked for with `pairs`, the
 * lines-only ink mask and a thumbnail. Null when the drawing has nothing exported on it yet. Sketch, trace
 * and guides never export.
 */
export function exportArt(doc: ArtDoc, o: ExportArtOptions = {}): Promise<ArtExport | null> {
  return exportArtDoc(doc, { frame: o.frame, maxSize: o.maxSide, scale: o.scale, thumbSize: o.thumbSize, flatOnly: o.flatOnly, pairs: o.pairs });
}

/** Every flipbook frame, trimmed and placed in one common box. */
export function exportArtFrames(doc: ArtDoc, o: { scale?: number } = {}): Promise<{ box: [number, number, number, number]; scale: number; frames: FrameExport[] } | null> {
  return exportArtDocFrames(doc, o);
}

/** Replays an ArtScript through the real brush engine, headless (Node too); the doc keeps the stroke log. */
export function replayArtScript(script: ArtScript, o: ReplayOptions = {}): Promise<ArtDoc> {
  return replayScript(script, o);
}

/** A drawing's stroke log: the doc, an ArtScript, an engine log, or its stored form (Blob or chunks). */
export type StrokeLogSource = ArtDoc | ArtScript | readonly LogOp[] | Blob | readonly Uint8Array[];

export interface StrokeLogPlayback extends Timelapse {
  /** Resolves when the replay reaches the end, is stopped, or cannot start. */
  readonly done: Promise<void>;
  /** Stops and removes the view (the same as `destroy`). */
  stop(): void;
}

function logOnly(log: Blob): ArtDoc {
  // The time-lapse reads only the format and the stroke log of a doc.
  return { format: 'amble-art', strokeLog: log } as ArtDoc;
}

function timelapseSource(source: StrokeLogSource): ArtDoc | ArtScript | readonly LogOp[] {
  if (source instanceof Blob) return logOnly(source);
  if (Array.isArray(source)) {
    const chunks = source as readonly unknown[];
    if (chunks.length && chunks.every((c) => c instanceof Uint8Array)) return logOnly(new Blob([...chunks] as BlobPart[]));
    return source as readonly LogOp[];
  }
  return source as ArtDoc | ArtScript;
}

/** "Watch it drawn": replays a drawing's strokes in `host` (it fills the element), at `speed` times. */
export function playStrokeLog(host: HTMLElement, source: StrokeLogSource, o: TimelapseOptions = {}): StrokeLogPlayback {
  const t = playTimelapse(host, timelapseSource(source), o);
  let finish: () => void = () => undefined;
  const done = new Promise<void>((resolve) => {
    finish = resolve;
  });
  t.on('end', () => finish());
  // A log that cannot play shows through `ready`; it never becomes an unhandled rejection.
  t.ready.catch(() => finish());
  const stop = () => {
    t.destroy();
    finish();
  };
  const extras: Record<PropertyKey, unknown> = { done, stop, destroy: stop };
  return new Proxy(t, {
    get(target, prop) {
      if (Object.prototype.hasOwnProperty.call(extras, prop)) return extras[prop];
      const v: unknown = Reflect.get(target, prop, target);
      return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(target) : v;
    },
  }) as unknown as StrokeLogPlayback;
}

// ------------------------------------------------------------------ the drawing surface

export interface ArtSurfaceOptions extends EngineSurfaceOptions {
  /** The student's pen feel (Prefs.pressure). */
  pressure?: 'light' | 'normal' | 'firm';
  /** A guide shown from the start (ground line, size reference, silhouette). */
  guide?: Guide | null;
}

/** The engine's events, the spec's names for two of them, and the inked share. */
export interface ArtSurfaceEvents extends Omit<SurfaceEvents, 'change'> {
  /** The document or its view changed; `inked` is the last counted share (0..1) of the board with ink. */
  change: SurfaceEvents['change'] & { inked: number };
  /** §8.2's name for `commit`: a stroke, fill, shape, transform, layer or frame change finished. */
  penup: SurfaceEvents['commit'];
  /** §8.2's name for `color`: the eyedropper picked a colour. */
  colour: SurfaceEvents['color'];
  /** The inked share changed (counted shortly after pixels change). */
  inked: { inked: number };
}

/** The drawing surface: the engine's surface (every method) plus the spec's names. */
export interface ArtSurface extends Omit<EngineSurface, 'on' | 'flipSelection'> {
  on<K extends keyof ArtSurfaceEvents>(type: K, fn: (e: ArtSurfaceEvents[K]) => void): () => void;
  /** 'h'/'v' (the engine's) or 'x'/'y'. */
  flipSelection(axis: 'h' | 'v' | 'x' | 'y'): void;

  /** The current tool, colour and brush size. */
  tool(): ToolId;
  color(): string;
  size(): number;
  /** The current brush's size, opacity and Steady (stabilizer 0..1; null = by input device). */
  setSize(px: number): void;
  setOpacity(alpha: number): void;
  setSteady(amount: number | null): void;
  setEraserOptions(o: { soft: boolean }): void;
  setFillOptions(o: { gaps?: GapsMode; tolerance?: number }): void;
  /** "Make it perfect" for the last stroke; true when a shape was recognised. */
  makePerfect(): Promise<boolean>;
  selectLayer(id: string): void;
  hasSelection(): boolean;
  selectFrame(id: string): Promise<void>;
  setOnionSkin(on: boolean): void;
  canUndo(): boolean;
  canRedo(): boolean;
  zoomBy(factor: number): void;
  /** Hides or shows the guide without forgetting it. */
  setGuidesVisible(on: boolean): void;
  /** Share (0..1) of the board covered by exported ink (the First page enables Bring it to life at 1.5 %). */
  inked(): number;
  /** Finishes pending fills and redraws (call before switching drawings). */
  flush(): Promise<void>;
  /** The current document (cels encoded; unchanged ones reused). */
  doc(): Promise<ArtDoc>;
}

/** What the barrel adds to (or wraps on) the engine's surface. */
type SurfaceExtras = Pick<
  ArtSurface,
  | 'on'
  | 'flipSelection'
  | 'tool'
  | 'color'
  | 'size'
  | 'setSize'
  | 'setOpacity'
  | 'setSteady'
  | 'setEraserOptions'
  | 'setFillOptions'
  | 'makePerfect'
  | 'selectLayer'
  | 'hasSelection'
  | 'selectFrame'
  | 'setOnionSkin'
  | 'canUndo'
  | 'canRedo'
  | 'zoomBy'
  | 'setGuide'
  | 'setGuidesVisible'
  | 'inked'
  | 'flush'
  | 'doc'
  | 'destroy'
>;

/** Alpha above this counts as ink for `inked()`. */
const INK_ALPHA = 16;
const INKED_DEBOUNCE_MS = 120;

/** Share of the board with exported ink in the active frame (sampled every 2 px on big boards). */
function countInk(s: EngineSurface): number {
  const W = s.width;
  const H = s.height;
  const px = s.readPixels(null, 0, 0, W, H);
  const step = W * H > 1024 * 1024 ? 2 : 1;
  let hit = 0;
  let n = 0;
  for (let y = 0; y < H; y += step) {
    for (let x = 0; x < W; x += step) {
      n++;
      if (px[(y * W + x) * 4 + 3] > INK_ALPHA) hit++;
    }
  }
  return n ? hit / n : 0;
}

/**
 * Mounts a drawing surface in `host` (it fills the element). `doc` null starts a blank drawing from the
 * options (size, kind, layers); prefer `newArtDoc` so the drawing has its id and name from the start.
 */
export function createArtSurface(host: HTMLElement, doc: ArtDoc | null, opts: ArtSurfaceOptions = {}): ArtSurface {
  const { pressure, guide, ...engineOpts } = opts;
  const engine = createEngineSurface(host, doc, engineOpts);

  let inked = 0;
  let guideShown = true;
  let lastGuide: Guide | null = guide ?? null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let destroyed = false;
  const inkedListeners = new Set<(e: { inked: number }) => void>();

  const recount = () => {
    timer = undefined;
    if (destroyed) return;
    let next: number;
    try {
      next = countInk(engine);
    } catch {
      return; // not ready yet
    }
    if (next === inked) return;
    inked = next;
    for (const fn of inkedListeners) fn({ inked });
  };
  const recountSoon = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(recount, INKED_DEBOUNCE_MS);
  };

  void engine.ready.then(() => {
    if (destroyed) return;
    if (pressure) engine.setPressure({ feel: pressure });
    if (lastGuide) engine.setGuide(lastGuide);
    recount();
  }, () => undefined);
  engine.on('change', (e) => {
    if (e.reason === 'pixels' || e.reason === 'layers' || e.reason === 'frames') recountSoon();
  });

  /** The brush the size, opacity and Steady controls change: the current tool's, else Ink's. */
  const brushOf = (): BrushId => {
    const state = engine.toolState();
    return (state.tool in state.brushes ? state.tool : 'ink') as BrushId;
  };

  const extras: SurfaceExtras = {
    on(type, fn) {
      const listener = fn as (e: unknown) => void;
      switch (type) {
        case 'penup':
          return engine.on('commit', listener);
        case 'colour':
          return engine.on('color', listener);
        case 'inked':
          inkedListeners.add(listener);
          return () => inkedListeners.delete(listener);
        case 'change':
          return engine.on('change', (e) => listener({ ...e, inked }));
        default:
          return engine.on(type as keyof SurfaceEvents, listener);
      }
    },
    flipSelection(axis) {
      engine.flipSelection(axis === 'x' ? 'h' : axis === 'y' ? 'v' : axis);
    },
    tool: () => engine.toolState().tool,
    color: () => engine.toolState().color,
    size: () => engine.toolState().brushes[brushOf()].size,
    setSize: (px) => engine.setBrush({ size: px }, brushOf()),
    setOpacity: (alpha) => engine.setBrush({ opacity: alpha }, brushOf()),
    setSteady: (amount) => engine.setBrush({ steady: amount }, brushOf()),
    setEraserOptions: (o) => engine.setBrush({ soft: o.soft }, 'eraser'),
    setFillOptions: (o) => engine.setFill(o),
    makePerfect: async () => (await engine.makeLastStrokePerfect()) !== null,
    selectLayer: (id) => engine.setActiveLayer(id),
    hasSelection: () => engine.selection() !== null,
    selectFrame: (id) => engine.setActiveFrame(id),
    setOnionSkin: (on) => engine.setOnion({ enabled: on }),
    canUndo: () => engine.historyState().canUndo,
    canRedo: () => engine.historyState().canRedo,
    zoomBy: (factor) => engine.zoomTo(engine.view().zoom * factor),
    setGuide(g) {
      lastGuide = g;
      if (guideShown) engine.setGuide(g);
    },
    setGuidesVisible(on) {
      guideShown = on;
      engine.setGuide(on ? lastGuide : null);
    },
    inked: () => inked,
    flush: () => engine.settled(),
    doc: () => engine.toArtDoc(),
    destroy() {
      destroyed = true;
      if (timer !== undefined) clearTimeout(timer);
      inkedListeners.clear();
      engine.destroy();
    },
  };

  return new Proxy(engine, {
    get(target, prop) {
      if (Object.prototype.hasOwnProperty.call(extras, prop)) return (extras as unknown as Record<PropertyKey, unknown>)[prop];
      const v: unknown = Reflect.get(target, prop, target);
      return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(target) : v;
    },
  }) as unknown as ArtSurface;
}
