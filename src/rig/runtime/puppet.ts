/**
 * A rigged character without a renderer: clips, facing, physics following, springs and skinning.
 * The Phaser mesh, the Canvas 2D previews and the contact-sheet renderer all drive one of these.
 */
import type { BoundRig, RigData } from '../types';
import { Animator, type PlayOptions } from './animator';
import { Pose } from './pose';
import { Skeleton, skinVertices } from './skeleton';

/** Anything with a velocity; `blocked`/`touching` (Arcade bodies) mean it lives on a ground. */
export interface BodyLike {
  velocity: { x: number; y: number };
  blocked?: { down?: boolean };
  touching?: { down?: boolean };
}

export interface FollowSpeeds {
  /** World px/s of a normal walk (default 1.2 heights per second). */
  walk?: number;
  /** World px/s of a run (default 3.2 heights per second). */
  run?: number;
}

export interface PuppetUpdate {
  /** How far the character moved in the world since the last update (world px), for springs and wheels. */
  dx?: number;
  dy?: number;
  /** World px per art px (the object's scale), to convert motion into art px. */
  scale?: number;
}

/** The paper-flip turn takes this long (seconds) from facing one way to the other. */
const FLIP_TIME = 0.07;

export class RigPuppet {
  readonly skeleton: Skeleton;
  readonly animator: Animator;
  readonly pose: Pose;
  /** Skinned vertices, anchor-relative art px, mirrored by the current flip (null without a mesh). */
  readonly vertices: Float32Array | null;
  readonly bound: BoundRig | null;
  readonly rig: RigData;
  /** Current x scale of the paper flip, -1..1. */
  flip = 1;
  private want: 1 | -1 = 1;
  private readonly drawn: 1 | -1 | 0;
  private body: BodyLike | null = null;
  private speeds: FollowSpeeds = {};
  private wasGround = true;
  private moving = false;
  private readonly local: Float32Array | null;

  constructor(src: BoundRig | RigData) {
    const bound = 'rest' in src ? src : null;
    this.bound = bound;
    this.rig = bound ? bound.rig : (src as RigData);
    let height: number | undefined;
    if (bound) {
      let minY = Infinity;
      for (let v = 1; v < bound.rest.length; v += 2) minY = Math.min(minY, bound.rest[v]);
      height = this.rig.anchor[1] - minY;
    }
    this.skeleton = new Skeleton(this.rig, { height });
    this.animator = new Animator(this.skeleton, this.rig.kind, { flat: bound?.flat ?? true, tweaks: this.rig.anims });
    this.pose = new Pose(this.skeleton.n);
    this.drawn = this.rig.facing;
    this.local = bound ? new Float32Array(bound.rest.length) : null;
    this.vertices = bound ? new Float32Array(bound.rest.length) : null;
    this.animator.ctx.dir = this.drawn === -1 ? -1 : 1;
    this.solve(0, 0, 0);
  }

  /** The clip the character is visibly playing. */
  get clip(): string {
    return this.animator.current;
  }

  /** Which way the character faces now (1 = right, -1 = left). */
  get facing(): 1 | -1 {
    return this.want;
  }

  play(clip: string, opts?: PlayOptions): boolean {
    return this.animator.play(clip, opts);
  }

  /**
   * Turns to face right (1) or left (-1). Side-view drawings turn with a quick paper flip; drawings
   * that face the viewer are never mirrored (their text stays readable), they lean and step that way.
   */
  face(dir: number): void {
    if (dir) this.want = dir > 0 ? 1 : -1;
  }

  /** Picks idle/walk/run/rise/fall/land and the facing from a body's velocity every update; null stops. */
  follow(body: BodyLike | null, speeds: FollowSpeeds = {}): void {
    this.body = body;
    this.speeds = speeds;
    this.wasGround = true;
  }

  private followStep(scale: number): void {
    const b = this.body;
    if (!b) return;
    const a = this.animator;
    const kind = this.rig.kind;
    const H = this.skeleton.height * scale;
    const walkV = this.speeds.walk ?? 1.2 * H, runV = this.speeds.run ?? 3.2 * H;
    const hasGround = b.blocked !== undefined || b.touching !== undefined;
    const ground = !hasGround || !!b.blocked?.down || !!b.touching?.down;
    const vx = b.velocity.x, vy = b.velocity.y;
    const s = hasGround ? Math.abs(vx) : Math.hypot(vx, vy);
    if (Math.abs(vx) > 10) this.face(vx);
    const locomote = (idleBelow = 0.25) => {
      if (s > runV * 0.7) {
        a.play('run');
        a.speed = Math.max(0.6, s / runV);
      } else if (s > walkV * idleBelow) {
        a.play('walk');
        a.speed = Math.max(0.6, s / walkV);
      } else {
        a.play('idle');
        a.speed = 1;
      }
    };
    if (kind === 'flyer') {
      if (a.busy) return;
      if (ground && s <= walkV * 0.25) {
        a.play('idle');
        a.speed = 1;
      } else if (!ground && vy < -0.5 * walkV) a.play('rise');
      else if (!ground && vy > 0.8 * walkV) a.play('fall');
      else locomote();
      return;
    }
    if (kind === 'swimmer') {
      if (!a.busy) locomote(0.2);
      return;
    }
    if (!ground) {
      if (!a.busy || a.baseClip === 'jump') a.play(vy < 0 ? 'rise' : 'fall', { fade: 0.12 });
      a.speed = 1;
    } else if (!this.wasGround) {
      a.play('land', { fade: 0.05 });
      a.speed = 1;
    } else if (!a.busy) locomote();
    this.wasGround = ground;
  }

  /** Advances by dt seconds (game time) and re-skins. */
  update(dt: number, motion: PuppetUpdate = {}): void {
    const scale = motion.scale || 1;
    this.followStep(scale);
    // paper flip toward the wanted side (side views only)
    const target = this.drawn === 0 ? 1 : this.want * this.drawn;
    if (this.flip !== target) {
      const before = Math.sign(this.flip);
      const d = dt / FLIP_TIME;
      this.flip = target > this.flip ? Math.min(target, this.flip + d) : Math.max(target, this.flip - d);
      if (Math.sign(this.flip) !== before && this.flip !== 0) this.skeleton.mirrorSprings();
    }
    const ctx = this.animator.ctx;
    ctx.dir = this.drawn === 0 ? this.want : this.drawn;
    const sgn = this.flip >= 0 ? 1 : -1;
    const mdx = ((motion.dx ?? 0) / scale) * sgn, mdy = (motion.dy ?? 0) / scale;
    if (motion.dx) this.moving = true;
    ctx.moving = this.moving || !!this.body;
    ctx.distance += mdx;
    this.animator.update(dt, this.pose);
    this.solve(dt, mdx, mdy);
  }

  private solve(dt: number, mdx: number, mdy: number): void {
    this.skeleton.solve(this.pose, dt, mdx, mdy, dt > 0);
    if (!this.bound || !this.local || !this.vertices) return;
    skinVertices(this.skeleton, this.bound, this.local);
    const f = this.flip, out = this.vertices, src = this.local;
    for (let i = 0; i < src.length; i += 2) {
      out[i] = src[i] * f;
      out[i + 1] = src[i + 1];
    }
  }

  /** A bone's joint in art px relative to the anchor (mirrored like the drawing), and its angle. */
  bone(name: string): { x: number; y: number; angle: number } | null {
    const i = this.skeleton.role(name);
    if (i < 0) return null;
    const [x1, y1, x2, y2] = this.skeleton.bonePoints(i);
    const f = this.flip;
    return { x: x1 * f, y: y1, angle: Math.atan2(y2 - y1, (x2 - x1) * f) };
  }
}
