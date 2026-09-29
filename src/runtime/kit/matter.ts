/**
 * Physics chaos with Matter: boxes, balls, stacks, pyramids, a wrecking ball, ragdolls made from a
 * character's own picture, grabbing things with the pointer, sparks and thuds on hard impacts, and blasts.
 * Chromebook budget: about 150 moving bodies; the kit recycles the oldest props past a cap.
 */
import Phaser from 'phaser';
import { pixelSize } from '../shell/assets';
import { addTexture } from './swap';
import { solve, templateFor } from './ghost/templates';
import { paintCharacter } from './ghost/parts';
import type { Kit } from './state';
import type { AmbleScene } from './scene';
import { DEG, util } from './util';

/** The Chromebook budget for moving Matter props; past it the oldest fade out. */
const MAX_PROPS = 150;

export interface MatterBoxOptions {
  key?: string;
  bounce?: number;
  friction?: number;
  density?: number;
  static?: boolean;
  air?: number;
  depth?: number;
  group?: number;
}

type MatterImage = Phaser.Physics.Matter.Image & { key?: string };

function matterImage(scene: AmbleScene, k: Kit, x: number, y: number, key: string, shape: { type: 'rectangle'; width: number; height: number } | { type: 'circle'; radius: number }, o: MatterBoxOptions): MatterImage {
  // Never pass `undefined` inside Matter options: Matter copies it over its defaults (and crashes).
  const opts: Phaser.Types.Physics.Matter.MatterBodyConfig = {
    shape,
    friction: o.friction ?? 0.6,
    frictionAir: o.air ?? 0.005,
    restitution: o.bounce ?? 0.1,
    density: o.density ?? 0.002,
    isStatic: !!o.static,
  };
  if (shape.type === 'rectangle') opts.chamfer = { radius: Math.min(shape.width, shape.height) * 0.12 };
  if (o.group !== undefined) opts.collisionFilter = { group: o.group, category: 1, mask: 0xffffffff };
  const img = scene.matter.add.image(x, y, k.art.raw(key), undefined, opts) as MatterImage;
  img.key = key;
  img.setDepth(o.depth ?? 200);
  if (!o.static) {
    props.push(img);
    const old = props.length > MAX_PROPS ? props.shift() : undefined;
    if (old?.active) scene.tweens.add({ targets: old, alpha: 0, duration: 250, onComplete: () => old.destroy() });
  }
  return img;
}

const props: MatterImage[] = [];

export function resetProps(): void {
  props.length = 0;
}

export function box(scene: AmbleScene, k: Kit, x: number, y: number, w: number, h: number, o: MatterBoxOptions = {}): MatterImage {
  const key = o.key ?? 'crate';
  const spec = k.art.spec(key);
  const img = matterImage(scene, k, x, y, key, { type: 'rectangle', width: spec.w, height: spec.h }, o);
  img.setScale(w / spec.w, h / spec.h);
  return img;
}

export function ball(scene: AmbleScene, k: Kit, x: number, y: number, r: number, o: MatterBoxOptions = {}): MatterImage {
  const key = o.key ?? 'ball';
  const spec = k.art.spec(key);
  const rr = Math.min(spec.w, spec.h) / 2;
  const img = matterImage(scene, k, x, y, key, { type: 'circle', radius: rr }, { bounce: 0.45, friction: 0.05, ...o });
  img.setScale(r / rr);
  return img;
}

export function stack(scene: AmbleScene, k: Kit, x: number, y: number, cols: number, rows: number, o: MatterBoxOptions & { w?: number; h?: number } = {}): MatterImage[] {
  const w = o.w ?? 40;
  const h = o.h ?? 40;
  const out: MatterImage[] = [];
  for (let r = 0; r < Math.min(rows, 30); r++) {
    for (let c = 0; c < Math.min(cols, 30); c++) out.push(box(scene, k, x - (cols * w) / 2 + w / 2 + c * w, y - h / 2 - r * (h + 0.5), w, h, o));
  }
  return out;
}

export function pyramid(scene: AmbleScene, k: Kit, x: number, y: number, rows: number, o: MatterBoxOptions & { w?: number; h?: number } = {}): MatterImage[] {
  const w = o.w ?? 40;
  const h = o.h ?? 40;
  const out: MatterImage[] = [];
  for (let r = 0; r < Math.min(rows, 30); r++) {
    const n = rows - r;
    for (let c = 0; c < n; c++) out.push(box(scene, k, x - (n * w) / 2 + w / 2 + c * w, y - h / 2 - r * (h + 0.5), w, h, o));
  }
  return out;
}

/**
 * A heavy ball on a chain hanging from (ax, ay), pulled back to `angle` degrees. One rigid constraint:
 * a chain of light links under a heavy ball stretches in Matter. The chain is drawn.
 */
export function wreckingBall(scene: AmbleScene, k: Kit, ax: number, ay: number, o: { length?: number; radius?: number; angle?: number; key?: string; density?: number; links?: number } = {}): MatterImage {
  const len = o.length ?? 300;
  const R = o.radius ?? 42;
  const ang = (o.angle ?? -60) * DEG;
  const L = len + R;
  const b = ball(scene, k, ax + Math.sin(ang) * L, ay + Math.cos(ang) * L, R, { key: o.key ?? 'wreckingball', density: o.density ?? 0.02, bounce: 0.15, air: 0.0005 });
  const body = b.body as MatterJS.BodyType;
  scene.matter.add.worldConstraint(body, L, 1, { pointA: { x: ax, y: ay } });
  const g = scene.add.graphics().setDepth(190);
  const links = o.links ?? 14;
  k.postFns.push(() => {
    g.clear();
    if (!b.active) return;
    const dx = b.x - ax;
    const dy = b.y - ay;
    const d = Math.hypot(dx, dy) || 1;
    const ex = ax + (dx / d) * (d - R * 0.8);
    const ey = ay + (dy / d) * (d - R * 0.8);
    g.lineStyle(8, 0x1d1233, 1).lineBetween(ax, ay, ex, ey);
    g.lineStyle(3, 0x9aa5b8, 1).lineBetween(ax, ay, ex, ey);
    g.fillStyle(0x9aa5b8, 1);
    for (let i = 1; i < links; i++) {
      const t = i / links;
      g.fillCircle(util.lerp(ax, ex, t), util.lerp(ay, ey, t), 3.2);
    }
    g.fillStyle(0x1d1233, 1).fillCircle(ax, ay, 10);
  });
  return b;
}

export interface Ragdoll {
  torso: MatterImage;
  head: MatterImage;
  parts: MatterImage[];
}

/**
 * A floppy ragdoll cut from a character's own picture (the drawing, or its stand-in), one body per bone,
 * pinned at the joints, parts never colliding with each other.
 */
export function ragdoll(scene: AmbleScene, k: Kit, x: number, y: number, key = 'dummy', o: { scale?: number; depth?: number } = {}): Ragdoll {
  if (!k.art.specs.has(key)) k.art.specs.set(key, { ...k.art.spec(key), kind: 'character', rig: 'biped' });
  const spec = k.art.spec(key);
  k.art.use(key);
  const s = o.scale ?? 1;
  const template = templateFor('biped', spec.w, spec.h);
  const world = solve(template, {});
  const drawn = k.art.drawn(key);
  const res = 2;
  const src: CanvasImageSource = drawn?.image ?? paintCharacter(spec, res);
  const size = drawn ? pixelSize(drawn.image) : { w: spec.w * res, h: spec.h * res };
  const px = size.h / spec.h;
  const group = scene.matter.world.nextGroup(true);
  const byBone = new Map<string, { img: MatterImage; cx: number; cy: number }>();
  const tm = scene.sys.textures;
  for (const b of template.bones) {
    const part = b.part;
    const j = world.get(b.name);
    if (!part || !j) continue;
    const cos = Math.cos(j.angle);
    const sin = Math.sin(j.angle);
    const ccx = j.x + part.cx * cos - part.cy * sin;
    const ccy = j.y + part.cx * sin + part.cy * cos;
    const vertical = Math.abs(sin) < 0.5;
    const bw = vertical ? part.w : part.h;
    const bh = vertical ? part.h : part.w;
    const texKey = `~rag:${key}:${b.name}:${drawn?.version ?? 0}`;
    if (!tm.exists(texKey)) {
      const canvas = document.createElement('canvas');
      canvas.width = side(bw * px);
      canvas.height = side(bh * px);
      const sx = (ccx - bw / 2 + spec.w / 2) * px + (size.w - spec.w * px) / 2;
      const sy = (ccy - bh / 2 + spec.h) * px;
      canvas.getContext('2d')?.drawImage(src, sx, sy, canvas.width, canvas.height, 0, 0, canvas.width, canvas.height);
      addTexture(tm, texKey, canvas);
    }
    const opts: Phaser.Types.Physics.Matter.MatterBodyConfig = {
      shape: b.name === 'head' ? { type: 'circle', radius: (Math.min(bw, bh) / 2) * s } : { type: 'rectangle', width: bw * s, height: bh * s },
      collisionFilter: { group, category: 1, mask: 0xffffffff },
      density: 0.0025,
      friction: 0.5,
      restitution: 0.2,
    };
    if (b.name !== 'head') opts.chamfer = { radius: Math.min(bw, bh) * s * 0.3 };
    const img = scene.matter.add.image(x + ccx * s, y + (ccy + spec.h / 2) * s, texKey, undefined, opts) as MatterImage;
    img.setScale((bw * s) / side(bw * px), (bh * s) / side(bh * px)).setDepth((o.depth ?? 260) + b.depth * 0.1);
    img.key = key;
    byBone.set(b.name, { img, cx: ccx, cy: ccy });
  }
  const pin = (parent: string, child: string) => {
    const p = byBone.get(parent);
    const ch = byBone.get(child);
    const j = world.get(child);
    if (!p || !ch || !j) return;
    scene.matter.add.constraint(p.img.body as MatterJS.BodyType, ch.img.body as MatterJS.BodyType, 0, 0.7, {
      pointA: { x: (j.x - p.cx) * s, y: (j.y - p.cy) * s },
      pointB: { x: (j.x - ch.cx) * s, y: (j.y - ch.cy) * s },
    });
  };
  for (const b of template.bones) {
    if (!b.parent) continue;
    const parent = b.parent === 'hips' ? 'spine' : b.parent;
    if (b.name !== 'spine') pin(parent, b.name);
  }
  const parts = [...byBone.values()].map((v) => v.img);
  const torso = byBone.get('spine')?.img ?? parts[0];
  const head = byBone.get('head')?.img ?? parts[0];
  return { torso, head, parts };
}

/** Canvas side length for a crop (at least 2 px). */
function side(v: number): number {
  return Math.max(2, Math.round(v));
}

/** Push every body near (x, y) away. power 1 = a solid bang. Works on Matter and Arcade bodies. */
export function blast(scene: AmbleScene, x: number, y: number, o: { radius?: number; power?: number } = {}): void {
  const R = o.radius ?? 180;
  const P = o.power ?? 1;
  if (scene.matter?.world) {
    const M = scene.matter.body;
    for (const b of scene.matter.world.getAllBodies()) {
      if (b.isStatic) continue;
      const dx = b.position.x - x;
      const dy = b.position.y - y;
      const d = Math.hypot(dx, dy) || 1;
      if (d > R) continue;
      const f = (1 - d / R) * P;
      wake(b);
      M.setVelocity(b, { x: b.velocity.x + (dx / d) * f * 24, y: b.velocity.y + (dy / d) * f * 24 - f * 7 });
      M.setAngularVelocity(b, b.angularVelocity + util.rand(-0.35, 0.35) * f);
    }
  }
  if (scene.physics?.world) {
    for (const b of scene.physics.world.bodies.entries) {
      if (!b.enable || b.immovable) continue;
      const dx = b.center.x - x;
      const dy = b.center.y - y;
      const d = Math.hypot(dx, dy) || 1;
      if (d > R) continue;
      const f = (1 - d / R) * P * 900;
      b.velocity.x += (dx / d) * f;
      b.velocity.y += (dy / d) * f - f * 0.3;
    }
  }
}

/** Wakes a sleeping Matter body (what Matter's Sleeping.set(body, false) does). */
function wake(b: MatterJS.BodyType): void {
  if (!b.isSleeping) return;
  b.isSleeping = false;
  (b as MatterJS.BodyType & { sleepCounter: number }).sleepCounter = 0;
}

/** Grab and fling Matter bodies with the mouse or a finger. */
export function grab(scene: AmbleScene, o: { stiffness?: number } = {}): Phaser.Physics.Matter.PointerConstraint {
  // What matter.add.pointerConstraint does (its typings promise a plain constraint instead).
  const pc = new Phaser.Physics.Matter.PointerConstraint(scene, scene.matter.world, { length: 1, stiffness: o.stiffness ?? 0.2, damping: 0.1, render: { visible: false } });
  scene.matter.world.add(pc.constraint);
  return pc;
}

/** Sparks and thuds when Matter bodies smash into each other hard. */
export function impacts(scene: AmbleScene, k: Kit, o: { speed?: number } = {}): void {
  const min = o.speed ?? 7;
  let budget = 0;
  k.postFns.push(() => {
    budget = 6;
  });
  const onHit = (ev: Phaser.Physics.Matter.Events.CollisionStartEvent) => {
    for (const pair of ev.pairs) {
      if (budget <= 0) return;
      const a = pair.bodyA;
      const b = pair.bodyB;
      const rv = Math.hypot(a.velocity.x - b.velocity.x, a.velocity.y - b.velocity.y);
      if (rv < min) continue;
      budget--;
      const support = (pair.collision as { supports?: Array<{ x: number; y: number }> }).supports?.[0] ?? a.position;
      k.fx.burst(support.x, support.y, { frames: ['spark'], colors: [0xffffff, 0xffe066], count: Math.min(10, rv), speed: [80, 60 + rv * 30], life: 240, size: 0.5 });
      scene.sfx('thud', { volume: Math.min(0.8, rv / 25), pitch: util.rand(0.8, 1.3) });
      if (rv > min * 2.2) k.fx.shake(Math.min(0.012, rv / 2500), 120);
    }
  };
  scene.matter.world.on(Phaser.Physics.Matter.Events.COLLISION_START, onHit);
  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => scene.matter.world?.off(Phaser.Physics.Matter.Events.COLLISION_START, onHit));
}
