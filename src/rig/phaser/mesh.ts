/**
 * `createRiggedMesh`: a student's drawing as a Phaser 3.90 game object that moves with its bones.
 *
 * WebGL: one Mesh per character. The rig's lattice becomes shared vertices and faces once; every
 * `update` skins the rest mesh on the CPU and writes each vertex's local position (`vx`, `vy`, art px
 * from the anchor) directly. Mesh's own 3D projection and depth sort never run (its `preUpdate` only
 * keeps the render counters), so faces draw in part order, back to front. Canvas renderer: a cut-out
 * puppet, one image per part following that part's main bone.
 *
 * Phaser is never imported: everything is made through the scene's own factories, so the adapter
 * works with whichever Phaser build the game runs.
 */
import type Phaser from 'phaser';
import { isBake, unbakeBound } from '../bake';
import { bindRig } from '../bind';
import { artSizeOf } from '../editing';
import { cloneRig, parseRig } from '../format';
import { hashRig } from '../hash';
import { RigPuppet } from '../runtime/puppet';
import type { BoundRig, LayerPixels, Pixels, RigData } from '../types';
import type { RigBinding, RiggedCharacter, RiggedFactory } from './contract';

type Source = HTMLCanvasElement | ImageBitmap | HTMLImageElement;
type Body = Parameters<RiggedCharacter['follow']>[0];
type Mat = Phaser.GameObjects.Components.TransformMatrix;

const serials = new WeakMap<object, number>();
let serial = 0;
const idOf = (o: object) => {
  let s = serials.get(o);
  if (s === undefined) serials.set(o, (s = ++serial));
  return s;
};

function canvasOf(w: number, h: number): HTMLCanvasElement | OffscreenCanvas {
  if (typeof document !== 'undefined') return Object.assign(document.createElement('canvas'), { width: w, height: h });
  return new OffscreenCanvas(w, h);
}

/** Straight-alpha pixels of an image, drawn into a w × h canvas (layers match the drawing's size). */
function readPixels(img: Source, w = img.width, h = img.height): Pixels {
  const c = canvasOf(w, h);
  const ctx = c.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  if (!ctx) throw new Error('Canvas 2D is not available');
  ctx.drawImage(img, 0, 0);
  const d = ctx.getImageData(0, 0, w, h);
  return { data: d.data, width: w, height: h };
}

function atlasCanvasOf(p: Pixels): HTMLCanvasElement | OffscreenCanvas {
  const c = canvasOf(p.width, p.height);
  const ctx = c.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  if (!ctx) throw new Error('Canvas 2D is not available');
  const data = new Uint8ClampedArray(p.data.buffer as ArrayBuffer, p.data.byteOffset, p.width * p.height * 4);
  ctx.putImageData(new ImageData(data, p.width, p.height), 0, 0);
  return c;
}

/** The rig in the binding: RigData (or its JSON), a bake, or `{ rig, bake }`. */
function readBinding(b: RigBinding): { rig: RigData | null; bake: ArrayBuffer | null } {
  const v = b.rig as unknown;
  if (isBake(v)) return { rig: null, bake: v };
  if (v && typeof v === 'object' && 'bake' in v && isBake((v as { bake: unknown }).bake)) {
    const o = v as { rig?: unknown; bake: ArrayBuffer };
    return { rig: o.rig ? parseRig(o.rig) : null, bake: o.bake };
  }
  return { rig: parseRig(v), bake: null };
}

/** A rig fitted to the same drawing at another size (a 2x export, a downscaled texture). */
export function scaleRigTo(rig: RigData, w: number, h: number): RigData {
  const size = artSizeOf(rig);
  if (!size || (size[0] === w && size[1] === h)) return rig;
  const kx = w / size[0], ky = h / size[1];
  const r = cloneRig(rig);
  for (const b of r.bones) {
    b.x *= kx;
    b.y *= ky;
    b.x2 *= kx;
    b.y2 *= ky;
  }
  r.anchor = [r.anchor[0] * kx, r.anchor[1] * ky];
  if (r.skin?.cell) r.skin = { ...r.skin, cell: r.skin.cell * Math.sqrt(kx * ky) };
  return r;
}

/** Binds per image object and bones: every instance of one drawing shares one bind. */
const binds = new WeakMap<object, Map<string, BoundRig>>();

/** The bound rig for a binding (cached), binding in place when no bake came with it. */
export function boundFor(binding: RigBinding): BoundRig {
  const { rig, bake } = readBinding(binding);
  if (bake) {
    const bound = unbakeBound(bake);
    return rig ? { ...bound, rig: { ...bound.rig, anims: rig.anims, facing: rig.facing, anchor: rig.anchor } } : bound;
  }
  const img = binding.image;
  const fitted = scaleRigTo(rig!, img.width, img.height);
  let m = binds.get(img);
  if (!m) binds.set(img, (m = new Map()));
  const layerIds = binding.layers ? Object.entries(binding.layers).map(([k, v]) => `${k}#${idOf(v)}`).sort().join(',') : '';
  const key = `${hashRig(fitted)}|${layerIds}`;
  let bound = m.get(key);
  if (!bound) {
    const image = readPixels(img);
    let layers: Record<string, LayerPixels> | undefined;
    if (binding.layers) {
      layers = {};
      for (const [k, v] of Object.entries(binding.layers)) layers[k] = readPixels(v, img.width, img.height);
    }
    bound = bindRig({ image, layers }, fitted);
    m.set(key, bound);
  }
  // facing, anchor and move tweaks don't change the bind; take them from this binding
  return bound.rig === fitted ? bound : { ...bound, rig: { ...bound.rig, facing: fitted.facing, anchor: fitted.anchor, anims: fitted.anims } };
}

interface TexUse {
  count: number;
  timer: ReturnType<typeof setTimeout> | null;
}
const texUses = new WeakMap<object, Map<string, TexUse>>();

/** Adds the atlas texture once per key and counts its users; it is removed 2 s after the last one. */
function acquireTexture(scene: Phaser.Scene, key: string, bound: BoundRig): Phaser.Textures.Texture {
  const tm = scene.sys.textures;
  let uses = texUses.get(tm);
  if (!uses) texUses.set(tm, (uses = new Map()));
  let u = uses.get(key);
  if (!u) uses.set(key, (u = { count: 0, timer: null }));
  if (u.timer) {
    clearTimeout(u.timer);
    u.timer = null;
  }
  u.count++;
  if (!tm.exists(key)) {
    const tex = tm.addCanvas(key, atlasCanvasOf(bound.atlas) as HTMLCanvasElement);
    if (!tex) throw new Error('The drawing could not be made into a texture');
    bound.partRanges.forEach((pr, i) => {
      if (pr.atlas.w > 0 && pr.atlas.h > 0) tex.add(`p${i}`, 0, pr.atlas.x, pr.atlas.y, pr.atlas.w, pr.atlas.h);
    });
  }
  return tm.get(key);
}

function releaseTexture(scene: Phaser.Scene, key: string): void {
  const tm = scene.sys.textures;
  const u = texUses.get(tm)?.get(key);
  if (!u) return;
  u.count = Math.max(0, u.count - 1);
  if (u.count > 0 || u.timer) return;
  u.timer = setTimeout(() => {
    u.timer = null;
    if (u.count === 0) {
      texUses.get(tm)?.delete(key);
      if (tm.exists(key)) tm.remove(key);
    }
  }, 2000);
}

/** Where a bone is now, in the object's local space (art px from the anchor, as the drawing is mirrored). */
export interface BonePlace {
  x: number;
  y: number;
  angle: number;
}

/** What `createRiggedMesh` returns: the kit's contract plus a few extras for games that want them. */
export interface RiggedMesh extends RiggedCharacter {
  readonly puppet: RigPuppet;
  readonly bound: BoundRig;
  /** Where a bone (by name or role) is now, for attaching things to hands and heads. */
  bone(name: string): BonePlace | null;
  /** Rig time spent in the last update, ms. */
  readonly stepMs: number;
}

abstract class Base implements RiggedMesh {
  abstract readonly object: Phaser.GameObjects.GameObject & Phaser.GameObjects.Components.Transform;
  readonly puppet: RigPuppet;
  stepMs = 0;
  protected tint: number | null = null;
  protected destroyed = false;
  private last: [number, number] | null = null;
  private mA: Mat | null = null;
  private mB: Mat | null = null;

  constructor(protected readonly scene: Phaser.Scene, readonly bound: BoundRig, protected readonly texKey: string) {
    this.puppet = new RigPuppet(bound);
  }

  get clip(): string {
    return this.puppet.clip;
  }

  play(clip: string, opts?: { loop?: boolean; speed?: number; fade?: number }): void {
    if (!this.puppet.play(clip, opts)) this.puppet.play('idle', opts);
  }

  face(dir: 1 | -1): void {
    this.puppet.face(dir);
  }

  follow(body: Body): void {
    this.puppet.follow(body);
  }

  setTint(color: number | null): void {
    this.tint = color;
  }

  bone(name: string): BonePlace | null {
    return this.puppet.bone(name);
  }

  update(dtMs: number): void {
    if (this.destroyed) return;
    const t0 = performance.now();
    const dt = Math.max(0, Math.min(0.1, dtMs / 1000));
    const o = this.object;
    // world motion since the last update, so springs trail it and wheels roll with it
    this.mA ??= o.getWorldTransformMatrix();
    this.mB ??= o.getWorldTransformMatrix();
    const m = o.getWorldTransformMatrix(this.mA, this.mB);
    const scale = Math.hypot(m.a, m.b) || 1;
    let dx = 0, dy = 0;
    if (this.last) {
      dx = m.tx - this.last[0];
      dy = m.ty - this.last[1];
      // a teleport (respawn, level change) isn't motion
      if (Math.hypot(dx, dy) > 2 * this.puppet.skeleton.height * scale) {
        dx = dy = 0;
        this.puppet.skeleton.resetSprings();
      }
    }
    this.last = [m.tx, m.ty];
    this.puppet.update(dt, { dx, dy, scale });
    this.draw();
    this.stepMs = performance.now() - t0;
  }

  protected abstract draw(): void;

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.object.destroy();
    releaseTexture(this.scene, this.texKey);
  }
}

class MeshCharacter extends Base {
  readonly object: Phaser.GameObjects.Mesh;
  private readonly verts: Phaser.Geom.Mesh.Vertex[] = [];
  private colour = 0xffffff;
  private fill = false;

  constructor(scene: Phaser.Scene, x: number, y: number, bound: BoundRig, texKey: string) {
    super(scene, bound, texKey);
    const mesh = scene.add.mesh(x, y, texKey);
    this.object = mesh;
    mesh.hideCCW = false;
    const { rest, uvs, indices } = bound;
    const [ax, ay] = bound.rig.anchor;
    const addVertex = mesh.addVertex as unknown as (x: number, y: number, z: number, u: number, v: number) => Phaser.Geom.Mesh.Vertex;
    for (let i = 0; i < rest.length / 2; i++) {
      const v = addVertex.call(mesh, rest[2 * i] - ax, rest[2 * i + 1] - ay, 0, uvs[2 * i], uvs[2 * i + 1]);
      v.vx = rest[2 * i] - ax;
      v.vy = rest[2 * i + 1] - ay;
      this.verts.push(v);
    }
    for (let t = 0; t < indices.length; t += 3) mesh.addFace(this.verts[indices[t]], this.verts[indices[t + 1]], this.verts[indices[t + 2]]);
    // skinning writes the vertices; Mesh's own preUpdate (3D projection, depth sort) must not run
    const counters = mesh as unknown as { totalRendered: number; totalFrame: number; preUpdate: () => void };
    counters.preUpdate = () => {
      counters.totalRendered = counters.totalFrame;
      counters.totalFrame = 0;
    };
    mesh.setSize(bound.width, bound.height);
    Object.defineProperty(mesh, 'displayWidth', { get: () => bound.width * Math.abs(mesh.scaleX), set: (v: number) => mesh.setScale(v / bound.width, mesh.scaleY), configurable: true });
    Object.defineProperty(mesh, 'displayHeight', { get: () => bound.height * Math.abs(mesh.scaleY), set: (v: number) => mesh.setScale(mesh.scaleX, v / bound.height), configurable: true });
    this.draw();
  }

  protected draw(): void {
    const pv = this.puppet.vertices!;
    const vs = this.verts;
    for (let i = 0; i < vs.length; i++) {
      vs[i].vx = pv[2 * i];
      vs[i].vy = pv[2 * i + 1];
    }
    const flash = this.puppet.pose.flash > 0.5;
    const fill = flash || this.tint === 0xffffff;
    const colour = flash ? 0xffffff : this.tint ?? 0xffffff;
    if (colour !== this.colour) {
      for (const v of vs) v.color = colour;
      this.colour = colour;
    }
    if (fill !== this.fill) this.object.tintFill = this.fill = fill;
    this.object.setAlpha(this.puppet.pose.alpha);
  }
}

class CutoutCharacter extends Base {
  readonly object: Phaser.GameObjects.Container;
  private readonly inner: Phaser.GameObjects.Container;
  private readonly images: Phaser.GameObjects.Image[] = [];

  constructor(scene: Phaser.Scene, x: number, y: number, bound: BoundRig, texKey: string) {
    super(scene, bound, texKey);
    this.object = scene.add.container(x, y);
    this.inner = scene.make.container({ x: 0, y: 0 }, false);
    this.object.add(this.inner);
    bound.partRanges.forEach((pr, i) => {
      if (pr.atlas.w <= 0 || pr.atlas.h <= 0) return;
      const img = scene.make.image({ x: 0, y: 0, key: texKey, frame: `p${i}` }, false).setOrigin(0, 0);
      img.setData('part', i);
      this.images.push(img);
      this.inner.add(img);
    });
    this.object.setSize(bound.width, bound.height);
    this.draw();
  }

  protected draw(): void {
    const sk = this.puppet.skeleton;
    const K = sk.K;
    const [ax, ay] = this.bound.rig.anchor;
    for (const img of this.images) {
      const pr = this.bound.partRanges[img.getData('part') as number];
      const o = pr.bone * 6;
      const a = K[o], b = K[o + 1], c = K[o + 2], d = K[o + 3];
      const sx = Math.hypot(a, b) || 1;
      // atlas px → art px (the atlas of a big drawing is cut at a smaller size)
      const up = pr.atlas.w > 0 ? pr.art.w / pr.atlas.w : 1;
      img.setPosition(a * pr.art.x + c * pr.art.y + K[o + 4] - ax, b * pr.art.x + d * pr.art.y + K[o + 5] - ay);
      img.setRotation(Math.atan2(b, a));
      img.setScale(sx * up, ((a * d - b * c) / sx) * up);
    }
    this.inner.scaleX = this.puppet.flip;
    this.object.setAlpha(this.puppet.pose.alpha);
  }
}

/**
 * The kit's factory: a rigged drawing at (x, y). `binding.rig` is RigData (or its JSON), a bake
 * (`bakeBound`), or `{ rig, bake }`; without a bake the drawing is bound here (cached per image).
 */
export const createRiggedMesh: RiggedFactory = (scene, x, y, binding) => {
  const bound = boundFor(binding);
  const texKey = `amble-rig:${binding.key}:${idOf(binding.image)}:${hashRig(bound.rig)}`;
  acquireTexture(scene, texKey, bound);
  try {
    const webgl = !!(scene.sys.renderer as unknown as { gl?: unknown }).gl;
    return webgl ? new MeshCharacter(scene, x, y, bound, texKey) : new CutoutCharacter(scene, x, y, bound, texKey);
  } catch (e) {
    releaseTexture(scene, texKey);
    throw e;
  }
};
