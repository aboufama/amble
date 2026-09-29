/**
 * The saved art model (`ArtDoc`) and the stroke-script format (`ArtScript`). Leaf module: types, limits and
 * small helpers only.
 */
import type { BrushId } from './brushes';

export type ArtKind = 'character' | 'projectile' | 'item' | 'prop' | 'terrain' | 'background' | 'decor';
export type RigKind = 'biped' | 'quadruped' | 'blob' | 'flyer' | 'swimmer' | 'object';

/**
 * Layer roles. lines: ink, on top, the walls for "fill under the lines" and the rigger's ink mask.
 * colors: where fills land, under the lines. sketch: never exported. part:<name>: a body part for rigging.
 * trace: a photo to trace, never exported. paint: anything else (shading, effects).
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
  /** How many ticks (at 12 fps) the frame shows in a flipbook. */
  hold: number;
}

/** One non-empty (frame, layer) picture: a lossless PNG trimmed to its content, placed at (x, y) on the board. */
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
  rig?: RigKind;
  /** Board size in px. */
  width: number;
  height: number;
  pixelArt: boolean;
  /** Bottom to top. */
  layers: ArtLayer[];
  /** At least one; frames[0] is the base drawing. */
  frames: ArtFrame[];
  /** Missing (frame, layer) pairs are empty. */
  cels: ArtCel[];
  /** Anchor (pivot) override in board px; null = automatic for the kind (feet for characters). */
  anchor: [number, number] | null;
  /** Colours used, most used first (at most 24). */
  palette: string[];
  /** The stroke log, encoded and deflate-compressed (time-lapse and recovery); null when not recorded. */
  strokeLog: Blob | null;
  created: number;
  updated: number;
  /** Bumped on every saved change. */
  version: number;
}

/** Stroke data for art drawn in Amble by script (the starter examples). Replayed by `replayArtScript`. */
export interface ArtScript {
  v: 1;
  /** e.g. 'hero-pip' */
  name: string;
  kind: ArtKind;
  rig?: RigKind;
  /** Canvas size in px, e.g. 256x256 (characters), 960x540 (backgrounds). */
  width: number;
  height: number;
  /** Bottom to top. */
  layers: { id: string; role: 'lines' | 'colors' | 'sketch' | 'paint' | `part:${string}`; name?: string }[];
  /** In drawing order (a time-lapse replays them). */
  ops: ArtOp[];
  /** Optional pivot override (feet), in canvas px. */
  anchor?: [number, number];
}

export type ScriptBrush = 'ink' | 'pencil' | 'marker' | 'crayon' | 'airbrush' | 'eraser' | 'pixel';

export type ArtOp =
  | {
      op: 'stroke';
      layer: string;
      brush: ScriptBrush;
      size: number;
      color: string;
      opacity?: number;
      /** Stabilizer 0..1. */
      steady?: number;
      /** [x, y, pressure 0..1], canvas px. */
      points: [number, number, number][];
      /** ms between points (default 8), for speed and taper. */
      dt?: number;
    }
  | {
      op: 'fill';
      layer: string;
      x: number;
      y: number;
      color: string;
      tolerance?: number;
      /** Bounded by the 'lines' layers. */
      underLines?: boolean;
    }
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

/** Budgets for a 4 GB Chromebook. */
export const LIMITS = {
  /** Longest board side, px. */
  maxBoard: 2048,
  /** Layers per drawing (16 when it has part layers, for rigging templates). */
  maxLayers: 12,
  maxLayersWithParts: 16,
  /** Flipbook frames per drawing. */
  maxFrames: 24,
  /** Undo history, bytes (tiles; compressed in a worker when idle). */
  historyBytes: 96 * 1024 * 1024,
  /** Uncompressed cel pixels kept resident before idle frames are packed, bytes. */
  residentCelBytes: 128 * 1024 * 1024,
  /** Stroke log samples before the log stops recording (about 4 MB). */
  logSamples: 400_000,
} as const;

export const EXPORTED_ROLES = (role: LayerRole): boolean => role !== 'sketch' && role !== 'trace';

export function isPartRole(role: string): role is `part:${string}` {
  return role.startsWith('part:') && role.length > 5;
}

export function partName(role: LayerRole): string | null {
  return isPartRole(role) ? role.slice(5) : null;
}

export function isLayerRole(s: unknown): s is LayerRole {
  return typeof s === 'string' && (s === 'lines' || s === 'colors' || s === 'sketch' || s === 'paint' || s === 'trace' || (isPartRole(s) && /^part:[A-Za-z0-9_-]{1,32}$/.test(s)));
}

export const ART_KINDS: readonly ArtKind[] = ['character', 'projectile', 'item', 'prop', 'terrain', 'background', 'decor'];
export const RIG_KINDS: readonly RigKind[] = ['biped', 'quadruped', 'blob', 'flyer', 'swimmer', 'object'];

export function defaultLayerName(role: LayerRole): string {
  if (isPartRole(role)) return role.slice(5);
  return { lines: 'Lines', colors: 'Colors', sketch: 'Sketch', paint: 'Paint', trace: 'Trace' }[role];
}

export function makeLayer(id: string, role: LayerRole, name?: string): ArtLayer {
  return {
    id,
    name: name ?? defaultLayerName(role),
    role,
    visible: true,
    locked: role === 'trace',
    opacity: role === 'sketch' ? 0.4 : role === 'trace' ? 0.3 : 1,
    blend: 'normal',
    alphaLock: false,
  };
}

/** Script brushes are the engine's brushes. */
export const scriptBrush = (b: ScriptBrush): BrushId => b;

let counter = 0;
/** A short unique id (12 chars, base36). */
export function uid(prefix = ''): string {
  counter = (counter + 1) % 1296;
  const rnd = Math.floor(Math.random() * 36 ** 6).toString(36).padStart(6, '0');
  return prefix + Date.now().toString(36).slice(-4) + counter.toString(36).padStart(2, '0') + rnd;
}
