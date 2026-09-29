/// <reference types="phaser" />
/**
 * The contract between the game kit and the rig module, declared on both sides (the kit's copy is
 * src/runtime/kit/rigged.ts): how a student's drawing with bones becomes a character in a game.
 */

export type ClipName = string;

export interface RiggedCharacter {
  readonly object: Phaser.GameObjects.GameObject & Phaser.GameObjects.Components.Transform;
  readonly clip: string;
  play(clip: ClipName, opts?: { loop?: boolean; speed?: number; fade?: number }): void;
  face(dir: 1 | -1): void;
  follow(body: { velocity: { x: number; y: number }; blocked?: { down?: boolean }; touching?: { down?: boolean } } | null): void;
  setTint(color: number | null): void;
  update(dtMs: number): void;
  destroy(): void;
}

export interface RigBinding { key: string; rig: unknown; image: HTMLCanvasElement | ImageBitmap | HTMLImageElement; layers?: Record<string, HTMLCanvasElement | ImageBitmap> }

export type RiggedFactory = (scene: Phaser.Scene, x: number, y: number, binding: RigBinding) => RiggedCharacter;

/** Where the binder script (./binder.ts) leaves `bindRig` for the runtime: a separate script cannot import it. */
export const BINDER_GLOBAL = '__ambleRigBinder';
