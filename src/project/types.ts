import type { ModelRecipe, RotationStyleName, WorldMode } from '../player/protocol';

export type { ModelRecipe, RotationStyleName, WorldMode };

/** A bitmap or SVG image (costume or backdrop). */
export interface ImageAsset {
  id: string;
  name: string;
  kind: 'image';
  dataUrl: string;
  mime: string;
  /** Natural size in pixels. */
  width: number;
  height: number;
  /** Image pixels per stage unit (2 for crisp bitmaps, 1 for SVG). */
  resolution: number;
  /** Rotation center in image pixels. */
  centerX: number;
  centerY: number;
  description?: string;
}

/** A 3D model: an uploaded .glb or an AI-made primitive recipe. */
export interface ModelAsset {
  id: string;
  name: string;
  kind: 'model';
  /** .glb as a data URL (uploaded models). */
  dataUrl?: string;
  /** Primitive parts (compiled models). */
  recipe?: ModelRecipe;
  /** Preview image (PNG data URL). */
  thumbnail?: string;
  description?: string;
}

export type CostumeAsset = ImageAsset | ModelAsset;

export interface SoundAsset {
  id: string;
  name: string;
  kind: 'sound';
  dataUrl: string;
  mime: string;
  /** Seconds. */
  duration: number;
  description?: string;
}

export type Asset = CostumeAsset | SoundAsset;

/** Blockly's JSON workspace serialization. */
export type BlocksState = Record<string, unknown>;

interface TargetBase {
  id: string;
  name: string;
  /** What this sprite is / what it's for, in the author's words. */
  description: string;
  costumes: CostumeAsset[];
  sounds: SoundAsset[];
  /** Index of the current costume/backdrop. */
  currentCostume: number;
  blocks: BlocksState | null;
}

export interface StageTarget extends TargetBase {
  kind: 'stage';
}

export interface SpriteTarget extends TargetBase {
  kind: 'sprite';
  /** Variables "for this sprite only" (Make a Variable). */
  variables?: string[];
  x: number;
  y: number;
  /** 3D only. */
  z: number;
  size: number;
  /** 2D: angle in degrees counter-clockwise (0 = right). 3D: heading (0 = away from the camera). */
  direction: number;
  visible: boolean;
  rotationStyle: RotationStyleName;
}

export type Target = StageTarget | SpriteTarget;

/** An asset the compiler (AI) made because the game needed it. */
export type CompiledAsset = (ImageAsset | ModelAsset | SoundAsset) & {
  /** Owner: a user sprite/stage id, or a compiled sprite id. */
  targetId: string;
  /** Owner name at compile time. */
  targetName: string;
  /** What the compiler asked for (used to reuse the asset in later compiles). */
  request: string;
};

/** A sprite the compiler added (e.g. enemies or bullets nobody drew). */
export interface CompiledSprite {
  id: string;
  name: string;
  description: string;
  x: number;
  y: number;
  z: number;
  size: number;
  direction: number;
  visible: boolean;
  rotationStyle: RotationStyleName;
}

export interface CompiledCode {
  /** Target id (user sprite, stage, or compiled sprite). */
  targetId: string;
  targetName: string;
  className: string;
  /** Code as the AI wrote it (shown to the user). */
  source: string;
  /** Code after safety instrumentation (what actually runs). */
  runSource: string;
}

export interface CompiledGame {
  createdAt: number;
  model: string;
  mode: WorldMode;
  /** Hash of everything the compiler saw; differs when blocks/assets change. */
  inputHash: string;
  summary: string;
  howToPlay: string;
  warnings: string[];
  code: CompiledCode[];
  sprites: CompiledSprite[];
  assets: CompiledAsset[];
}

export interface Project {
  format: 'amble';
  version: 1;
  id: string;
  title: string;
  /** Overall description of the game in the author's words. */
  notes: string;
  mode: WorldMode;
  stage: StageTarget;
  sprites: SpriteTarget[];
  /**
   * Variables "for all sprites" (Make a Variable). Missing in projects saved before
   * variables were declared; their names then come from the blocks that use them.
   */
  variables?: string[];
  compiled: CompiledGame | null;
}
