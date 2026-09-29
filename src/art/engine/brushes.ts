/**
 * Brush presets. Parameters match the editor probe's brushes, so stroke data previewed there replays the
 * same here. Sizes are in document pixels (tuned on a 1024 board).
 */
export type BrushId = 'ink' | 'pencil' | 'marker' | 'crayon' | 'airbrush' | 'eraser' | 'pixel';

export const BRUSH_IDS: readonly BrushId[] = ['ink', 'pencil', 'marker', 'crayon', 'airbrush', 'eraser', 'pixel'];

/** How a finished stroke combines with its layer: normal paint, multiply (marker), or erase. */
export type StrokeBlend = 'over' | 'multiply' | 'erase';

export interface Brush {
  id: BrushId;
  label: string;
  /** capsule: SDF pieces with max-union; dab: accumulating soft dabs; pixel: hard squares, no smoothing. */
  kind: 'capsule' | 'dab' | 'pixel';
  /** Diameter in document px at full pressure. */
  size: number;
  /** Width fraction at zero pressure. */
  minWidth: number;
  pressureWidth: boolean;
  /** Pressure curve exponent (<1 = easier to get a full line). */
  gamma: number;
  /** How much speed thins the line when there is no real pressure (mouse, trackpad, finger). */
  thinning: number;
  /** Tapers, in multiples of size: without real pressure / with a pen. */
  taperStart: number;
  taperEnd: number;
  penTaperStart: number;
  penTaperEnd: number;
  /** Stroke opacity (the whole stroke, applied once, so overlaps inside one stroke never darken). */
  opacity: number;
  blend: StrokeBlend;
  texture?: 'pencil' | 'crayon';
  /** Dab brushes: flow per dab and spacing as a fraction of the radius. */
  flow?: number;
  spacing?: number;
  /** 1-euro filter: min cutoff (Hz) and speed coefficient. */
  euro: [number, number];
}

const ink: Brush = {
  id: 'ink',
  label: 'Ink',
  kind: 'capsule',
  size: 7,
  minWidth: 0.16,
  pressureWidth: true,
  gamma: 0.85,
  thinning: 0.5,
  taperStart: 1.4,
  taperEnd: 2.8,
  penTaperStart: 0.7,
  penTaperEnd: 1.2,
  opacity: 1,
  blend: 'over',
  euro: [3.2, 0.035],
};

export const BRUSHES: Readonly<Record<BrushId, Brush>> = {
  ink,
  pencil: {
    ...ink,
    id: 'pencil',
    label: 'Pencil',
    texture: 'pencil',
    size: 3.4,
    minWidth: 0.6,
    gamma: 1,
    thinning: 0.25,
    taperStart: 1.2,
    taperEnd: 2.4,
    penTaperStart: 0.6,
    penTaperEnd: 1,
  },
  marker: {
    ...ink,
    id: 'marker',
    label: 'Marker',
    size: 26,
    minWidth: 0.78,
    gamma: 1,
    thinning: 0.12,
    taperStart: 0,
    taperEnd: 0,
    penTaperStart: 0,
    penTaperEnd: 0,
    opacity: 0.5,
    blend: 'multiply',
    euro: [2.5, 0.03],
  },
  crayon: {
    ...ink,
    id: 'crayon',
    label: 'Crayon',
    texture: 'crayon',
    size: 16,
    minWidth: 0.62,
    gamma: 1,
    thinning: 0.15,
    taperStart: 0.35,
    taperEnd: 0.5,
    penTaperStart: 0.25,
    penTaperEnd: 0.35,
  },
  airbrush: {
    ...ink,
    id: 'airbrush',
    label: 'Airbrush',
    kind: 'dab',
    size: 90,
    minWidth: 0.7,
    thinning: 0,
    taperStart: 0,
    taperEnd: 0,
    penTaperStart: 0,
    penTaperEnd: 0,
    flow: 0.035,
    spacing: 0.08,
  },
  eraser: {
    ...ink,
    id: 'eraser',
    label: 'Eraser',
    size: 24,
    minWidth: 0.55,
    thinning: 0.1,
    taperStart: 0,
    taperEnd: 0,
    penTaperStart: 0,
    penTaperEnd: 0,
    blend: 'erase',
  },
  pixel: {
    ...ink,
    id: 'pixel',
    label: 'Pixel pen',
    kind: 'pixel',
    size: 1,
    minWidth: 1,
    pressureWidth: false,
    thinning: 0,
    taperStart: 0,
    taperEnd: 0,
    penTaperStart: 0,
    penTaperEnd: 0,
  },
};

/** The soft eraser: the airbrush's dab shape, erasing. */
const SOFT_ERASER: Brush = { ...BRUSHES.airbrush, id: 'eraser', label: 'Soft eraser', blend: 'erase', size: 60, flow: 0.08 };

export interface BrushOverrides {
  size?: number;
  opacity?: number;
  /** Eraser only: soft (airbrush-shaped) instead of hard. */
  soft?: boolean;
}

export const SIZE_LIMITS: Readonly<Record<BrushId, [number, number]>> = {
  ink: [0.5, 200],
  pencil: [0.5, 200],
  marker: [1, 300],
  crayon: [1, 300],
  airbrush: [2, 600],
  eraser: [1, 600],
  pixel: [1, 8],
};

export function isBrushId(s: unknown): s is BrushId {
  return typeof s === 'string' && (BRUSH_IDS as readonly string[]).includes(s);
}

/** A brush preset with the UI's size and opacity applied. */
export function brushFor(id: BrushId, o: BrushOverrides = {}): Brush {
  const base = id === 'eraser' && o.soft ? SOFT_ERASER : BRUSHES[id];
  const [lo, hi] = SIZE_LIMITS[id];
  const size = o.size === undefined || !Number.isFinite(o.size) ? base.size : Math.min(hi, Math.max(lo, o.size));
  const opacity = o.opacity === undefined || !Number.isFinite(o.opacity) ? base.opacity : Math.min(1, Math.max(0.01, o.opacity));
  return { ...base, size: id === 'pixel' ? Math.round(size) : size, opacity };
}

/** Pulled-string radius (screen px) for Steady = 1. */
export const STEADY_MAX_PX = 30;

/** Default Steady by input: pens are steady already; fingers and trackpads are not. */
export function defaultSteady(input: 'pen' | 'touch' | 'mouse'): number {
  return input === 'pen' ? 0 : input === 'touch' ? 4 / STEADY_MAX_PX : 6 / STEADY_MAX_PX;
}
