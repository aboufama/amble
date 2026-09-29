/**
 * Change mode's selection: a lantern glow around one thing in the paused world. With WebGL the glow
 * follows the drawing's own outline (a post-FX glow); on the Canvas renderer, or when the effect cannot
 * be added, a rounded lantern frame is drawn around the thing's box instead.
 */
import Phaser from 'phaser';
import { findObject, type Found } from './objects';

/** The lantern colour (--accent), as the game draws it. */
const LANTERN = 0xffc15e;

type WithFx = Phaser.GameObjects.GameObject & { postFX?: Phaser.GameObjects.Components.FX | null };

interface Shown {
  id: number;
  obj: WithFx;
  glow: Phaser.FX.Glow | null;
  frame: Phaser.GameObjects.Graphics | null;
}

let shown: Shown | null = null;

function glowOf(obj: WithFx): Phaser.FX.Glow | null {
  const fx = obj.postFX;
  if (!fx || !(obj.scene?.sys.game.renderer instanceof Phaser.Renderer.WebGL.WebGLRenderer)) return null;
  try {
    return fx.addGlow(LANTERN, 5, 0, false, 0.1, 12);
  } catch {
    return null;
  }
}

function frameAround(f: Found): Phaser.GameObjects.Graphics | null {
  const scene = f.obj.scene;
  if (!scene) return null;
  const pad = 6;
  const r = f.world;
  const g = scene.add.graphics().setDepth(1e9);
  const radius = Math.min(16, (Math.min(r.width, r.height) + pad * 2) / 3);
  // A soft halo, then the lantern line.
  g.lineStyle(10, LANTERN, 0.16).strokeRoundedRect(r.x - pad, r.y - pad, r.width + pad * 2, r.height + pad * 2, radius);
  g.lineStyle(3, LANTERN, 1).strokeRoundedRect(r.x - pad, r.y - pad, r.width + pad * 2, r.height + pad * 2, radius);
  return g;
}

/** Removes the outline (the caller draws a frame afterwards when the game is paused). */
export function clearSelection(): void {
  if (!shown) return;
  const { obj, glow, frame } = shown;
  shown = null;
  try {
    if (glow && obj.postFX) obj.postFX.remove(glow);
  } catch {
    // The object may already be gone.
  }
  frame?.destroy();
}

/** Outlines one object; null clears. Returns whether something is now outlined. */
export function selectObject(game: Phaser.Game, id: number | null): boolean {
  if (shown && shown.id === id && shown.obj.active) return true;
  clearSelection();
  if (id === null) return false;
  const found = findObject(game, id);
  if (!found) return false;
  const obj = found.obj as WithFx;
  const glow = glowOf(obj);
  shown = { id, obj, glow, frame: glow ? null : frameAround(found) };
  return true;
}

export function selectedId(): number | null {
  return shown?.id ?? null;
}
