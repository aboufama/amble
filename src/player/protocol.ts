/**
 * Types shared by the editor and the sandboxed game player (iframe).
 * Everything here must be structured-clone friendly (it goes through postMessage).
 */

export type WorldMode = '2d' | '3d';

export type RotationStyleName = 'all around' | 'left-right' | "don't rotate";

export interface RunCostume {
  name: string;
  /** A bitmap or SVG image. */
  kind: 'image';
  /** Data URL of the image. */
  url: string;
  isVector: boolean;
  /** Image pixels per stage unit (Scratch stores bitmaps at 2). */
  resolution: number;
  /** Rotation center in image pixels. */
  centerX: number;
  centerY: number;
  width: number;
  height: number;
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
  | { type: 'load'; pkg: RunPackage; start: boolean }
  | { type: 'greenFlag' }
  | { type: 'stop' }
  | { type: 'key'; phase: 'down' | 'up'; key: string; code: string }
  | { type: 'releaseKeys' }
  /** The mouse button went up in the editor (it may not reach the player while it drags a sprite). */
  | { type: 'pointerUp' };

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
  | { type: 'log'; level: 'log' | 'warn' | 'error'; message: string }
  /** A sprite was dragged to a new place on the stopped stage (editor only, 2D). */
  | { type: 'spriteMoved'; name: string; x: number; y: number };

export const CHANNEL = 'amble-player';
