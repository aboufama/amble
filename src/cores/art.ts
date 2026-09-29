/**
 * The art engine as the app sees it (§8.2): the drawing model, the drawing surface, export, headless
 * ArtScript replay and the time-lapse. Framework-free; the Desk (M3) and the First page (M1) use it.
 *
 * FOUNDATION-STUB: the art core (`src/art/engine`) has not merged yet. The model types mirror the core's
 * working copy of `src/art/engine/model.ts`; `ArtSurface` is the contract the app codes against (the barrel
 * adapts the core to it when it merges). `newArtDoc` and the storage (de)serialization below are real;
 * the surface, export, replay and time-lapse throw `NotBuiltYet` until the core lands.
 */
import { blobRefOf } from '../model/ids';
import { NotBuiltYet } from '../model/notBuilt';
import type { BlobRef } from '../model/types';
import type { ArtKind } from './play';

/** 'stub' until the art core merges. */
export const ART_CORE: 'stub' | 'real' = 'stub';

// ------------------------------------------------------------------ the drawing model (ArtDoc)

/** The rig kinds a drawing can be made for (the protocol's `none` is simply "no rig"). */
export type ArtRigKind = 'biped' | 'quadruped' | 'blob' | 'flyer' | 'swimmer' | 'object';

/**
 * lines: ink on top, the walls for "fill under the lines" and the rig's ink mask. colors: where fills
 * land. sketch: never exported. part:<name>: a body part for rigging. trace: a photo, never exported.
 * paint: anything else (shading, effects).
 */
export type LayerRole = 'lines' | 'colors' | 'sketch' | 'paint' | 'trace' | `part:${string}`;

export type LayerBlendMode = 'normal' | 'multiply';

export interface ArtLayer {
  id: string;
  name: string;
  role: LayerRole;
  visible: boolean;
  locked: boolean;
  opacity: number;
  blend: LayerBlendMode;
  /** Paint only where the layer already has pixels. */
  alphaLock: boolean;
}

export interface ArtFrame {
  id: string;
  /** Ticks (at 12 fps) the frame shows in a flipbook. */
  hold: number;
}

/** One non-empty (frame, layer) picture: a lossless PNG trimmed to its content, placed at (x, y). */
export interface ArtCel {
  frame: string;
  layer: string;
  x: number;
  y: number;
  w: number;
  h: number;
  png: Blob;
}

export interface ArtDoc {
  format: 'amble-art';
  v: 1;
  id: string;
  name: string;
  kind: ArtKind;
  rig?: ArtRigKind;
  /** Board size in px. */
  width: number;
  height: number;
  pixelArt: boolean;
  /** Bottom to top. */
  layers: ArtLayer[];
  /** At least one; frames[0] is the base drawing. */
  frames: ArtFrame[];
  cels: ArtCel[];
  /** Pivot override in board px; null = automatic for the kind (feet for characters). */
  anchor: [number, number] | null;
  /** Colours used, most used first (≤ 24). */
  palette: string[];
  /** The encoded stroke log (device only: the `strokes` store, never files, never sent). */
  strokeLog: Blob | null;
  created: number;
  updated: number;
  version: number;
}

export type BrushId = 'ink' | 'pencil' | 'marker' | 'crayon' | 'airbrush' | 'eraser' | 'pixel';

/** Stroke data for art drawn in Amble by script (the starter worlds). See S/ART-SCRIPT-FORMAT.md. */
export interface ArtScript {
  v: 1;
  name: string;
  kind: ArtKind;
  rig?: ArtRigKind;
  width: number;
  height: number;
  layers: { id: string; role: 'lines' | 'colors' | 'sketch' | 'paint' | `part:${string}`; name?: string }[];
  ops: ArtOp[];
  anchor?: [number, number];
}

export type ArtOp =
  | {
      op: 'stroke';
      layer: string;
      brush: BrushId;
      size: number;
      color: string;
      opacity?: number;
      steady?: number;
      /** [x, y, pressure 0..1] in canvas px. */
      points: [number, number, number][];
      dt?: number;
    }
  | { op: 'fill'; layer: string; x: number; y: number; color: string; tolerance?: number; underLines?: boolean }
  | {
      op: 'shape';
      layer: string;
      shape: 'line' | 'ellipse' | 'rect' | 'triangle';
      brush: 'ink' | 'marker' | 'crayon' | 'pencil';
      size: number;
      color: string;
      points: [number, number][];
      filled?: boolean;
    };

/** Budgets for a 4 GB Chromebook (§4.8, §7.8). */
export const ART_LIMITS = {
  maxBoard: 2048,
  maxLayers: 12,
  maxLayersWithParts: 16,
  maxFrames: 24,
} as const;

export function isPartRole(role: string): role is `part:${string}` {
  return role.startsWith('part:') && role.length > 5;
}

let docCounter = 0;
function docId(): string {
  docCounter = (docCounter + 1) % 1296;
  return 'art' + Date.now().toString(36).slice(-4) + docCounter.toString(36).padStart(2, '0') + Math.floor(Math.random() * 36 ** 6).toString(36).padStart(6, '0');
}

function layer(id: string, role: LayerRole, name: string): ArtLayer {
  return {
    id,
    name,
    role,
    visible: role !== 'trace',
    locked: role === 'trace',
    opacity: role === 'sketch' ? 0.4 : role === 'trace' ? 0.3 : 1,
    blend: 'normal',
    alphaLock: false,
  };
}

export interface NewArtDocOptions {
  name: string;
  kind: ArtKind;
  rig?: ArtRigKind;
  width: number;
  height: number;
  pixelArt?: boolean;
  /**
   * 'freehand': Colours, Lines, Sketch (the Desk's default). 'dock': Colours and Lines (the First page).
   * Or explicit layers, bottom to top.
   */
  layers?: 'freehand' | 'dock' | Array<{ id: string; role: LayerRole; name: string }>;
  anchor?: [number, number] | null;
}

/** A blank drawing. */
export function newArtDoc(o: NewArtDocOptions): ArtDoc {
  const preset = o.layers ?? 'freehand';
  const layers =
    preset === 'freehand'
      ? [layer('colors', 'colors', 'Colours'), layer('lines', 'lines', 'Lines'), { ...layer('sketch', 'sketch', 'Sketch'), visible: false }]
      : preset === 'dock'
        ? [layer('colors', 'colors', 'Colours'), layer('lines', 'lines', 'Lines')]
        : preset.map((l) => layer(l.id, l.role, l.name));
  const now = Date.now();
  return {
    format: 'amble-art',
    v: 1,
    id: docId(),
    name: o.name,
    kind: o.kind,
    rig: o.rig,
    width: Math.min(ART_LIMITS.maxBoard, Math.max(1, Math.round(o.width))),
    height: Math.min(ART_LIMITS.maxBoard, Math.max(1, Math.round(o.height))),
    pixelArt: o.pixelArt ?? false,
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
  /** The stroke log, for the device-only `strokes` store. Never put it in a file. */
  strokeLog: Blob | null;
}

/** Splits an ArtDoc into its JSON (with cel refs) and content-addressed cel blobs. */
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

/** Rebuilds an ArtDoc from its JSON (or the stored JSON Blob) and a cel lookup. Missing cels are skipped. */
export async function deserializeArtDoc(source: ArtDocJson | Blob, getCel: (ref: BlobRef) => Promise<Blob | null>): Promise<ArtDoc> {
  const json: ArtDocJson = source instanceof Blob ? (JSON.parse(await source.text()) as ArtDocJson) : source;
  if (json.format !== 'amble-art' || json.v !== 1) throw new Error('This is not an Amble drawing.');
  const cels: ArtCel[] = [];
  for (const c of json.cels) {
    const png = await getCel(c.ref);
    if (png) cels.push({ frame: c.frame, layer: c.layer, x: c.x, y: c.y, w: c.w, h: c.h, png });
  }
  const { cels: _cels, ...meta } = json;
  return { ...meta, cels, strokeLog: null };
}

// ------------------------------------------------------------------ export

export interface PngImage {
  png: Blob;
  w: number;
  h: number;
}

export interface LayerExport extends PngImage {
  layerId: string;
  name: string;
  role: LayerRole;
  /** Body part name for `part:<name>` layers. */
  part: string | null;
  /** Offset within the flat image, in flat px. */
  x: number;
  y: number;
}

/** What `exportArt` returns (the core's ArtExport; `ArtExport` in src/model is the stored record). */
export interface ArtExportResult {
  /** The flattened, trimmed, transparent image at `scale`. */
  flat: PngImage;
  /** Trim box on the board, board px: [x, y, w, h]. */
  box: [number, number, number, number];
  scale: number;
  /** The pivot in flat px, and on the board. */
  anchor: [number, number];
  anchorBoard: [number, number];
  layers: LayerExport[];
  /** The visible lines layers alone (the rig's ink mask), same size and place as the flat. */
  linesMask: PngImage | null;
  thumb: PngImage;
}

export interface ExportArtOptions {
  frame?: string;
  /** Longest side of the flat, px. */
  maxSide: number;
  /** Export px per board px. */
  scale: number;
}

/** Trimmed PNG with anchor, per-layer PNGs, lines-only ink mask and thumbnail. */
export function exportArt(_doc: ArtDoc, _opts: ExportArtOptions): Promise<ArtExportResult> {
  return Promise.reject(new NotBuiltYet('exportArt (art core)'));
}

/** Replays an ArtScript through the real brush engine, headless. */
export function replayArtScript(_script: ArtScript): Promise<ArtDoc> {
  return Promise.reject(new NotBuiltYet('replayArtScript (art core)'));
}

export interface StrokeLogPlayback {
  /** Resolves when the replay reaches the end (or is stopped). */
  done: Promise<void>;
  stop(): void;
}

/** Time-lapse: replays a drawing's stroke log onto a canvas ("Watch it drawn"). */
export function playStrokeLog(_log: Uint8Array[] | Blob, _canvas: HTMLCanvasElement, _o: { speed?: number } = {}): StrokeLogPlayback {
  throw new NotBuiltYet('playStrokeLog (art core)');
}

// ------------------------------------------------------------------ the drawing surface

export type ToolId = BrushId | 'fill' | 'select' | 'shapes' | 'eyedropper' | 'trace';

export type PressureFeel = 'light' | 'normal' | 'firm';

/** What the guide overlay shows (never exported). Coordinates are board px. */
export interface ArtGuide {
  /** The ground line ("GROUND", or "floats here" for flyers). */
  ground?: { y: number; label: string } | null;
  /** The pivot pin (draggable in the Desk). */
  pivot?: [number, number] | null;
  facing?: 'left' | 'right' | 'viewer' | null;
  /** The template constellation: bones as [x1, y1, x2, y2], joints as points; `highlight` bone indexes glow. */
  skeleton?: { bones: Array<[number, number, number, number]>; joints: Array<[number, number]>; highlight?: number[] } | null;
  /** The scale ghost ("Pip, for size"): a silhouette at the same scale, grey at 30 %. */
  ghost?: { image: CanvasImageSource; x: number; y: number; w: number; h: number; label: string } | null;
  /** The star-pose guide's dashed outline. */
  outline?: Array<[number, number]> | null;
}

export interface ArtSurfaceOptions {
  /** 'desk': every tool. 'dock': the First page (ink, six colours, three sizes, eraser, undo; no fill). */
  profile: 'desk' | 'dock';
  pressure?: PressureFeel;
  leftHanded?: boolean;
  /** Paper behind the drawing (never exported). Default true. */
  paper?: boolean;
  guide?: ArtGuide | null;
  readOnly?: boolean;
  /** Stroke-log chunks as they are recorded (device only: `Store.strokes`). */
  onStrokeLog?(chunk: Uint8Array): void;
}

export interface ArtSurfaceEvents {
  history: { canUndo: boolean; canRedo: boolean };
  layers: { layers: ArtLayer[]; active: string };
  /** Pixels changed. `inked` is the fraction (0..1) of the board covered by exported layers. */
  change: { inked: number };
  /** A stroke, fill or shape finished. */
  penup: { frame: string; layer: string };
  /** Something to tell the student ("That layer is hidden. Show it to draw on it."). */
  toast: { message: string };
  /** The current colour changed (eyedropper, swatch). */
  colour: { color: string };
}

export interface ArtView {
  zoom: number;
  /** Board px at the centre of the view. */
  x: number;
  y: number;
  /** Radians. */
  rotation: number;
}

/** A live drawing surface over one ArtDoc. Every method is safe to call at any time. */
export interface ArtSurface {
  readonly width: number;
  readonly height: number;

  setTool(tool: ToolId): void;
  tool(): ToolId;
  setColor(color: string): void;
  color(): string;
  setSize(px: number): void;
  size(): number;
  setOpacity(alpha: number): void;
  setSteady(amount: number): void;
  setFillOptions(o: { gaps?: 'auto' | 'small' | 'off'; allOfColour?: boolean; lasso?: boolean }): void;
  setShapeOptions(o: { shape?: 'line' | 'rect' | 'ellipse' | 'curve'; filled?: boolean }): void;
  setEraserOptions(o: { soft: boolean }): void;
  /** Click to start, move, click to end (trackpads and motor accessibility). */
  setTapToInk(on: boolean): void;
  /** Symmetry while drawing; `at` is the axis position in board px (default the centre). */
  setMirror(m: { axis: 'vertical' | 'horizontal'; at?: number } | null): void;
  /** "Make it perfect": turns the last stroke into its recognised shape. False when none was recognised. */
  makePerfect(): boolean;

  layers(): ArtLayer[];
  activeLayer(): string;
  selectLayer(id: string): void;
  addLayer(role: LayerRole, o?: { name?: string; above?: string; blend?: LayerBlendMode }): string;
  removeLayer(id: string): void;
  moveLayer(id: string, index: number): void;
  setLayer(id: string, patch: Partial<Omit<ArtLayer, 'id'>>): void;
  duplicateLayer(id: string): string;
  mergeDown(id: string): void;
  /** On the bones: ink tools draw on `lines`, fill/marker/crayon/airbrush on `colors`. Null = the active layer. */
  setTargets(t: { lines: string; colors: string } | null): void;

  selectAll(): void;
  clearSelection(): void;
  hasSelection(): boolean;
  flipSelection(axis: 'x' | 'y'): void;
  deleteSelection(): void;
  /** "Make it a part": moves the selection onto a new layer with this role; returns its id. */
  selectionToLayer(role: LayerRole, name: string): string | null;

  frames(): ArtFrame[];
  activeFrame(): string;
  selectFrame(id: string): void;
  addFrame(o?: { copy?: boolean; after?: string }): string;
  removeFrame(id: string): void;
  moveFrame(id: string, index: number): void;
  setFrameHold(id: string, hold: number): void;
  setOnionSkin(on: boolean): void;

  undo(): void;
  redo(): void;
  canUndo(): boolean;
  canRedo(): boolean;

  view(): ArtView;
  setView(v: Partial<ArtView>): void;
  zoomBy(factor: number): void;
  fit(): void;
  setGuide(guide: ArtGuide | null): void;
  setGuidesVisible(on: boolean): void;

  /** Fraction (0..1) of the board covered by exported layers (the First page enables Bring it to life at 1.5 %). */
  inked(): number;
  /** Finishes any stroke in progress and pending cel encodes. Call before switching drawings. */
  flush(): Promise<void>;
  /** The current document, cels encoded (flushes first). */
  doc(): Promise<ArtDoc>;
  on<K extends keyof ArtSurfaceEvents>(type: K, fn: (e: ArtSurfaceEvents[K]) => void): () => void;
  destroy(): void;
}

/** Mounts a drawing surface in `host` (it fills the element). */
export function createArtSurface(_host: HTMLElement, _doc: ArtDoc, _opts: ArtSurfaceOptions): ArtSurface {
  throw new NotBuiltYet('createArtSurface (art core)');
}
