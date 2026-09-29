/**
 * A cut-out puppet: images on bones, posed by procedural clips every frame. It implements the same
 * RiggedCharacter contract as the rig module's skinned drawings, so a Character does not care whether it
 * shows a stand-in ("just bones") or a drawing. Used for stand-ins, and (with one bone) for drawings that
 * have no rig yet: the sprite then bobs, leans and squashes.
 */
import Phaser from 'phaser';
import type { RigKind } from '../../../play/protocol';
import { env } from '../env';
import type { ClipName, RiggedCharacter } from '../rigged';
import { resolveClip } from '../../../play/kit/synonyms';
import { clipFor, type ClipDef, type Pose } from './clips';
import { GHOST_STYLE } from './paint';
import { solve, type BoneWorld, type Template } from './templates';

export interface PuppetPart {
  bone: string;
  texture: string;
  /** Dash-phase frames ('0', '1'...) for a marching outline; 1 = a plain picture. */
  frames?: number;
  originX: number;
  originY: number;
  /** Image scale (textures are painted at 2x for crisp stand-ins). */
  scale: number;
  depth: number;
}

type FollowBody = Parameters<RiggedCharacter['follow']>[0];

const SMOOTH = 22;
const FLIP_MS = 70;

export class Puppet implements RiggedCharacter {
  readonly object: Phaser.GameObjects.Container;
  clip: string = 'idle';
  /** Speed (px/s) at which walking becomes running. */
  runSpeed = 230;
  private readonly images = new Map<string, Phaser.GameObjects.Image>();
  private readonly world = new Map<string, BoneWorld>();
  private readonly pose: Pose = {};
  private clipDef: ClipDef;
  private clipT = Math.random() * 3;
  private clipSpeed = 1;
  private overlay: { def: ClipDef; t: number; name: string } | null = null;
  private held: string | null = null;
  private body: FollowBody = null;
  private wasGrounded = true;
  private facing: 1 | -1 = 1;
  private flip = 1;
  private destroyed = false;
  private readonly marching: Phaser.GameObjects.Image[] = [];
  private phase = 0;

  constructor(
    scene: Phaser.Scene,
    private readonly template: Template,
    private readonly kind: RigKind,
    parts: PuppetPart[],
    /** The character's height in game px (bob and shake are fractions of it). */
    private readonly height: number,
  ) {
    this.object = new Phaser.GameObjects.Container(scene, 0, 0);
    for (const p of [...parts].sort((a, b) => a.depth - b.depth)) {
      const frames = p.frames ?? 1;
      const img = new Phaser.GameObjects.Image(scene, 0, 0, p.texture, frames > 1 ? '0' : undefined).setOrigin(p.originX, p.originY).setScale(p.scale);
      if (frames > 1) this.marching.push(img);
      this.images.set(p.bone, img);
      this.object.add(img);
    }
    this.clipDef = clipFor(kind, 'idle').def;
    this.apply();
  }

  play(clip: ClipName, opts: { loop?: boolean; speed?: number; fade?: number } = {}): void {
    const name = resolveClip(clip) ?? 'idle';
    const { name: resolved, def } = clipFor(this.kind, name);
    if (!def.loop && opts.loop !== true) {
      this.overlay = { def, t: 0, name: resolved };
      if (def.hold) this.held = resolved;
      return;
    }
    if (this.clip !== resolved) this.clipT = 0;
    this.clip = resolved;
    this.clipDef = def;
    this.clipSpeed = opts.speed ?? 1;
    this.held = null;
  }

  face(dir: 1 | -1): void {
    this.facing = dir < 0 ? -1 : 1;
  }

  follow(body: FollowBody): void {
    this.body = body;
  }

  setTint(color: number | null): void {
    for (const img of this.images.values()) {
      if (color === null) img.clearTint();
      else if (color === 0xffffff) img.setTintFill(0xffffff);
      else img.setTint(color);
    }
  }

  /** Where a bone is right now, in the puppet's local space (for attaching things to hands and heads). */
  bone(name: string): BoneWorld | undefined {
    return this.world.get(name);
  }

  private autoClip(): void {
    const b = this.body;
    if (!b || this.held) return;
    const vx = b.velocity.x;
    const vy = b.velocity.y;
    const hasGround = b.blocked?.down !== undefined || b.touching?.down !== undefined;
    const grounded = !!(b.blocked?.down || b.touching?.down);
    let want: string;
    let speed = 1;
    if (hasGround && !grounded && Math.abs(vy) > 30) want = vy < 0 ? 'rise' : 'fall';
    else {
      const sp = hasGround ? Math.abs(vx) : Math.hypot(vx, vy);
      want = sp < 20 ? 'idle' : sp < this.runSpeed ? 'walk' : 'run';
      if (want !== 'idle') speed = Math.max(0.6, Math.min(1.8, sp / (want === 'run' ? this.runSpeed * 1.3 : this.runSpeed * 0.7)));
    }
    if (hasGround && grounded && !this.wasGrounded && !this.overlay) this.play('land');
    this.wasGrounded = !hasGround || grounded;
    const { name, def } = clipFor(this.kind, want);
    if (name !== this.clip) {
      if (!((this.clip === 'walk' && name === 'run') || (this.clip === 'run' && name === 'walk'))) this.clipT = 0;
      this.clip = name;
      this.clipDef = def;
    }
    this.clipSpeed = speed;
  }

  update(dtMs: number): void {
    if (this.destroyed) return;
    // Game code sets the speed this runs at (`hero.animSpeed`): one NaN frame would stay in the clip clock,
    // the smoothed pose and the paper flip for good, and the character would vanish for the rest of the run.
    if (!Number.isFinite(dtMs)) dtMs = 0;
    const dt = Math.max(0, Math.min(0.1, dtMs / 1000));
    this.autoClip();
    this.clipT += dt * this.clipSpeed;
    let target = this.clipDef.fn(this.clipT);
    if (this.overlay) {
      const o = this.overlay;
      o.t += dt;
      const done = o.def.dur !== undefined && o.t >= o.def.dur;
      if (done && !o.def.hold) this.overlay = null;
      else {
        const layer = o.def.fn(Math.min(o.t, o.def.dur ?? o.t));
        target = o.def.upper ? { ...target, ...layer } : layer;
      }
    }
    const a = 1 - Math.exp(-dt * SMOOTH);
    for (const key of new Set([...Object.keys(target), ...Object.keys(this.pose)])) {
      const rest = key === 'sx' || key === 'sy' ? 1 : 0;
      const want = target[key] ?? rest;
      const cur = this.pose[key];
      this.pose[key] = cur === undefined ? want : cur + (want - cur) * a;
    }
    const step = dtMs / FLIP_MS;
    this.flip = this.flip < this.facing ? Math.min(this.facing, this.flip + step) : Math.max(this.facing, this.flip - step);
    this.march();
    this.apply();
  }

  /** Marches the dashed outline at GHOST_STYLE.march px/s (still under reduced motion). */
  private march(): void {
    if (!this.marching.length) return;
    const s = GHOST_STYLE;
    const e = env();
    const phase = e.prefs.reducedMotion ? 0 : Math.floor((e.now() * s.march * s.phases) / (1000 * (s.dash + s.gap))) % s.phases;
    if (phase === this.phase) return;
    this.phase = phase;
    for (const img of this.marching) img.setFrame(String(phase));
  }

  private apply(): void {
    solve(this.template, this.pose, this.world);
    for (const [bone, img] of this.images) {
      const j = this.world.get(bone);
      if (!j) continue;
      img.setPosition(j.x, j.y);
      img.rotation = j.angle;
    }
    const p = this.pose;
    const shake = p.shake ? (Math.random() - 0.5) * p.shake * this.height * 2 : 0;
    this.object.setPosition(shake, (p.bob ?? 0) * this.height);
    this.object.rotation = (p.rot ?? 0) * (this.facing < 0 ? -1 : 1);
    // The paper flip passes through zero width; never let it vanish completely.
    const fx = Math.abs(this.flip) < 0.08 ? 0.08 * Math.sign(this.flip || 1) : this.flip;
    this.object.setScale(fx * (p.sx ?? 1), p.sy ?? 1);
  }

  destroy(): void {
    this.destroyed = true;
    this.object.destroy();
    this.images.clear();
  }
}
