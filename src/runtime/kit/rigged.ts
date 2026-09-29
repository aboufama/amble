/**
 * The contract between the kit and the rig module: how a student's drawing with bones becomes a character
 * in the game. The rig module implements `createRiggedMesh: RiggedFactory`; the runtime entry
 * (src/runtime/shell/index.ts) registers it with `registerRiggedFactory` below (also `Amble.registerRiggedFactory`).
 * Until one is registered, the kit animates drawn characters with a simple sprite puppet (bob and squash),
 * and stand-ins with its own "just bones" rigs.
 *
 * How the kit uses a RiggedCharacter:
 * - it calls the factory with (scene, 0, 0, binding), then puts `object` inside the character's container
 *   with the rig's anchor (ground contact) at the character's feet, scaled so the drawing is the art's
 *   height in the game (the kit owns that scale, and flips it vertically when gravity flips);
 * - it calls `update(dtMs)` once per frame with GAME time (so hit-stop and slow-mo reach the bones); the
 *   object must not rely on its own preUpdate;
 * - it calls `follow(body)` every frame while the character animates itself (idle/walk/run/rise/fall/land
 *   from the body), `follow(null)` when the game took over with `play(..., { lock: true })`;
 * - `play` receives the kit's clip names: idle walk run jump rise fall land dash attack shoot hurt die cheer
 *   rage fly glide swim wiggle spin (unknown names should fall back to the nearest clip);
 * - `face(-1)` turns it to the left (a quick paper flip), `setTint(0xffffff)` is the white hurt flash and
 *   `setTint(null)` clears it; `destroy()` when the character goes away or its drawing changes.
 */
import type Phaser from 'phaser';

export type ClipName = string; // 'idle' | 'walk' | 'run' | 'jump' | 'rise' | 'fall' | 'land' | 'attack' | 'hurt' | 'die' | ...

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

export interface RigBinding {
  key: string;
  rig: unknown /* RigData v1 from src/rig/types.ts */;
  image: HTMLCanvasElement | ImageBitmap | HTMLImageElement;
  layers?: Record<string, HTMLCanvasElement | ImageBitmap>;
}

export type RiggedFactory = (scene: Phaser.Scene, x: number, y: number, binding: RigBinding) => RiggedCharacter;

let factory: RiggedFactory | null = null;

/** Registers the rig module's factory. Characters spawned (or redrawn) after this use it. */
export function registerRiggedFactory(f: RiggedFactory | null): void {
  factory = f;
}

export function riggedFactory(): RiggedFactory | null {
  return factory;
}
