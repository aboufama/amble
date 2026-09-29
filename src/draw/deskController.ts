/**
 * The Desk's controller (§2.10, §7): the art surface plus everything the Desk adds on top of the engine.
 * - Tool routing: each tool draws on the layer it belongs on (the part pair on the bones; Lines and Colours
 *   in Freehand), so the student never manages layers.
 * - Drawing on the bones: the steps, the part being drawn, which parts have ink, Copy it to the other side,
 *   extras, and the switch to Freehand.
 * - The guides (scale ghost, ground, facing, the bones or the star pose), redrawn when they change.
 * - A plain snapshot of all of it for React (`subscribe` / `getSnapshot`), and translated toasts.
 * Framework-free; the React components render its state and call its methods.
 */
import {
  createArtSurface,
  type ArtDoc,
  type ArtSurface,
  type FrameInfo,
  type GapsMode,
  type LayerInfo,
  type SelectionInfo,
  type ToolId,
} from '../cores/art';
import { partSteps, templateHints, type CharacterKind, type JointHints, type RigData } from '../cores/rig';
import { t, type MessageKey } from '../i18n';
import type { Facing, PartLayers, Prefs } from '../model/types';
import type { BoardSpec } from './boards';
import { renderGuides, templateOnBoard, type GuideLabels } from './guides';
import { pushRecent, START_COLOR } from './palette';
import { bonesLayout, FREEHAND_PAIR, mirrorMatrix, nextExtra, otherSide, pairIds, partOfLayer, rigFacing, targetLayer, type BonesStep, type RoutedTool } from './parts';
import type { DeskRequest } from './request';

/**
 * The drawing as the previews see it: a small trimmed export (in the engine worker) made 400 ms after
 * each change, never while the pen is down or a selection is lifted.
 */
export interface DeskArt {
  flat: Blob;
  w: number;
  h: number;
  /** Trim box on the board [x, y, w, h] and export px per board px. */
  box: [number, number, number, number];
  scale: number;
  /** Where it stands, on the board. */
  anchorBoard: [number, number];
  /** Drawing on the bones: each drawn part (lines over colours), the same size and place as `flat`. */
  parts: Array<{ name: string; png: Blob }>;
  mode: DeskMode;
}

/** The previews' export size (long side, px). */
const PREVIEW_MAX = 320;

export type DeskTool = 'ink' | 'pencil' | 'marker' | 'crayon' | 'airbrush' | 'eraser' | 'fill' | 'select' | 'shapes' | 'pixel';
export type ColorOrigin = 'recent' | 'picked' | 'world' | 'skin' | 'box' | 'mixed';
export type DeskMode = 'bones' | 'free';

export const TOOL_KEYS: Readonly<Record<string, DeskTool>> = { b: 'ink', p: 'pencil', m: 'marker', c: 'crayon', a: 'airbrush', e: 'eraser', g: 'fill', l: 'select', u: 'shapes' };

/** The key that picks each tool (for tooltips). */
export const KEY_OF: Readonly<Partial<Record<DeskTool, string>>> = { ink: 'B', pencil: 'P', marker: 'M', crayon: 'C', airbrush: 'A', eraser: 'E', fill: 'G', select: 'L', shapes: 'U' };

export interface DeskState {
  ready: boolean;
  /** The rig kind and facing being drawn (the request's, or the student's pick for a free drawing). */
  kind: DeskRequest['rig'];
  facing: Facing;
  tool: DeskTool;
  /** Alt held (or the eyedropper button): the next tap picks a colour. */
  picking: boolean;
  color: string;
  origin: ColorOrigin;
  recent: string[];
  /** The current tool's brush: size (board px), opacity (0..1), steady (0..1, null = by input). */
  brush: { size: number; opacity: number; steady: number | null };
  fill: { gaps: GapsMode; all: boolean; lasso: boolean };
  shape: { kind: 'line' | 'rect' | 'ellipse' | 'curve'; filled: boolean };
  select: 'lasso' | 'box';
  eraserSoft: boolean;
  tapToInk: boolean;
  mirror: boolean;
  guides: boolean;
  /** Freehand: the star-pose guide to draw over (characters with bones). */
  starPose: boolean;
  steady: boolean;
  /** CSS px per board px, as a percentage. */
  zoom: number;
  layers: LayerInfo[];
  active: string;
  canUndo: boolean;
  canRedo: boolean;
  mode: DeskMode;
  steps: BonesStep[];
  step: number;
  /** The part being drawn on the bones (null in Freehand). */
  part: string | null;
  /** Parts that have ink. */
  drawn: string[];
  parts: Record<string, PartLayers>;
  frames: FrameInfo[];
  frame: string;
  onion: boolean;
  playing: boolean;
  /** The flipbook's move ("Pages for Attack"; null: none yet) and its pages per second (4-12). */
  flip: { move: string | null; fps: number };
  selection: SelectionInfo | null;
  inked: number;
  dirty: boolean;
  /** Where it stands (the pivot pin), on the board; null until there is ink. */
  pin: [number, number] | null;
  /** The student placed the pin (else it follows the drawing). */
  pinPlaced: boolean;
}

export interface DeskOpen {
  host: HTMLElement;
  doc: ArtDoc;
  request: DeskRequest;
  board: BoardSpec;
  mode: DeskMode;
  /** Part name → its layer pair (drawing on the bones). */
  parts: Record<string, PartLayers>;
  steps: BonesStep[];
  prefs: Pick<Prefs, 'pressure'> & { reducedMotion: boolean };
  /** The hero's drawing for the scale ghost. */
  heroImage: ImageBitmap | null;
  /** The part bones of the kind (part name → bone names). */
  partBones: Record<string, string[]>;
  /** The paper and the desk around it (the theme's tokens). */
  colors?: { paper: string; workspace: string };
  /** The flipbook's move and speed as saved (or the move Bones asked to draw). */
  flip?: { move: string | null; fps: number };
}

type Listener = () => void;
export type DeskEvent =
  | { type: 'penup'; layer: string | null; op: string }
  | { type: 'toast'; text: string }
  | { type: 'announce'; text: string }
  /** The pen (finger, mouse) went down on the paper, or came up. */
  | { type: 'pen'; down: boolean }
  /** A new preview export (null: nothing drawn). */
  | { type: 'art'; art: DeskArt | null };

const TOOL_ENGINE: Record<DeskTool, ToolId> = {
  ink: 'ink',
  pencil: 'pencil',
  marker: 'marker',
  crayon: 'crayon',
  airbrush: 'airbrush',
  eraser: 'eraser',
  fill: 'fill',
  select: 'lasso',
  shapes: 'shape',
  pixel: 'pixel',
};

/** Tools whose brush the size, opacity and steady sliders change (the others show Ink's). */
const BRUSH_OF: Record<DeskTool, 'ink' | 'pencil' | 'marker' | 'crayon' | 'airbrush' | 'eraser' | 'pixel'> = {
  ink: 'ink',
  pencil: 'pencil',
  marker: 'marker',
  crayon: 'crayon',
  airbrush: 'airbrush',
  eraser: 'eraser',
  fill: 'ink',
  select: 'ink',
  shapes: 'ink',
  pixel: 'pixel',
};

/** Steady when the view bar's Steady is on: a 12 px pulled string. */
const STEADY_ON = 0.4;

export class DeskController {
  readonly surface: ArtSurface;
  /** What is being drawn (a free drawing's kind and facing can change: "What is it?"). */
  request: DeskRequest;
  readonly board: BoardSpec;
  private state: DeskState;
  private readonly listeners = new Set<Listener>();
  private readonly eventListeners = new Set<(e: DeskEvent) => void>();
  private readonly off: Array<() => void> = [];
  private lastTouched: string | null = null;
  private rig: RigData | null;
  private guideTimer = 0;
  private stopPlay: (() => void) | null = null;
  private destroyed = false;
  private partBones: Record<string, string[]>;
  private readonly heroImage: ImageBitmap | null;
  private unit = 1;
  private pen = false;
  private sizeTimer = 0;
  private artTimer = 0;
  private artSeq = 1;
  private artDone = 0;
  private artBusy = false;
  private artWanted = 0;
  private lastArt: DeskArt | null = null;

  constructor(o: DeskOpen) {
    this.request = o.request;
    this.board = o.board;
    this.partBones = o.partBones;
    this.heroImage = o.heroImage;
    this.rig = templateOnBoard(o.board, o.request);
    this.surface = createArtSurface(o.host, o.doc, {
      pressure: o.prefs.pressure,
      keyboard: false,
      reducedMotion: o.prefs.reducedMotion,
      paper: o.colors?.paper ?? '#fdf8ec',
      workspace: o.colors?.workspace ?? '#151843',
      a11y: { role: 'application', label: t('draw.sheetLabel') },
    });
    const down = (e: PointerEvent): void => {
      if (e.button > 0 && e.pointerType === 'mouse') return;
      this.setPen(true);
    };
    const up = (): void => this.setPen(false);
    o.host.addEventListener('pointerdown', down, true);
    window.addEventListener('pointerup', up, true);
    window.addEventListener('pointercancel', up, true);
    this.off.push(() => {
      o.host.removeEventListener('pointerdown', down, true);
      window.removeEventListener('pointerup', up, true);
      window.removeEventListener('pointercancel', up, true);
    });
    const firstStep = o.steps.findIndex((s) => s.parts.length > 0);
    this.state = {
      ready: false,
      kind: o.request.rig,
      facing: o.request.facing,
      tool: o.board.pixelArt ? 'pixel' : 'ink',
      picking: false,
      color: START_COLOR,
      origin: 'box',
      recent: [],
      brush: { size: 7, opacity: 1, steady: null },
      fill: { gaps: 'auto', all: false, lasso: false },
      shape: { kind: 'line', filled: false },
      select: 'lasso',
      eraserSoft: false,
      tapToInk: false,
      mirror: false,
      guides: true,
      starPose: true,
      steady: false,
      zoom: 100,
      layers: [],
      active: '',
      canUndo: false,
      canRedo: false,
      mode: o.mode,
      steps: o.steps,
      step: Math.max(0, firstStep),
      part: o.mode === 'bones' ? (o.steps[Math.max(0, firstStep)]?.parts[0] ?? null) : null,
      drawn: [],
      parts: o.parts,
      frames: [],
      frame: '',
      onion: false,
      playing: false,
      flip: o.flip ?? { move: null, fps: 8 },
      selection: null,
      inked: 0,
      dirty: false,
      pin: null,
      pinPlaced: o.doc.anchor !== null && o.doc.anchor !== undefined,
    };
    void this.surface.ready.then(() => this.onReady(), () => undefined);
  }

  private setPen(down: boolean): void {
    if (down === this.pen) return;
    this.pen = down;
    this.emit({ type: 'pen', down });
  }

  /** Whether any layer has pixels (counted at once, unlike `inked`, which follows a moment later). */
  hasInk(): boolean {
    return this.state.ready && this.surface.layers().some((l) => !l.empty);
  }

  /** Whether the pen (finger, mouse) is down on the paper. */
  penDown(): boolean {
    return this.pen;
  }

  // ------------------------------------------------------------------------------------------ the store API

  subscribe = (fn: Listener): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getSnapshot = (): DeskState => this.state;

  onEvent(fn: (e: DeskEvent) => void): () => void {
    this.eventListeners.add(fn);
    return () => this.eventListeners.delete(fn);
  }

  private set(patch: Partial<DeskState>): void {
    if (this.destroyed) return;
    // Nothing new (a pan keeps the zoom): no new snapshot, so the Desk does not re-render.
    const keys = Object.keys(patch) as Array<keyof DeskState>;
    if (keys.every((k) => Object.is(this.state[k], patch[k]))) return;
    this.state = { ...this.state, ...patch };
    for (const fn of this.listeners) fn();
  }

  private emit(e: DeskEvent): void {
    for (const fn of this.eventListeners) fn(e);
  }

  // ------------------------------------------------------------------------------------------ setup

  private onReady(): void {
    if (this.destroyed) return;
    const s = this.surface;
    this.off.push(
      s.on('layers', (layers) => {
        this.set({ layers, active: s.activeLayer(), drawn: this.drawnParts(layers) });
        this.scheduleArt();
      }),
      s.on('history', (h) => {
        this.set({ canUndo: h.canUndo, canRedo: h.canRedo });
        this.scheduleArt();
      }),
      s.on('view', (v) => this.set({ zoom: Math.round(v.zoom * 100) })),
      s.on('frames', (frames) => this.set({ frames, frame: s.activeFrame() })),
      s.on('selection', (selection) => this.set({ selection })),
      s.on('dirty', (dirty) => this.set({ dirty })),
      s.on('inked', (e) => this.set({ inked: e.inked })),
      s.on('colour', (e) => {
        this.set({ color: e.color, origin: 'picked', picking: false, recent: pushRecent(this.state.recent, e.color) });
        if (this.state.tool !== 'fill' || !this.state.picking) this.applyTool(this.state.tool);
        this.emit({ type: 'announce', text: t('draw.origin_picked') });
      }),
      s.on('toast', (e) => this.onToast(e)),
      s.on('penup', (e) => this.onPenUp(e)),
      s.on('tool', (st) => {
        const b = st.brushes[BRUSH_OF[this.state.tool]];
        this.set({ brush: { size: b.size, opacity: b.opacity, steady: b.steady }, color: st.color });
      }),
    );
    s.setColor(this.state.color);
    this.unit = Math.max(this.board.w, this.board.h) / 620;
    // The brushes' sizes are for a 1024 board: a bigger board gets bigger brushes, a smaller one smaller.
    const k = Math.max(this.board.w, this.board.h) / 1024;
    if (!this.board.pixelArt && Math.abs(k - 1) > 0.05) {
      const brushes = s.toolState().brushes;
      for (const id of ['ink', 'pencil', 'marker', 'crayon', 'airbrush', 'eraser'] as const) s.setBrush({ size: Math.max(1, Math.round(brushes[id].size * k * 10) / 10) }, id);
    }
    const layers = s.layers();
    this.set({ ready: true, layers, active: s.activeLayer(), frames: s.frames(), frame: s.activeFrame(), zoom: Math.round(s.view().zoom * 100), drawn: this.drawnParts(layers), inked: s.inked(), canUndo: s.canUndo(), canRedo: s.canRedo() });
    if (this.state.mode === 'free') this.ensureFreehandLayers();
    this.applyTool(this.state.tool);
    this.renderGuidesNow();
    this.scheduleArt(0);
  }

  destroy(): void {
    this.destroyed = true;
    clearTimeout(this.guideTimer);
    clearTimeout(this.artTimer);
    clearTimeout(this.sizeTimer);
    this.stopPlay?.();
    for (const f of this.off) f();
    this.listeners.clear();
    this.eventListeners.clear();
    this.surface.destroy();
  }

  // ------------------------------------------------------------------------------------------ tools

  /** The pair tools draw on: the part on the bones, Lines and Colours in Freehand. */
  private pair(): PartLayers {
    if (this.state.mode === 'bones' && this.state.part) return this.state.parts[this.state.part] ?? pairIds(this.state.part);
    const ids = new Set(this.state.layers.map((l) => l.id));
    if (ids.has(FREEHAND_PAIR.lines) && ids.has(FREEHAND_PAIR.colors)) return FREEHAND_PAIR;
    const lines = [...this.state.layers].reverse().find((l) => l.role === 'lines')?.id ?? FREEHAND_PAIR.lines;
    const colors = [...this.state.layers].reverse().find((l) => l.role === 'colors')?.id ?? FREEHAND_PAIR.colors;
    return { lines, colors };
  }

  /** In Freehand, a layer the student picked themselves (not Lines or Colours) keeps getting the strokes. */
  private keepsOwnLayer(): boolean {
    if (this.state.mode === 'bones') return false;
    const a = this.state.layers.find((l) => l.id === this.surface.activeLayer());
    if (!a) return false;
    const p = this.pair();
    return a.id !== p.lines && a.id !== p.colors && a.role !== 'sketch' && a.role !== 'trace';
  }

  setTool(tool: DeskTool): void {
    if (!this.state.ready) {
      this.set({ tool });
      return;
    }
    this.stopFlipbook();
    this.set({ tool, picking: false });
    this.applyTool(tool);
    this.emit({ type: 'announce', text: t(`draw.tool_${tool}` as MessageKey) });
  }

  /** Points the surface at the tool and its layer. */
  private applyTool(tool: DeskTool): void {
    const s = this.surface;
    let engine: ToolId = TOOL_ENGINE[tool];
    if (tool === 'fill' && this.state.fill.lasso) engine = 'lassofill';
    if (tool === 'select') engine = this.state.select === 'box' ? 'select' : 'lasso';
    if (!this.keepsOwnLayer()) {
      const layer = targetLayer(tool as RoutedTool, this.pair(), this.lastTouched);
      if (this.state.layers.some((l) => l.id === layer)) s.selectLayer(layer);
    }
    s.setTool(engine);
    const b = s.toolState().brushes[BRUSH_OF[tool]];
    this.set({ active: s.activeLayer(), brush: { size: b.size, opacity: b.opacity, steady: b.steady } });
  }

  /** Alt held: the eyedropper until it is let go. */
  setPicking(on: boolean): void {
    if (!this.state.ready || on === this.state.picking) return;
    this.surface.setTool(on ? 'eyedropper' : TOOL_ENGINE[this.state.tool]);
    if (!on) this.applyTool(this.state.tool);
    this.set({ picking: on });
  }

  setColor(color: string, origin: ColorOrigin): void {
    this.surface.setColor(color);
    this.set({ color, origin, recent: pushRecent(this.state.recent, color) });
    if (this.state.picking) this.setPicking(false);
  }

  setSize(px: number): void {
    this.surface.setBrush({ size: px }, BRUSH_OF[this.state.tool]);
  }

  /** While the Size slider moves: the brush's size as a ring on the sheet, gone a moment after. */
  previewSize(): void {
    this.surface.previewBrush(BRUSH_OF[this.state.tool]);
    clearTimeout(this.sizeTimer);
    this.sizeTimer = window.setTimeout(() => this.surface.previewBrush(null), 900);
  }

  setOpacity(alpha: number): void {
    this.surface.setBrush({ opacity: alpha }, BRUSH_OF[this.state.tool]);
  }

  /** Steady for the current brush (0..1). */
  setSteadyAmount(amount: number): void {
    this.surface.setBrush({ steady: amount }, BRUSH_OF[this.state.tool]);
    this.set({ steady: amount > 0 });
  }

  /** The view bar's Steady: a pulled string on every brush, or back to what suits the pen, finger or mouse. */
  toggleSteady(on: boolean): void {
    for (const b of ['ink', 'pencil', 'marker', 'crayon', 'airbrush', 'eraser'] as const) this.surface.setBrush({ steady: on ? STEADY_ON : null }, b);
    this.set({ steady: on });
    this.applyTool(this.state.tool);
  }

  setFill(o: Partial<DeskState['fill']>): void {
    const fill = { ...this.state.fill, ...o };
    this.surface.setFillOptions({ gaps: fill.gaps });
    this.surface.setFill({ all: fill.all });
    this.set({ fill });
    if (this.state.tool === 'fill') this.applyTool('fill');
  }

  setShape(o: Partial<DeskState['shape']>): void {
    const shape = { ...this.state.shape, ...o };
    this.surface.setShape(shape);
    this.set({ shape });
  }

  setSelectMode(mode: 'lasso' | 'box'): void {
    this.set({ select: mode });
    if (this.state.tool === 'select') this.applyTool('select');
  }

  setEraserSoft(soft: boolean): void {
    this.surface.setEraserOptions({ soft });
    this.set({ eraserSoft: soft });
  }

  setTapToInk(on: boolean): void {
    this.surface.setTapToInk(on);
    this.set({ tapToInk: on });
  }

  setMirror(on: boolean): void {
    this.surface.setMirror(on ? { x: this.rig ? this.rig.anchor[0] : true } : null);
    this.set({ mirror: on });
  }

  setGuides(on: boolean): void {
    this.set({ guides: on });
    this.renderGuidesNow();
  }

  zoomBy(factor: number): void {
    this.surface.zoomBy(factor);
  }

  fit(): void {
    this.surface.fit();
  }

  async undo(): Promise<void> {
    await this.surface.undo();
  }

  async redo(): Promise<void> {
    await this.surface.redo();
  }

  async makePerfect(): Promise<boolean> {
    const ok = await this.surface.makePerfect();
    if (!ok) this.emit({ type: 'toast', text: t('draw.noPerfect') });
    return ok;
  }

  // ------------------------------------------------------------------------------------------ on the bones

  /** Parts that have ink (in either layer of their pair). */
  private drawnParts(layers: readonly LayerInfo[]): string[] {
    const inked = new Set(layers.filter((l) => !l.empty).map((l) => l.id));
    return Object.entries(this.state?.parts ?? {})
      .filter(([, p]) => inked.has(p.lines) || inked.has(p.colors))
      .map(([name]) => name);
  }

  /** Picks a step (never advanced by itself): its first part not drawn yet, or its first part. */
  setStep(index: number): void {
    const step = this.state.steps[index];
    if (!step) return;
    let part: string | null = step.parts.find((p) => !this.state.drawn.includes(p)) ?? step.parts[0] ?? null;
    if (step.step === 'extras' && !step.parts.length) part = this.addExtra();
    this.set({ step: index, part: part ?? this.state.part });
    if (this.state.mode === 'bones') {
      this.applyTool(this.state.tool);
      this.renderGuidesNow();
    }
  }

  /** Switches to the other part of this step (the other arm). */
  setPart(name: string): void {
    if (!this.state.parts[name]) return;
    const step = this.state.steps.findIndex((s) => s.parts.includes(name));
    this.set({ part: name, step: step >= 0 ? step : this.state.step });
    this.applyTool(this.state.tool);
    this.renderGuidesNow();
  }

  /** A new extra part (a hat, a tail, hair): a new pair on top, springy in the game. */
  addExtra(): string | null {
    const name = nextExtra(this.state.parts, this.state.layers.length);
    if (!name) {
      this.emit({ type: 'toast', text: t('draw.noMoreExtras') });
      return null;
    }
    const s = this.surface;
    const ids = pairIds(name);
    const top = this.state.layers.length;
    s.addLayer(`part:${name}`, { id: ids.colors, index: top, name: `${name} colours` });
    s.addLayer('lines', { id: ids.lines, index: top + 1, name: `${name} lines` });
    const parts = { ...this.state.parts, [name]: ids };
    const steps = this.state.steps.map((st) => (st.step === 'extras' ? { ...st, parts: [...st.parts, name] } : st));
    this.set({ parts, steps, layers: s.layers() });
    return name;
  }

  /** Mirrors the part being drawn onto the other side (arms, legs, wings), replacing it. */
  copyToOtherSide(): boolean {
    const from = this.state.part;
    const to = from ? otherSide(from) : null;
    if (!from || !to || !this.rig) return false;
    const a = this.state.parts[from];
    const b = this.state.parts[to];
    if (!a || !b) return false;
    if (!this.state.drawn.includes(from)) {
      this.emit({ type: 'toast', text: t('draw.nothingToCopy') });
      return false;
    }
    const root = (part: string): [number, number] => {
      const bone = this.rig?.bones.find((x) => (this.partBones[part] ?? []).includes(x.name));
      return bone ? [bone.x, bone.y] : [0, 0];
    };
    const m = mirrorMatrix(root(from), root(to), this.rig.anchor[0], this.request.facing === 'viewer' || this.request.rig !== 'quadruped');
    const ok = this.surface.copyLayers(
      [
        [a.colors, b.colors],
        [a.lines, b.lines],
      ],
      m,
    );
    if (ok) this.emit({ type: 'toast', text: t('draw.copiedOther') });
    return ok;
  }

  /** On the bones or Freehand (the parts drawn so far stay as layers either way). */
  setMode(mode: DeskMode): void {
    if (mode === this.state.mode) return;
    if (mode === 'bones' && !this.ensureBonesLayers()) return;
    this.set({ mode, part: mode === 'bones' ? (this.state.part ?? this.state.steps[this.state.step]?.parts[0] ?? null) : null });
    if (mode === 'free') this.ensureFreehandLayers();
    this.applyTool(this.state.tool);
    this.renderGuidesNow();
    this.scheduleArt(0);
  }

  /**
   * Drawing on the bones needs a layer pair per part: a drawing begun in Freehand gets them under its own
   * layers (what was drawn stays on top). False when they do not fit.
   */
  private ensureBonesLayers(): boolean {
    if (Object.keys(this.state.parts).length) return true;
    const kind = this.state.kind;
    if (kind === 'none' || kind === 'object') return false;
    const layout = bonesLayout(kind, rigFacing(this.state.facing));
    const s = this.surface;
    if (s.layers().length + layout.layers.length > 16) {
      this.emit({ type: 'toast', text: t('draw.tooManyLayers') });
      return false;
    }
    const colours = s.layers().findIndex((l) => l.id === FREEHAND_PAIR.colors || l.role === 'colors');
    let at = colours >= 0 ? colours : s.layers().length;
    const active = s.activeLayer();
    for (const l of layout.layers) {
      if (s.layers().some((x) => x.id === l.id)) continue;
      if (s.addLayer(l.role, { id: l.id, index: at, name: l.name })) at++;
    }
    s.selectLayer(active);
    const step = Math.max(0, this.state.steps.findIndex((st) => st.parts.length > 0));
    this.set({ parts: layout.parts, layers: s.layers(), step, part: this.state.steps[step]?.parts[0] ?? null });
    return true;
  }

  /** "What is it?" for a free drawing (in Freehand): its kind and facing, so its guide and bones fit. */
  setKind(kind: CharacterKind, facing: Facing): void {
    if (kind === this.state.kind && facing === this.state.facing) return;
    this.request = { ...this.request, rig: kind, facing };
    this.rig = templateOnBoard(this.board, this.request);
    const ps = partSteps(kind, rigFacing(facing));
    const partBones: Record<string, string[]> = {};
    for (const st of ps) for (const p of st.parts) partBones[p.name] = p.bones;
    this.partBones = partBones;
    const keep = Object.keys(this.state.parts).length > 0;
    const steps: BonesStep[] = keep ? this.state.steps : ps.map((st) => ({ step: st.step, parts: st.parts.map((p) => p.name) }));
    this.set({ kind, facing, steps, step: keep ? this.state.step : 0 });
    this.renderGuidesNow();
    this.scheduleArt(0);
  }

  /** Freehand needs its Lines and Colours layers; a drawing begun on the bones gets them on top. */
  private ensureFreehandLayers(): void {
    const s = this.surface;
    const has = (id: string): boolean => s.layers().some((l) => l.id === id);
    if (has(FREEHAND_PAIR.lines) && has(FREEHAND_PAIR.colors)) return;
    if (!s.layers().some((l) => l.role === 'lines' && !partOfLayer(this.state.parts, l.id)) || !has(FREEHAND_PAIR.lines)) {
      const n = s.layers().length;
      if (!has(FREEHAND_PAIR.colors)) s.addLayer('colors', { id: FREEHAND_PAIR.colors, index: n, name: 'Colours' });
      if (!has(FREEHAND_PAIR.lines)) s.addLayer('lines', { id: FREEHAND_PAIR.lines, index: s.layers().length, name: 'Lines' });
    }
    this.set({ layers: s.layers() });
  }

  // ------------------------------------------------------------------------------------------ layers

  selectLayer(id: string): void {
    this.surface.selectLayer(id);
    const part = partOfLayer(this.state.parts, id);
    if (this.state.mode === 'bones' && part && part !== this.state.part) this.setPart(part);
    this.set({ active: id });
  }

  setLayerVisible(id: string, visible: boolean): void {
    this.surface.setLayer(id, { visible });
  }

  setLayerLocked(id: string, locked: boolean): void {
    this.surface.setLayer(id, { locked });
  }

  /** Opacity, blend, lock and alpha lock of a layer (undoable in the engine). */
  setLayerProps(id: string, patch: Partial<Pick<LayerInfo, 'opacity' | 'blend' | 'locked' | 'alphaLock'>>): void {
    const p = { ...patch };
    if (p.opacity !== undefined) p.opacity = Math.max(0, Math.min(1, p.opacity));
    this.surface.setLayer(id, p);
  }

  renameLayer(id: string, name: string): void {
    this.surface.setLayer(id, { name: name.trim().slice(0, 40) });
  }

  /** + New: Shading (multiply, over the colours) or a plain layer. */
  addLayer(kind: 'shading' | 'plain'): void {
    const layers = this.surface.layers();
    const lines = layers.findIndex((l) => l.id === this.pair().lines);
    const index = lines >= 0 ? lines : layers.length;
    const id = this.surface.addLayer('paint', kind === 'shading' ? { name: 'Shading', blend: 'multiply', index } : { name: 'Layer', index });
    if (id) this.set({ active: id });
  }

  moveLayer(id: string, delta: number): void {
    const i = this.surface.layers().findIndex((l) => l.id === id);
    if (i >= 0) this.surface.moveLayer(id, Math.max(0, i + delta));
  }

  duplicateLayer(id: string): void {
    this.surface.duplicateLayer(id);
  }

  async mergeDown(id: string): Promise<void> {
    await this.surface.mergeDown(id);
  }

  removeLayer(id: string): void {
    this.surface.removeLayer(id);
  }

  // ------------------------------------------------------------------------------------------ selection

  flipSelection(axis: 'h' | 'v'): void {
    this.surface.flipSelection(axis);
  }

  turnSelection(deg: number): void {
    const s = this.surface.selection();
    if (!s) return;
    this.surface.transformSelection({ rot: s.transform.rot + (deg * Math.PI) / 180 });
  }

  commitSelection(): void {
    this.surface.commitSelection();
  }

  deleteSelection(): void {
    this.surface.deleteSelection();
  }

  /** "Make it a part": the selection onto a new part layer named by the student's pick. */
  selectionToPart(name: string): string | null {
    return this.surface.selectionToPart(name);
  }

  // ------------------------------------------------------------------------------------------ flipbook

  async addFrame(copy: boolean): Promise<void> {
    await this.surface.addFrame({ copy });
  }

  async selectFrame(id: string): Promise<void> {
    this.stopFlipbook();
    await this.surface.selectFrame(id);
  }

  removeFrame(id: string): void {
    this.surface.removeFrame(id);
  }

  setOnion(on: boolean): void {
    this.surface.setOnionSkin(on);
    this.set({ onion: on });
  }

  async playFlipbook(fps: number): Promise<void> {
    this.stopFlipbook();
    this.stopPlay = await this.surface.playFrames(fps);
    this.set({ playing: true });
  }

  /** "Pages for …" and how fast the pages go. */
  setFlip(o: Partial<DeskState['flip']>): void {
    const flip = { ...this.state.flip, ...o };
    flip.fps = Math.max(4, Math.min(12, Math.round(flip.fps)));
    this.set({ flip });
    if (this.stopPlay) void this.playFlipbook(flip.fps);
  }

  stopFlipbook(): void {
    if (!this.stopPlay) return;
    this.stopPlay();
    this.stopPlay = null;
    this.set({ playing: false });
  }

  // ------------------------------------------------------------------------------------------ events

  private onPenUp(e: { op: string; layer: string | null }): void {
    if (e.op === 'stroke' && e.layer && this.state.tool !== 'eraser') this.lastTouched = e.layer;
    const drawnBefore = this.state.drawn.join(',');
    const layers = this.surface.layers();
    const drawn = this.drawnParts(layers);
    this.set({ layers, drawn });
    // A part got its first ink: its ghost shape goes away.
    if (drawn.join(',') !== drawnBefore) this.scheduleGuides();
    this.emit({ type: 'penup', layer: e.layer, op: e.op });
    this.scheduleArt();
  }

  private onToast(e: { message: string; kind: string; shape?: string; gap?: number }): void {
    let text: string;
    if (e.kind === 'shape' && e.shape) text = t(`draw.perfect_${e.shape}` as MessageKey);
    else if (e.kind === 'fill' && e.gap) text = t('draw.fillGap');
    else if (/change all/i.test(e.message)) text = t('draw.fillAllNone');
    else if (/all the way around/i.test(e.message)) text = t('draw.lassoAround');
    else if (e.kind === 'fill') text = t('draw.fillTapInside');
    else if (/locked/i.test(e.message)) text = t('draw.layerLocked');
    else if (/hidden/i.test(e.message)) text = t('draw.layerHidden');
    else if (e.kind === 'limit') text = /page/i.test(e.message) ? t('draw.pageLimit') : t('draw.tooManyLayers');
    else return;
    this.emit({ type: 'toast', text });
  }

  // ------------------------------------------------------------------------------------------ previews

  /**
   * Follows the preview export (the In-your-world card, It already moves!, the pivot pin): `fn` gets the
   * latest now (when there is one) and each new one. Exports run only while someone follows them.
   */
  watchArt(fn: (art: DeskArt | null) => void): () => void {
    const off = this.onEvent((e) => {
      if (e.type === 'art') fn(e.art);
    });
    this.artWanted++;
    if (this.artDone === this.artSeq) fn(this.lastArt);
    else this.scheduleArt(0);
    return () => {
      off();
      this.artWanted--;
    };
  }

  /** The latest preview export (null when nothing is drawn, or none was made yet). */
  art(): DeskArt | null {
    return this.lastArt;
  }

  /** Something changed: a new preview export 400 ms from now (the spec's pen-up debounce). */
  private scheduleArt(delay = 400): void {
    if (this.destroyed) return;
    if (delay > 0 || this.artDone === this.artSeq) this.artSeq++;
    if (!this.artWanted || !this.state.ready) return;
    clearTimeout(this.artTimer);
    this.artTimer = window.setTimeout(() => void this.makeArt(), delay);
  }

  private async makeArt(): Promise<void> {
    if (this.destroyed || !this.artWanted || this.artDone === this.artSeq) return;
    // Never while drawing or while a selection is lifted (exporting would put it down).
    if (this.artBusy || this.pen || this.state.selection) {
      clearTimeout(this.artTimer);
      this.artTimer = window.setTimeout(() => void this.makeArt(), 250);
      return;
    }
    const seq = this.artSeq;
    const mode = this.state.mode;
    this.artBusy = true;
    try {
      const pairs = mode === 'bones' ? this.state.drawn.map((name) => ({ name, layers: [this.state.parts[name].colors, this.state.parts[name].lines] })) : [];
      const e = await this.surface.export({ maxSize: PREVIEW_MAX, thumbSize: 16, flatOnly: true, ...(pairs.length ? { pairs } : {}) });
      if (this.destroyed) return;
      this.artDone = seq;
      this.lastArt = e ? { flat: e.flat.png, w: e.flat.w, h: e.flat.h, box: e.box, scale: e.scale, anchorBoard: e.anchorBoard, parts: e.parts.map((p) => ({ name: p.name, png: p.png })), mode } : null;
      this.set({ pin: e ? e.anchorBoard : null });
      this.emit({ type: 'art', art: this.lastArt });
    } catch (err) {
      console.warn('The preview could not update:', err);
      this.artDone = seq;
    } finally {
      this.artBusy = false;
      if (!this.destroyed && this.artDone !== this.artSeq) this.scheduleArt(0);
    }
  }

  /** Moves the pivot pin (board px), or lets it follow the drawing again (null). */
  setPin(p: [number, number] | null): void {
    const clamped: [number, number] | null = p ? [Math.round(Math.min(this.board.w, Math.max(0, p[0]))), Math.round(Math.min(this.board.h, Math.max(0, p[1])))] : null;
    this.surface.setAnchor(clamped);
    this.set({ pin: clamped ?? this.state.pin, pinPlaced: clamped !== null });
    this.scheduleArt(clamped ? 400 : 0);
  }

  /** Freehand's star-pose guide on or off. */
  setStarPose(on: boolean): void {
    this.set({ starPose: on });
    this.renderGuidesNow();
  }

  /**
   * Where the joints are, for Bring to life (board px): on the bones, the template's joints and tips (the
   * parts were drawn on them); in Freehand over the star-pose guide, its joints.
   */
  rigHints(): { partHints: { joints: JointHints; tips: JointHints } | null; guideHints: JointHints | null } {
    if (!this.rig) return { partHints: null, guideHints: null };
    const h = templateHints(this.rig);
    if (this.state.mode === 'bones') return { partHints: h, guideHints: null };
    const overGuide = this.state.guides && this.state.starPose && this.request.kind === 'character';
    return { partHints: null, guideHints: overGuide ? h.joints : null };
  }

  // ------------------------------------------------------------------------------------------ guides

  private scheduleGuides(): void {
    clearTimeout(this.guideTimer);
    this.guideTimer = window.setTimeout(() => this.renderGuidesNow(), 60);
  }

  /** The template skeleton on the board (the bones to draw on, the star pose, the rig's hints). */
  template(): RigData | null {
    return this.rig;
  }

  renderGuidesNow(): void {
    if (!this.state.ready || this.destroyed) return;
    const s = this.surface;
    if (!this.state.guides) {
      s.setGuide(null);
      return;
    }
    const r = this.request;
    const part = this.state.part;
    const currentBones = this.state.mode === 'bones' && part ? (this.partBones[part] ?? []) : [];
    const drawnBones = new Set(this.state.drawn.flatMap((p) => this.partBones[p] ?? []));
    const labels: GuideLabels = {
      ground: t('draw.guideGround'),
      floats: t('draw.guideFloats'),
      faces: t('draw.guideFaces'),
      facesYou: t('draw.guideFacesYou'),
      forSize: t('draw.guideForSize', { hero: r.hero?.name ?? '' }),
      door: t('draw.guideDoor'),
      repeats: t('draw.guideRepeats'),
      callout: this.state.mode === 'bones' && part ? t(`draw.callout_${calloutOf(part)}` as MessageKey) : null,
      starNote: t('draw.starNote', { name: r.name }),
    };
    const starPose = this.state.starPose && this.state.mode === 'free' && r.kind === 'character' && r.rig !== 'none' && r.rig !== 'object';
    const images = renderGuides(
      { board: this.board, request: r, mode: this.state.mode, starPose, currentBones, drawnBones, heroImage: this.heroImage, labels, unit: this.unit },
      this.rig,
    );
    const box = { x: 0, y: 0, w: this.board.w, h: this.board.h };
    s.setGuide({ silhouette: { image: images.below, box, opacity: 1 }, above: images.above ? { image: images.above, box, opacity: 1 } : null });
  }

  // ------------------------------------------------------------------------------------------ keyboard

  /**
   * The Desk's single keys while the paper has focus (§7.2): tools, `[` `]` size, 1-9 and 0 opacity, X swap
   * with the last colour, F fit, `,` `.` pages. Returns true when the key was used.
   */
  onKey(e: KeyboardEvent): boolean {
    if (e.ctrlKey || e.metaKey || e.altKey) return false;
    const k = e.key.toLowerCase();
    const tool = TOOL_KEYS[k];
    if (tool && !this.board.pixelArt) {
      this.setTool(tool);
      return true;
    }
    if (k === 'i') {
      this.setPicking(true);
      return true;
    }
    if (k === '[' || k === ']') {
      const size = this.state.brush.size;
      this.setSize(this.board.pixelArt ? size + (k === ']' ? 1 : -1) : size * (k === ']' ? 1.2 : 1 / 1.2));
      return true;
    }
    if (/^[0-9]$/.test(k)) {
      this.setOpacity(k === '0' ? 1 : Number(k) / 10);
      return true;
    }
    if (k === 'x' && this.state.recent.length > 1) {
      this.setColor(this.state.recent[1], 'recent');
      return true;
    }
    if (k === 'f') {
      this.fit();
      return true;
    }
    if (k === ',' || k === '.') {
      const i = this.state.frames.findIndex((f) => f.id === this.state.frame) + (k === ',' ? -1 : 1);
      const f = this.state.frames[i];
      if (f) void this.selectFrame(f.id);
      return true;
    }
    return false;
  }
}

/** Which callout a part gets ("Draw an arm on this bone"). */
export function calloutOf(part: string): string {
  if (/^arm/.test(part)) return 'arm';
  if (/^leg/.test(part)) return 'leg';
  if (/^wing/.test(part)) return 'wing';
  if (/^extra/.test(part)) return 'extra';
  if (part === 'tail' || part === 'head' || part === 'torso' || part === 'body') return part;
  return 'extra';
}
