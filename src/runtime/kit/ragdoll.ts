/**
 * Ragdolls from the student's own drawing, and characters in Matter games.
 *
 * - `character.ragdoll()` (and `this.ragdoll(x, y, key)`): a drawing made on the bones falls apart into
 *   its own part layers (`part:armL`, `part:head`...), one Matter body per part, pinned where its bones
 *   join, in a negative collision group so the parts never push each other. `ragdoll.break()` lets go of
 *   the pins: the parts fly apart at the joints. Stand-ins and flat drawings use the kit's template
 *   ragdoll (matter.ts). In a game without Matter the parts fly off as plain pieces and fade.
 * - In a Matter game a character is a Matter image (game code pushes, drags and blasts it like any body)
 *   and a Character rides it as its picture: the drawing on its bones, or its "just bones" stand-in, so
 *   characters move, squash and change drawings in physics toys too.
 * Installed once per game realm by `installRagdolls()` (kit/index.ts).
 */
import Phaser from 'phaser';
import { pixelSize, type DrawnPixels } from '../shell/assets';
import { Character } from './character';
import * as matter from './matter';
import { AmbleScene } from './scene';
import type { Kit } from './state';
import { addTexture } from './swap';
import { arcadeBody, type Actor } from './types';

type MatterImage = Phaser.Physics.Matter.Image & { key?: string };

export interface Ragdoll {
  torso: MatterImage;
  head: MatterImage;
  parts: MatterImage[];
  joints: MatterJS.ConstraintType[];
  /** Lets go of every pin: the parts fly apart at the joints. */
  break(): void;
}

interface BoneLike {
  name: string;
  parent: number;
  x: number;
  y: number;
  x2: number;
  y2: number;
}

interface RigLike {
  bones: BoneLike[];
  parts: Array<{ name: string; bones: string[]; order: number; layer?: string }>;
  anchor: [number, number];
  facing: number;
}

function readRig(v: unknown): RigLike | null {
  const r = v as Partial<RigLike> | null;
  if (!r || !Array.isArray(r.bones) || !Array.isArray(r.parts) || !Array.isArray(r.anchor)) return null;
  return r as RigLike;
}

/** Where a character stands: its feet in the world, art px → world px, and whether it is mirrored. */
interface Placement {
  footX: number;
  footY: number;
  fit: number;
  mirrored: boolean;
  /** Velocity in Matter units (px per 60th of a second). */
  vx: number;
  vy: number;
  depth: number;
}

interface Piece {
  name: string;
  tex: string;
  /** Centre in world px, angle of the body's +y axis, and size in art px. */
  x: number;
  y: number;
  angle: number;
  w: number;
  h: number;
  round: boolean;
  root: BoneLike;
}

/** One body per part layer, cut along its bones (the texture turned so the bone runs down it). */
function cutPieces(scene: Phaser.Scene, key: string, version: number, rig: RigLike, image: DrawnPixels, layers: Record<string, HTMLCanvasElement | ImageBitmap>, place: Placement): Piece[] {
  const { w: W, h: H } = pixelSize(image);
  const mx = (x: number) => (place.mirrored ? W - x : x);
  const byName = new Map(rig.bones.map((b) => [b.name, b]));
  const out: Piece[] = [];
  for (const part of [...rig.parts].sort((a, b) => a.order - b.order)) {
    const layer = part.layer ? layers[part.layer] : undefined;
    const bones = part.bones.map((n) => byName.get(n)).filter((b): b is BoneLike => !!b);
    if (!layer || !bones.length) continue;
    const names = new Set(part.bones);
    const root = bones.find((b) => b.parent < 0 || !names.has(rig.bones[b.parent]?.name ?? '')) ?? bones[0];
    const rx = mx(root.x);
    const ry = root.y;
    let tip = { x: mx(root.x2), y: root.y2 };
    for (const b of bones) if (Math.hypot(mx(b.x2) - rx, b.y2 - ry) > Math.hypot(tip.x - rx, tip.y - ry)) tip = { x: mx(b.x2), y: b.y2 };
    let theta = Math.atan2(tip.y - ry, tip.x - rx);
    if (Math.hypot(tip.x - rx, tip.y - ry) < 2) theta = -Math.PI / 2;
    const dx = Math.cos(theta);
    const dy = Math.sin(theta);
    const flat = document.createElement('canvas');
    flat.width = W;
    flat.height = H;
    const fctx = flat.getContext('2d', { willReadFrequently: true });
    if (!fctx) continue;
    if (place.mirrored) fctx.setTransform(-1, 0, 0, 1, W, 0);
    fctx.drawImage(layer, 0, 0);
    const px = fctx.getImageData(0, 0, W, H).data;
    // The part's pixels along the bone (t) and across it (s), from the root joint.
    const ts: number[] = [];
    const ss: number[] = [];
    for (let y = 0; y < H; y += 2) {
      for (let x = 0; x < W; x += 2) {
        if (px[(y * W + x) * 4 + 3] < 40) continue;
        ts.push((x - rx) * dx + (y - ry) * dy);
        ss.push(-(x - rx) * dy + (y - ry) * dx);
      }
    }
    if (ts.length < 4) continue;
    ts.sort((a, b) => a - b);
    ss.sort((a, b) => a - b);
    const q = (arr: number[], f: number) => arr[Math.min(arr.length - 1, Math.max(0, Math.round((arr.length - 1) * f)))];
    const t0 = q(ts, 0.02);
    const t1 = q(ts, 0.98);
    const s0 = q(ss, 0.06);
    const s1 = q(ss, 0.94);
    const ct = (t0 + t1) / 2;
    const cs = (s0 + s1) / 2;
    const cx = rx + ct * dx - cs * dy;
    const cy = ry + ct * dy + cs * dx;
    // The texture keeps every pixel of the part, centred on the body.
    const halfT = Math.max(ct - ts[0], ts[ts.length - 1] - ct) + 3;
    const halfS = Math.max(cs - ss[0], ss[ss.length - 1] - cs) + 3;
    const tex = `~rag:${key}:${version}:${part.name}${place.mirrored ? ':m' : ''}`;
    const tw = Math.max(2, Math.ceil(halfS * 2));
    const th = Math.max(2, Math.ceil(halfT * 2));
    if (!scene.textures.exists(tex)) {
      const c = document.createElement('canvas');
      c.width = tw;
      c.height = th;
      const ctx = c.getContext('2d');
      if (!ctx) continue;
      ctx.translate(tw / 2, th / 2);
      ctx.rotate(Math.PI / 2 - theta);
      ctx.translate(-cx, -cy);
      ctx.drawImage(flat, 0, 0);
      addTexture(scene.textures, tex, c);
    }
    out.push({
      name: part.name,
      tex,
      x: place.footX + (cx - mx(rig.anchor[0])) * place.fit,
      y: place.footY + (cy - rig.anchor[1]) * place.fit,
      angle: theta - Math.PI / 2,
      w: Math.max(4, s1 - s0),
      h: Math.max(4, t1 - t0),
      round: part.name === 'head' || part.bones.includes('head'),
      root,
    });
  }
  return out;
}

/** The drawing's own ragdoll, or null when it was not drawn on the bones (or there is no Matter). */
function drawnRagdoll(scene: AmbleScene, k: Kit, key: string, place: Placement): Ragdoll | null {
  const d = k.art.drawn(key);
  const rig = readRig(d?.rig);
  if (!d || !rig || !d.layers || !scene.matter?.world) return null;
  const pieces = cutPieces(scene, key, d.version, rig, d.image, d.layers, place);
  if (pieces.length < 2) return null;
  const group = scene.matter.world.nextGroup(true);
  const imgs = new Map<string, MatterImage>();
  for (const p of pieces) {
    const opts: Phaser.Types.Physics.Matter.MatterBodyConfig = {
      shape: p.round ? { type: 'circle', radius: (p.w + p.h) / 4 } : { type: 'rectangle', width: p.w, height: p.h },
      collisionFilter: { group, category: 1, mask: 0xffffffff },
      density: 0.002,
      friction: 0.6,
      frictionAir: 0.012,
      restitution: 0.25,
    };
    if (!p.round) opts.chamfer = { radius: Math.min(p.w, p.h) * 0.35 };
    const img = scene.matter.add.image(p.x, p.y, p.tex, undefined, opts) as MatterImage;
    img.setScale(place.fit).setRotation(p.angle).setDepth(place.depth);
    img.setVelocity(place.vx + (Math.random() - 0.5) * 2, place.vy - Math.random() * 2);
    img.setAngularVelocity((Math.random() - 0.5) * 0.12);
    img.key = key;
    imgs.set(p.name, img);
  }
  const partOfBone = new Map<string, string>();
  const rigLike = readRig(d.rig) as RigLike;
  for (const part of rigLike.parts) for (const b of part.bones) partOfBone.set(b, part.name);
  const joints: MatterJS.ConstraintType[] = [];
  for (const p of pieces) {
    const parentBone = rigLike.bones[p.root.parent];
    const parentPart = parentBone ? partOfBone.get(parentBone.name) : undefined;
    const a = parentPart ? imgs.get(parentPart) : undefined;
    const b = imgs.get(p.name);
    if (!a || !b || a === b) continue;
    const { w } = pixelSize(d.image);
    const jx = place.footX + ((place.mirrored ? w - p.root.x : p.root.x) - (place.mirrored ? w - rigLike.anchor[0] : rigLike.anchor[0])) * place.fit;
    const jy = place.footY + (p.root.y - rigLike.anchor[1]) * place.fit;
    joints.push(
      scene.matter.add.constraint(a.body as MatterJS.BodyType, b.body as MatterJS.BodyType, 0, 0.85, {
        pointA: { x: jx - a.x, y: jy - a.y },
        pointB: { x: jx - b.x, y: jy - b.y },
        damping: 0.08,
      }),
    );
  }
  const parts = [...imgs.values()];
  const torso = imgs.get('torso') ?? imgs.get('body') ?? parts[0];
  const head = imgs.get('head') ?? torso;
  return {
    torso,
    head,
    parts,
    joints,
    break() {
      for (const j of joints.splice(0)) {
        scene.matter.world.removeConstraint(j);
        const p = j.bodyB?.position;
        if (p) k.fx.burst(p.x, p.y, { frames: ['star', 'spark'], colors: [0xffffff, 0xffd23f], count: 6, speed: [60, 220], life: 380, size: 0.5 });
      }
      for (const img of parts) if (img.active) img.setVelocity(img.body ? (img.body as MatterJS.BodyType).velocity.x * 1.6 : 0, -4 - Math.random() * 6);
      scene.sfx('pop');
    },
  };
}

/** Without Matter: the parts fly off as plain pieces that tumble, bounce once and fade. */
function flyingPieces(scene: AmbleScene, k: Kit, key: string, place: Placement): Ragdoll | null {
  const d = k.art.drawn(key);
  const rig = readRig(d?.rig);
  if (!d || !rig || !d.layers) return null;
  const pieces = cutPieces(scene, key, d.version, rig, d.image, d.layers, place);
  if (!pieces.length) return null;
  const floor = scene.cameras.main.worldView.bottom - 10;
  const imgs = pieces.map((p) => {
    const img = scene.add.image(p.x, p.y, p.tex).setScale(place.fit).setRotation(p.angle).setDepth(place.depth);
    const v = { x: place.vx * 60 + (Math.random() - 0.5) * 420, y: place.vy * 60 - 300 - Math.random() * 380, spin: (Math.random() - 0.5) * 12, life: 1800 };
    const step = (dt: number) => {
      if (!img.active) return;
      v.y += 1500 * dt;
      img.x += v.x * dt;
      img.y += v.y * dt;
      img.rotation += v.spin * dt;
      if (img.y > floor && v.y > 0) {
        v.y *= -0.45;
        v.x *= 0.7;
        v.spin *= 0.6;
      }
      v.life -= dt * 1000;
      if (v.life < 400) img.setAlpha(Math.max(0, v.life / 400));
      if (v.life <= 0) {
        img.destroy();
        k.postFns.splice(k.postFns.indexOf(step), 1);
      }
    };
    k.postFns.push(step);
    return img as unknown as MatterImage;
  });
  return { torso: imgs[0], head: imgs[imgs.length - 1], parts: imgs, joints: [], break() {} };
}

/** Where a character (or the Matter image it rides) stands, in the world. */
function placementOf(k: Kit, host: Actor, c: Character): Placement {
  const d = k.art.drawn(c.key);
  const spec = k.art.spec(c.key);
  const h = d ? pixelSize(d.image).h : spec.h;
  const sy = Math.abs(host.scaleY) || 1;
  const fit = (spec.h / Math.max(1, h)) * sy;
  const rig = readRig(d?.rig);
  const drawnFacing = rig && rig.facing < 0 ? -1 : 1;
  const ab = arcadeBody(host);
  const mb = !ab ? (host.body as MatterJS.BodyType | null) : null;
  return {
    footX: host.x,
    footY: host.y + (spec.h / 2) * sy * k.gravitySign,
    fit,
    mirrored: !!rig && rig.facing !== 0 && c.facing !== drawnFacing,
    vx: ab ? ab.velocity.x / 60 : mb?.velocity?.x ?? 0,
    vy: ab ? ab.velocity.y / 60 : mb?.velocity?.y ?? 0,
    depth: host.depth,
  };
}

/** Turns a character into its ragdoll where it stands (it leaves the game; its parts stay). */
function ragdollOf(host: Actor, c: Character, o: { break?: boolean } = {}): Ragdoll | null {
  const scene = host.scene as AmbleScene | undefined;
  const k = scene?.__kit;
  if (!scene || !k || !host.active) return null;
  const place = placementOf(k, host, c);
  let doll = scene.matter?.world ? drawnRagdoll(scene, k, c.key, place) : flyingPieces(scene, k, c.key, place);
  if (!doll && scene.matter?.world) doll = matter.ragdoll(scene, k, host.x, host.y, c.key, { scale: Math.abs(host.scaleY) || 1 }) as unknown as Ragdoll;
  if (doll && !doll.joints) Object.assign(doll, { joints: [], break() {} });
  if (doll && o.break) doll.break();
  host.destroy();
  return doll;
}

// ------------------------------------------------------------------ characters riding Matter bodies

/** Moves that play once over the movement (as in character.ts). */
const ONE_SHOTS = new Set(['attack', 'shoot', 'hurt', 'land', 'die', 'ko']);

/** A Character that draws a Matter image: the image stays the body, the Character is what you see. */
function ride(scene: AmbleScene, k: Kit, img: Actor): void {
  const c = new Character(scene, k, img.x, img.y, img.key, { role: img.role, autoAnim: false });
  // The Matter image keeps its body (and every Matter method) but never draws its flat picture.
  (img as unknown as { willRender(): boolean }).willRender = () => false;
  const a = img as Actor & { squashScale?: { x: number; y: number }; ragdoll?: (o?: { break?: boolean }) => Ragdoll | null };
  let clip = 'idle';
  // Moves the game plays win over the automatic ones until it plays a looping move again.
  let locked = false;
  a.play = (move, o) => {
    c.play(move, o);
    if (o?.lock) locked = true;
    else if (!ONE_SHOTS.has(String(move)) && !o?.once) {
      locked = false;
      clip = String(move);
    }
    return a;
  };
  a.face = (dir) => {
    c.face(dir);
    a.facing = c.facing;
    return a;
  };
  a.lookAt = (t) => {
    c.lookAt(t);
    return a;
  };
  a.setTint = (col: number) => c.setTint(col);
  a.setTintFill = () => c.setTintFill();
  a.clearTint = () => c.clearTint();
  a.squashScale = c.squashScale;
  a.ragdoll = (o) => ragdollOf(a, c, o);
  const sync = () => {
    if (!a.active) {
      k.postFns.splice(k.postFns.indexOf(sync), 1);
      return;
    }
    c.setPosition(a.x, a.y).setRotation(a.rotation).setDepth(a.depth).setVisible(a.visible).setAlpha(a.alpha);
    if (c.scaleX !== a.scaleX || c.scaleY !== a.scaleY) c.setScale(a.scaleX, a.scaleY);
    // Moves from the body's motion: falling, walking, standing.
    const v = (a.body as MatterJS.BodyType | null)?.velocity;
    if (!v || locked) return;
    const want = v.y * k.gravitySign > 4 ? 'fall' : Math.abs(v.x) > 1.2 ? 'walk' : 'idle';
    if (want !== clip) {
      clip = want;
      c.play(want);
    }
  };
  k.postFns.push(sync);
  a.once(Phaser.GameObjects.Events.DESTROY, () => c.destroy());
}

let installed = false;

export function installRagdolls(): void {
  if (installed) return;
  installed = true;
  const proto = AmbleScene.prototype as unknown as { spawn(this: AmbleScene, ...args: unknown[]): Actor; ragdoll(this: AmbleScene, x: number, y: number, key?: string, o?: { scale?: number; depth?: number }): Ragdoll };
  const spawn = proto.spawn;
  proto.spawn = function (...args: unknown[]) {
    const a = spawn.apply(this, args);
    const k = this.__kit;
    const o = (args[3] ?? {}) as { rig?: boolean };
    if (k && k.physicsType === 'matter' && a.spec?.kind === 'character' && o.rig !== false && !(a instanceof Character)) ride(this, k, a);
    return a;
  };
  const sceneRagdoll = proto.ragdoll;
  proto.ragdoll = function (x, y, key = 'dummy', o = {}) {
    const k = this.__kit;
    if (k && k.art.isDrawn(key)) {
      if (!k.art.specs.has(key)) k.art.specs.set(key, { ...k.art.spec(key), kind: 'character', rig: 'biped' });
      k.art.use(key);
      const spec = k.art.spec(key);
      const d = k.art.drawn(key);
      const s = o.scale ?? 1;
      const place: Placement = { footX: x, footY: y + (spec.h / 2) * s, fit: (spec.h / Math.max(1, d ? pixelSize(d.image).h : spec.h)) * s, mirrored: false, vx: 0, vy: 0, depth: o.depth ?? 260 };
      const doll = drawnRagdoll(this, k, key, place);
      if (doll) return doll;
    }
    const doll = sceneRagdoll.call(this, x, y, key, o);
    return Object.assign(doll, { joints: [], break() {} });
  };
  (Character.prototype as unknown as { ragdoll(this: Character, o?: { break?: boolean }): Ragdoll | null }).ragdoll = function (o) {
    if (!this.active) return null;
    return ragdollOf(this as unknown as Actor, this, o);
  };
}
