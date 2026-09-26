/**
 * Types shared by the editor and the sandboxed game player (iframe).
 * Everything here must be structured-clone friendly (it goes through postMessage).
 */

export type WorldMode = '2d' | '3d';

export type RotationStyleName = 'all around' | 'left-right' | "don't rotate";

export type PartShape = 'box' | 'sphere' | 'cylinder' | 'cone' | 'torus' | 'capsule';

/** One primitive of an AI-made ("compiled") 3D model. Sizes/positions are in world units (1 unit ≈ 1 meter). */
export interface ModelPart {
  shape: PartShape;
  /** Bounding size of the part: [width (x), height (y), depth (z)]. */
  size: [number, number, number];
  /** Center of the part relative to the model origin. The origin is the model's feet (y = 0 is the bottom). */
  position: [number, number, number];
  /** Euler rotation in degrees [x, y, z]. */
  rotation: [number, number, number];
  color: string;
  roughness: number;
  metalness: number;
  /** 0..1, how much the part glows in its own color. */
  emissive: number;
  /** 0..1 */
  opacity: number;
}

export interface ModelRecipe {
  parts: ModelPart[];
}

export interface RunCostume {
  name: string;
  /** 'image' = bitmap/SVG costume (a flat cutout in 3D); 'model' = 3D model (3D mode only). */
  kind: 'image' | 'model';
  /** Data URL of the image, or of a .glb file for uploaded models. Empty for recipe models. */
  url: string;
  isVector: boolean;
  /** Image pixels per stage unit (Scratch stores bitmaps at 2). */
  resolution: number;
  /** Rotation center in image pixels. */
  centerX: number;
  centerY: number;
  width: number;
  height: number;
  recipe?: ModelRecipe;
}

export interface RunSound {
  name: string;
  url: string;
}

export interface RunTarget {
  kind: 'stage' | 'sprite';
  name: string;
  /** Name of the class declared by `code`, or null when this target has no compiled code. */
  className: string | null;
  /** Compiled (and instrumented) JavaScript for this target. */
  code: string | null;
  costumes: RunCostume[];
  sounds: RunSound[];
  /** 1-based, like Scratch. */
  costumeNumber: number;
  x: number;
  y: number;
  z: number;
  size: number;
  direction: number;
  visible: boolean;
  rotationStyle: RotationStyleName;
  layerOrder: number;
}

export interface RunPackage {
  mode: WorldMode;
  title: string;
  targets: RunTarget[];
}

export const STAGE_WIDTH = 480;
export const STAGE_HEIGHT = 360;

/** Messages the editor sends to the player. */
export type ToPlayer =
  | { type: 'init'; havokWasm: ArrayBuffer }
  | { type: 'load'; pkg: RunPackage; start: boolean }
  | { type: 'greenFlag' }
  | { type: 'stop' }
  | { type: 'key'; phase: 'down' | 'up'; key: string; code: string }
  | { type: 'releaseKeys' };

export interface PlayerError {
  message: string;
  target?: string;
  script?: string;
  /** 1-based line in the target's compiled code, when known. */
  line?: number;
  phase: 'load' | 'run';
}

/** Messages the player sends to the editor. */
export type FromPlayer =
  | { type: 'hello' }
  | { type: 'loaded' }
  | { type: 'status'; state: 'idle' | 'running' | 'paused' | 'stopped' }
  | ({ type: 'error' } & PlayerError)
  | { type: 'log'; level: 'log' | 'warn' | 'error'; message: string };

export const CHANNEL = 'amble-player';
