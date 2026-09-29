/**
 * The things in a running kit game as Change mode sees them: every live actor (characters, items, shots,
 * backgrounds) plus the platforms the kit tiles from terrain keys. Positions are CSS px of the game frame's
 * viewport (the editor adds where the frame sits on its page). Ids are stable for the life of an object,
 * so the editor can select one and the runtime can find it again.
 */
import Phaser from 'phaser';
import type { WorldObject } from '../../play/protocol';
import { registryFor, type ArtRegistry } from '../kit/art';
import { Character } from '../kit/character';
import { currentScene, type AmbleScene } from '../kit/scene';
import { isActor, type Actor } from '../kit/types';

export interface Found {
  item: WorldObject;
  obj: Phaser.GameObjects.GameObject;
  /** The object's box in world px (for outlines drawn inside the game). */
  world: Phaser.Geom.Rectangle;
}

type Platform = Phaser.GameObjects.TileSprite & { __ambleKey?: string };

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

/** A character's art box (steady while its limbs swing); anything else: what it shows. */
export function worldBox(o: Phaser.GameObjects.GameObject): Phaser.Geom.Rectangle | null {
  if (o instanceof Character) {
    const w = o.spec.w * Math.abs(o.scaleX);
    const h = o.spec.h * Math.abs(o.scaleY);
    return new Phaser.Geom.Rectangle(o.x - w / 2, o.y - h / 2, w, h);
  }
  const b = o as unknown as { getBounds?: () => Phaser.Geom.Rectangle };
  return typeof b.getBounds === 'function' ? b.getBounds() : null;
}

function isPlatform(o: Phaser.GameObjects.GameObject): o is Platform {
  return o instanceof Phaser.GameObjects.TileSprite && typeof (o as Platform).__ambleKey === 'string';
}

function groupOf(scene: AmbleScene, a: Actor): string | null {
  const k = scene.__kit;
  if (!k) return null;
  for (const [name, g] of k.groups) {
    if (!k.pools.has(name) && g.contains(a)) return name;
  }
  return null;
}

interface Candidate {
  obj: Phaser.GameObjects.GameObject;
  key: string;
  world: Phaser.Geom.Rectangle;
  group: string | null;
}

function candidates(scene: AmbleScene): Candidate[] {
  const view = scene.cameras.main.worldView;
  const inView = (b: Phaser.Geom.Rectangle) => b.right >= view.x && b.x <= view.right && b.bottom >= view.y && b.y <= view.bottom;
  const out: Candidate[] = [];
  const platforms: Candidate[] = [];
  for (const o of scene.children.list) {
    if (!o.active) continue;
    if (isActor(o)) {
      const world = worldBox(o);
      if (world && inView(world)) out.push({ obj: o, key: o.key, world, group: groupOf(scene, o) });
    } else if (isPlatform(o) && o.visible) {
      const world = o.getBounds();
      const key = o.__ambleKey ?? '';
      if (key && inView(world)) platforms.push({ obj: o, key, world, group: 'platforms' });
    }
  }
  // Scenery last: when the list is full, the things students tap most stay in it.
  return [...out, ...platforms];
}

/** The world objects of the running kit game, with their display objects (at most `max`). */
export function collectObjects(game: Phaser.Game, max = 64): Found[] {
  const scene = currentScene();
  const reg: ArtRegistry | undefined = registryFor(game);
  if (!scene || !reg || !scene.__kit) return [];
  const cam = scene.cameras.main;
  const box = game.canvas.getBoundingClientRect();
  const sx = box.width / game.scale.width || 1;
  const sy = box.height / game.scale.height || 1;
  const list = candidates(scene);
  const counts = new Map<string, number>();
  for (const c of list) counts.set(c.key, (counts.get(c.key) ?? 0) + 1);
  const seen = new Set<string>();
  const found: Found[] = [];
  for (const c of list) {
    if (found.length >= max) break;
    const spec = reg.spec(c.key);
    const first = !seen.has(c.key);
    seen.add(c.key);
    const role = isActor(c.obj) ? c.obj.role : spec.role;
    found.push({
      obj: c.obj,
      world: c.world,
      item: {
        id: idOf(c.obj),
        key: c.key,
        label: spec.name,
        role,
        group: c.group,
        x: Math.round(box.left + (c.world.x - cam.worldView.x) * cam.zoom * sx),
        y: Math.round(box.top + (c.world.y - cam.worldView.y) * cam.zoom * sy),
        w: Math.round(c.world.width * cam.zoom * sx),
        h: Math.round(c.world.height * cam.zoom * sy),
        drawn: reg.isDrawn(c.key),
        count: first ? (counts.get(c.key) ?? 1) : 0,
      },
    });
  }
  return found;
}

/** The live object with this id (null when it is gone or off screen). */
export function findObject(game: Phaser.Game, id: number): Found | null {
  return collectObjects(game, 512).find((f) => f.item.id === id) ?? null;
}

/** The first live thing showing this art key. */
export function firstWithKey(game: Phaser.Game, key: string): Found | null {
  return collectObjects(game, 512).find((f) => f.item.key === key) ?? null;
}
