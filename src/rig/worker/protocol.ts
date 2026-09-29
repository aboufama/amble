/** Messages between the app and the rig worker. Pixels travel as copies; bakes and bitmaps transfer. */
import type { FitIssue } from '../fit/common';
import type { BindOptions } from '../bind';
import type { ClipFrameOptions } from '../render/frames';
import type { CharacterKind, Facing, JointHints, LayerPixels, Pixels, RigData } from '../types';

/** Pixels, or an image the worker decodes itself (an exported PNG blob, a bitmap). */
export type ImageSource = Pixels | Blob | ImageBitmap;

/** A drawing for the worker: the flattened image and optional editor layers (`lines`, `part:<name>`). */
export interface RigSource {
  image: ImageSource;
  layers?: Record<string, ImageSource | LayerPixels>;
}

export interface AutoRigRequest {
  /** The art request's kind (never guessed). */
  kind: CharacterKind;
  /** Joint hints (guide pose or vision), art px; see `JointHints`. */
  hints?: JointHints;
  tipHints?: JointHints;
  /** 'keep' for a guide pose or hand-placed joints, 'drop' (default) for vision hints. */
  unsnapped?: 'drop' | 'keep';
  facing?: Facing;
  made?: RigData['made'];
  /**
   * The bones this drawing had before a redraw: the same box keeps them; otherwise the drawing is
   * re-fitted, keeping hand-placed joints as hints.
   */
  previous?: RigData;
}

export interface RigReply {
  rig: RigData;
  confidence: number;
  notes: string[];
  issues: FitIssue[];
  /** True when `previous` bones were kept as they were. */
  kept?: boolean;
  ms: number;
}

export interface RefitRequest {
  /** Keep the current joints as hints. */
  keep?: boolean;
  /** Vision hints (win over kept joints). */
  hints?: JointHints;
  tipHints?: JointHints;
  facing?: Facing;
}

export interface StripMeta {
  clip: string;
  loop: boolean;
  dur: number;
  fps: number;
  width: number;
  height: number;
  anchorX: number;
  anchorY: number;
  scale: number;
}

export type RigRequest =
  | { op: 'autoRig'; input: RigSource; req: AutoRigRequest }
  | { op: 'bind'; input: RigSource; rig: RigData; opts?: BindOptions }
  | { op: 'rigAndBind'; input: RigSource; req: AutoRigRequest; opts?: BindOptions }
  | { op: 'setKind'; input: RigSource; rig: RigData; kind: CharacterKind; req?: RefitRequest }
  | { op: 'magicBones'; input: RigSource; rig: RigData; req?: RefitRequest }
  | { op: 'strip'; input: RigSource; rig: RigData; clip: string; opts?: Omit<ClipFrameOptions, 'bones'> & { packed?: boolean } }
  | { op: 'clear' };

export type RigResponse =
  | { op: 'autoRig'; reply: RigReply }
  | { op: 'setKind'; reply: RigReply }
  | { op: 'magicBones'; reply: RigReply }
  | { op: 'bind'; bake: ArrayBuffer; ms: number; cached: boolean }
  | { op: 'rigAndBind'; reply: RigReply; bake: ArrayBuffer }
  | { op: 'strip'; meta: StripMeta; frames: ImageBitmap[] }
  | { op: 'clear' };

export interface WorkerCall {
  id: number;
  request: RigRequest;
}

export interface WorkerAnswer {
  id: number;
  ok: boolean;
  response?: RigResponse;
  error?: string;
}
