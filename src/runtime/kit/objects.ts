/**
 * The things in a running kit game, as the editor sees them (its Change mode tags, the "come alive" target,
 * the Cast's counts): one entry per spawned thing, in CSS px of the game frame, at most 64.
 */
import Phaser from 'phaser';
import type { WorldObject } from '../../play/protocol';
import { registryFor } from './art';
import { Character } from './character';
import { currentScene } from './scene';
import { isActor, type Actor } from './types';

export type { WorldObject };

const ids = new WeakMap<object, number>();
let nextId = 1;

function idOf(o: object): number {
  let id = ids.get(o);
  if (!id) {
    id = nextId++;
    ids.set(o, id);
  }
  return id;
}

export function worldObjects(game: Phaser.Game, max = 64): WorldObject[] {
  const scene = currentScene();
  const reg = registryFor(game);
  const k = scene?.__kit;
  if (!scene || !reg || !k) return [];
  const cam = scene.cameras.main;
  const box = game.canvas.getBoundingClientRect();
  const sx = box.width / game.scale.width || 1;
  const sy = box.height / game.scale.height || 1;
  const actors = scene.children.list.filter((o): o is Actor => isActor(o) && o.active);
  const counts = new Map<string, number>();
  for (const a of actors) counts.set(a.key, (counts.get(a.key) ?? 0) + 1);
  const seen = new Set<string>();
  const out: WorldObject[] = [];
  for (const a of actors) {
    if (out.length >= max) break;
    // Characters: their art box (steady while limbs swing); sprites: what they show.
    const b =
      a instanceof Character
        ? new Phaser.Geom.Rectangle(a.x - (a.spec.w * Math.abs(a.scaleX)) / 2, a.y - (a.spec.h * Math.abs(a.scaleY)) / 2, a.spec.w * Math.abs(a.scaleX), a.spec.h * Math.abs(a.scaleY))
        : (a as unknown as { getBounds(): Phaser.Geom.Rectangle }).getBounds();
    if (b.right < cam.worldView.x || b.x > cam.worldView.right || b.bottom < cam.worldView.y || b.y > cam.worldView.bottom) continue;
    let group: string | null = null;
    for (const [name, g] of k.groups) {
      if (!k.pools.has(name) && g.contains(a)) {
        group = name;
        break;
      }
    }
    const first = !seen.has(a.key);
    seen.add(a.key);
    out.push({
      id: idOf(a),
      key: a.key,
      label: a.spec.name,
      role: a.role,
      group,
      x: Math.round(box.left + (b.x - cam.worldView.x) * cam.zoom * sx),
      y: Math.round(box.top + (b.y - cam.worldView.y) * cam.zoom * sy),
      w: Math.round(b.width * cam.zoom * sx),
      h: Math.round(b.height * cam.zoom * sy),
      drawn: reg.isDrawn(a.key),
      count: first ? (counts.get(a.key) ?? 1) : 0,
    });
  }
  return out;
}
