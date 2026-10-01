import type { RotationStyleName, WorldMode } from '../player/protocol';

export type { RotationStyleName, WorldMode };

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

/** A costume or backdrop. (Projects from when Amble also made 3D games had 3D models too; they open without them, see migrate.ts.) */
export type CostumeAsset = ImageAsset;

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
  /** Depth in projects saved as 3D, which open as 2D (see migrate.ts); 0 otherwise. */
  z: number;
  size: number;
  /** Angle in degrees counter-clockwise (0 = right). */
  direction: number;
  visible: boolean;
  rotationStyle: RotationStyleName;
}

export type Target = StageTarget | SpriteTarget;

/** An asset the compiler (AI) made because the game needed it. */
export type CompiledAsset = (ImageAsset | SoundAsset) & {
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

/** Code the compiler wrote for words in a block. It is kept, by content, until those words change. */
export interface CompiledPiece {
  /** Content hash of the words and where they are (see src/compiler/codegen.ts). */
  key: string;
  kind: string;
  target: string;
  /** The block, as text. */
  block: string;
  code: string;
}

/** A question the compiler asked about words it had to guess at. It shows on their block until they change. */
export interface CompiledQuestion {
  /** The sprite (or the stage) and the piece the words became. */
  targetId: string;
  pieceKey: string;
  text: string;
}

/** Something in the blocks that doesn't work as placed, found while compiling. It shows on the block. */
export interface CompiledIssue {
  targetId: string;
  blockId: string;
  text: string;
}

export interface CompiledGame {
  createdAt: number;
  model: string;
  /** '2d' (games built for 3D are built again, see migrate.ts). */
  mode: WorldMode;
  /** Hash of everything the compiler saw; differs when blocks/assets change. */
  inputHash: string;
  summary: string;
  howToPlay: string;
  warnings: string[];
  code: CompiledCode[];
  sprites: CompiledSprite[];
  assets: CompiledAsset[];
  /** The compiled words, reused by later compiles (missing in games compiled before them). */
  pieces?: CompiledPiece[];
  /** The brief the words were last written to fit (a new one sends them to be looked at again). */
  brief?: string;
  /** The art style the compiled art was made in (a new one makes it again). */
  style?: string;
  /** Words written before that this compile rewrote to fit the change ("Sprite: block"). */
  revised?: string[];
  /** Questions about words the compiler had to guess at (missing in older games). */
  questions?: CompiledQuestion[];
  /** Blocks that don't work as placed (missing in older games). */
  issues?: CompiledIssue[];
}

export interface Project {
  format: 'amble';
  version: 1;
  id: string;
  title: string;
  /** Overall description of the game in the author's words. */
  notes: string;
  /** Always '2d', kept for older versions of Amble. Projects saved as 3D open as 2D (see migrate.ts). */
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
