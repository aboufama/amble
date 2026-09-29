/** Public types of the drawing surface (the controller the Draw room UI wraps). */
import type { BrushId } from './brushes';
import type { PressureFeel } from './filters';
import type { Guide } from './guide';
import type { ArtExport, ExportOptions, FrameExport } from './export';
import type { LogOp } from './log';
import type { ArtDoc, ArtKind, LayerBlendMode, LayerRole, RigKind } from './model';
import type { PerfectKind } from './shape';
import type { SelectionTransform } from './select';
import type { SelectScope } from './selection-tool';
import type { ViewState } from './view';

export type ToolId = BrushId | 'fill' | 'eyedropper' | 'lasso' | 'select' | 'pan';

export const TOOL_IDS: readonly ToolId[] = ['ink', 'pencil', 'marker', 'crayon', 'airbrush', 'eraser', 'pixel', 'fill', 'eyedropper', 'lasso', 'select', 'pan'];

export interface BrushSettings {
  /** Diameter, board px. */
  size: number;
  /** 0..1. */
  opacity: number;
  /** Stabilizer 0..1; null = by input (pen 0, finger 0.13, mouse/trackpad 0.2). */
  steady: number | null;
  /** Eraser only: soft edge. */
  soft: boolean;
}

export type GapsMode = 'auto' | 'small' | 'off';

export interface ToolState {
  tool: ToolId;
  /** '#rrggbb'. */
  color: string;
  brushes: Record<BrushId, BrushSettings>;
  /** Mirror axes in board px (null = off). */
  mirror: { x: number | null; y: number | null };
  holdToPerfect: boolean;
  fill: { gaps: GapsMode; tolerance: number };
  pressure: { feel: PressureFeel; calibrate: boolean };
  /** What lasso and box selections lift: the drawing (lines, colors and paint together) or the active layer. */
  select: { scope: SelectScope };
}

export interface LayerInfo {
  id: string;
  name: string;
  role: LayerRole;
  visible: boolean;
  locked: boolean;
  opacity: number;
  blend: LayerBlendMode;
  alphaLock: boolean;
  /** Never leaves the editor (sketch, trace). */
  exported: boolean;
  active: boolean;
  /** Has pixels in the active frame. */
  empty: boolean;
}

export interface FrameInfo {
  id: string;
  hold: number;
  index: number;
  active: boolean;
}

export interface HistoryState {
  canUndo: boolean;
  canRedo: boolean;
  undoLabel: string | null;
  redoLabel: string | null;
  /** Undo memory in use, bytes. */
  bytes: number;
}

export interface SelectionInfo {
  /** The active layer. */
  layer: string;
  /** The layers whose pixels are lifted, bottom to top. */
  layers: string[];
  /** Floating pixels being transformed; false while the outline is being drawn. */
  floating: boolean;
  transform: SelectionTransform;
  /** The lifted box on the board: [x, y, w, h]. */
  box: [number, number, number, number];
}

export type ToastKind = 'shape' | 'fill' | 'info' | 'limit';

export interface SurfaceEvents {
  /** The document or its view changed (repaint UI that mirrors it). */
  change: { reason: 'pixels' | 'layers' | 'frames' | 'view' | 'selection' | 'guide' | 'anchor' };
  tool: ToolState;
  history: HistoryState;
  /** Unsaved changes appeared (true) or were saved (false). */
  dirty: boolean;
  /** An operation finished (a stroke, fill, shape, transform, layer or frame change). Save after this. */
  commit: { op: LogOp['op']; label: string; layer: string | null; frame: string };
  layers: LayerInfo[];
  frames: FrameInfo[];
  view: ViewState;
  /** The eyedropper picked a colour. */
  color: { color: string };
  selection: SelectionInfo | null;
  /** A short message for the user: "Perfect circle!", "Closed a 7 px gap". */
  toast: { message: string; kind: ToastKind; shape?: PerfectKind; gap?: number };
  error: { message: string };
}

export interface ArtSurfaceOptions {
  /** New drawings (doc = null): board size (default 1024 x 1024), kind, name, rig kind, pixel art. */
  width?: number;
  height?: number;
  kind?: ArtKind;
  name?: string;
  rig?: RigKind;
  pixelArt?: boolean;
  /** New drawings: layers bottom to top (default sketch (hidden), colors, lines; the top one is active). */
  layers?: LayerRole[];
  /** Paper colour (display only; exports are transparent). Default '#fffdf7'. */
  paper?: string;
  /** The desk around the paper. Default '#e6e1d8'. */
  workspace?: string;
  /** Single-key shortcuts and Ctrl+Z etc. while the surface has focus (default true). */
  keyboard?: boolean;
  /** Record the stroke log (default true). */
  record?: boolean;
  /** Skip the fill pour and other animations (default: the user's prefers-reduced-motion). */
  reducedMotion?: boolean;
  /** Two-finger rotation (default true). */
  rotate?: boolean;
  /** Low-latency canvas (default true). */
  desynchronized?: boolean;
  /** Use the engine worker (default true when available). */
  worker?: boolean;
  /** Undo budget, bytes (default LIMITS.historyBytes). */
  historyBytes?: number;
  /** Measurement only: force the canvas raster inside each render so timings include it (slow). */
  perfProbe?: boolean;
}

export interface PerfStats {
  /** Input event to pixels written, ms. */
  latency: { n: number; p50: number; p95: number; max: number };
  /** Engine + composite work per render, ms. */
  work: { n: number; p50: number; p95: number; max: number };
  /** Pen-up commit, ms. */
  commit: { n: number; p50: number; p95: number; max: number };
  fills: Array<{ ms: number; analyzeMs: number; gap: number; background: boolean; split: boolean; area: number; mode: string }>;
  history: { steps: number; bytes: number };
  /** Resident layer pixels, bytes. */
  pixels: number;
  desynchronized: boolean;
  rawUpdates: boolean;
  worker: boolean;
  renderCost: number;
}

/** The drawing surface: create it with createArtSurface(host, doc, options). */
export interface ArtSurface {
  /** Resolves when the drawing is loaded and input is live. */
  readonly ready: Promise<void>;
  readonly width: number;
  readonly height: number;
  readonly pixelArt: boolean;
  on<K extends keyof SurfaceEvents>(type: K, fn: (e: SurfaceEvents[K]) => void): () => void;

  // Tools
  toolState(): ToolState;
  setTool(tool: ToolId): void;
  /** Size, opacity, steady and soft for a brush (default: the current tool's). */
  setBrush(patch: Partial<BrushSettings>, brush?: BrushId): void;
  setColor(color: string): void;
  /** Mirror: true = through the board's centre, a number = at that board coordinate, false/null = off. */
  setMirror(m: { x?: boolean | number | null; y?: boolean | number | null } | null): void;
  setHoldToPerfect(on: boolean): void;
  setFill(o: Partial<ToolState['fill']>): void;
  /** Selection scope: 'drawing' (default) lifts lines, colors and paint layers together; 'layer' just the active one. */
  setSelect(o: Partial<ToolState['select']>): void;
  setPressure(o: Partial<ToolState['pressure']>): void;
  /** "Make it perfect" for the last stroke (a timing-free alternative to holding still). */
  makeLastStrokePerfect(): Promise<PerfectKind | null>;
  /** Picks the displayed colour at a board point ('#rrggbb'). */
  pickColor(x: number, y: number): string;
  /** Fills at a board point with the current colour and fill settings (like a tap with Fill). */
  fillAt(x: number, y: number): Promise<boolean>;
  /** Resolves when no fill is being worked out and the screen shows the final pixels. */
  settled(): Promise<void>;

  // Undo
  undo(): Promise<boolean>;
  redo(): Promise<boolean>;
  historyState(): HistoryState;

  // Layers
  layers(): LayerInfo[];
  activeLayer(): string;
  setActiveLayer(id: string): void;
  /** Adds a layer (default above the active one); returns its id, or null at the layer limit. */
  addLayer(role: LayerRole, o?: { name?: string; index?: number; blend?: LayerBlendMode }): string | null;
  removeLayer(id: string): void;
  moveLayer(id: string, index: number): void;
  duplicateLayer(id: string): string | null;
  mergeDown(id: string): Promise<void>;
  setLayer(id: string, patch: Partial<Pick<LayerInfo, 'name' | 'visible' | 'locked' | 'opacity' | 'blend' | 'alphaLock'>>): void;
  /** Clears a layer in the active frame (or all frames). */
  clearLayer(id?: string, allFrames?: boolean): Promise<void>;
  /** Places a photo on a new trace layer (30%, locked, never exported, never sent anywhere). */
  importTrace(image: ImageBitmap | HTMLImageElement | HTMLCanvasElement | Blob): Promise<string | null>;

  // Frames (flipbook)
  frames(): FrameInfo[];
  activeFrame(): string;
  setActiveFrame(id: string): Promise<void>;
  addFrame(o?: { after?: string; copy?: boolean }): Promise<string | null>;
  removeFrame(id: string): void;
  moveFrame(id: string, index: number): void;
  setFrameHold(id: string, hold: number): void;
  /** Onion skin: the pages before (red) and after (green), `range` 1 or 2 each side (default 2). */
  setOnion(o: { enabled?: boolean; range?: number }): void;
  /** Plays the flipbook in place of the editable view; returns stop(). */
  playFrames(fps: number, onFrame?: (index: number) => void): Promise<() => void>;

  /** A small picture of a layer (null = the exported composite) in the active frame (or `frame`). */
  thumbnail(layer: string | null, maxSize: number, frame?: string): Promise<ImageBitmap>;
  /** Straight RGBA pixels of a layer (null = the exported composite) in a board rect. */
  readPixels(layer: string | null, x: number, y: number, w: number, h: number, frame?: string): Uint8ClampedArray;

  // View
  view(): ViewState & { cssW: number; cssH: number };
  setView(v: Partial<ViewState>): void;
  fit(): void;
  /** Zooms keeping a board point (default: the view centre) fixed. */
  zoomTo(zoom: number, at?: { x: number; y: number }): void;
  setRotation(radians: number): void;
  /** Board px <-> client (page) px. */
  docToClient(x: number, y: number): { x: number; y: number };
  clientToDoc(x: number, y: number): { x: number; y: number };

  // Selection
  selection(): SelectionInfo | null;
  selectAll(): void;
  transformSelection(patch: Partial<SelectionTransform>): void;
  flipSelection(axis: 'h' | 'v'): void;
  commitSelection(): void;
  cancelSelection(): void;
  deleteSelection(): void;
  /** "Make this a part": moves the selection onto a new part:<name> layer; returns its id. */
  selectionToPart(name: string): string | null;

  // Guide and anchor
  setGuide(g: Guide | null): void;
  /** Anchor override in board px (null = automatic for the kind). */
  setAnchor(a: [number, number] | null): void;
  /** The anchor that export will use, board px (null when the drawing is empty). */
  anchor(): [number, number] | null;

  // Saving and export
  /** The drawing as an ArtDoc (unchanged cels are reused; dirty ones encode in the worker). */
  toArtDoc(): Promise<ArtDoc>;
  isDirty(): boolean;
  /** Marks the current state as saved (dirty = false). */
  markSaved(): void;
  /** Flat PNG with anchor, per-layer PNGs, the lines-only ink mask and a thumbnail (in the worker). */
  export(o?: ExportOptions): Promise<ArtExport | null>;
  exportFrames(o?: { scale?: number }): Promise<{ box: [number, number, number, number]; scale: number; frames: FrameExport[] } | null>;
  /** The stroke log so far (undo/redo included; see effectiveOps). */
  log(): readonly LogOp[];

  stats(): PerfStats;
  destroy(): void;
}
