/**
 * The project format of the old block editor (`format: 'amble'`, `version: 1`), kept only so
 * old projects' drawings and sounds can be brought into the new Amble. Nothing is saved in it
 * any more. Blocks, compiled code, AI-made assets and 3D models are never imported, so they
 * stay `unknown` here.
 */

/** A bitmap or SVG image: a sprite's costume or a stage backdrop. */
export interface LegacyImageAsset {
  id: string;
  name: string;
  kind: 'image';
  /** A data: URL: a PNG from the paint editor, or an imported PNG, JPEG, GIF, WebP or SVG. */
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

/** A 3D model: an uploaded .glb or an AI-made recipe. */
export interface LegacyModelAsset {
  id: string;
  name: string;
  kind: 'model';
  dataUrl?: string;
  recipe?: unknown;
  thumbnail?: string;
  description?: string;
}

export type LegacyCostumeAsset = LegacyImageAsset | LegacyModelAsset;

export interface LegacySoundAsset {
  id: string;
  name: string;
  kind: 'sound';
  /** A data: URL: a WAV from the synth, a WebM recording, or an imported file. */
  dataUrl: string;
  mime: string;
  /** Seconds. */
  duration: number;
  description?: string;
}

interface LegacyTargetBase {
  id: string;
  name: string;
  /** What this sprite is for, in the author's words. */
  description: string;
  costumes: LegacyCostumeAsset[];
  sounds: LegacySoundAsset[];
  /** Index of the current costume or backdrop. */
  currentCostume: number;
  /** Blockly's JSON workspace. */
  blocks: unknown;
}

export interface LegacyStageTarget extends LegacyTargetBase {
  kind: 'stage';
}

export interface LegacySpriteTarget extends LegacyTargetBase {
  kind: 'sprite';
  /** Variables "for this sprite only". */
  variables?: string[];
  /** Position on a 480×360 stage, origin at the center, y up. */
  x: number;
  y: number;
  /** 3D only. */
  z: number;
  /** Percent. */
  size: number;
  /** 2D: degrees counter-clockwise (0 = right). 3D: heading. */
  direction: number;
  visible: boolean;
  rotationStyle: 'all around' | 'left-right' | "don't rotate";
}

export type LegacyTarget = LegacyStageTarget | LegacySpriteTarget;

export interface LegacyProject {
  format: 'amble';
  version: 1;
  id: string;
  title: string;
  /** The game's description in the author's words. */
  notes: string;
  mode: '2d' | '3d';
  stage: LegacyStageTarget;
  sprites: LegacySpriteTarget[];
  /** Variables "for all sprites". */
  variables?: string[];
  /** The AI compiler's cache, including the art it made. */
  compiled: unknown;
}
