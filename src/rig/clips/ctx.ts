/**
 * Procedural clips address bone ROLES through sign helpers derived from each bone's rest direction, so
 * one clip works for any drawing of its kind: arms up or down, legs long or short, facing the viewer
 * or sideways. Clips are written for "facing right".
 */
import type { Skeleton } from '../runtime/skeleton';
import type { BoneRole } from '../types';
import type { Pose } from '../runtime/pose';

export const D = Math.PI / 180;
export const TAU = Math.PI * 2;

export const ease = (t: number): number => t * t * (3 - 2 * t);
export const clamp01 = (t: number): number => Math.max(0, Math.min(1, t));
/** Damped wobble after an impact at t = 0. */
export const wobble = (t: number, freq = 9, decay = 6): number => Math.exp(-decay * t) * Math.cos(freq * t);

export class ClipCtx {
  /** Amplitude multiplier (the Bouncy slider). */
  amount = 1;
  /**
   * Travel direction for drawings that face the viewer: they lean and swing toward where they go
   * without being mirrored (text on a shirt stays readable). Side-view drawings are mirrored instead.
   */
  dir: 1 | -1 = 1;
  /** Signed distance travelled (art px), for wheels that roll with real motion. */
  distance = 0;
  /** True when the distance comes from real motion (else wheels use the clip's own speed). */
  moving = false;

  constructor(readonly sk: Skeleton) {}

  get H(): number {
    return this.sk.height;
  }

  has(role: BoneRole | string): boolean {
    return this.sk.role(role) >= 0;
  }

  /** Adds rotation in degrees (+ = clockwise). */
  rot(p: Pose, role: BoneRole | string, deg: number): void {
    const i = this.sk.role(role);
    if (i >= 0) p.rot[i] += deg * D * this.amount;
  }

  /** Swings the bone's tip forward (toward where the character goes). */
  swing(p: Pose, role: BoneRole | string, deg: number): void {
    const i = this.sk.role(role);
    if (i >= 0) p.rot[i] += this.sk.fwd[i] * deg * D * this.amount * this.dir;
  }

  /** Raises the tip (outward and up for hanging arms and wings, up for sideways limbs). */
  raise(p: Pose, role: BoneRole | string, deg: number): void {
    const i = this.sk.role(role);
    if (i >= 0) p.rot[i] += this.sk.up[i] * deg * D * this.amount;
  }

  /** Stretches a bone along (sx) and across (sy) its axis. */
  scale(p: Pose, role: BoneRole | string, sx: number, sy: number): void {
    const i = this.sk.role(role);
    if (i < 0) return;
    p.sx[i] *= 1 + (sx - 1) * this.amount;
    p.sy[i] *= 1 + (sy - 1) * this.amount;
  }

  /** Whole-body squash/stretch (x, y), scaled by the amount. */
  squash(p: Pose, sx: number, sy: number): void {
    p.gsx *= 1 + (sx - 1) * this.amount;
    p.gsy *= 1 + (sy - 1) * this.amount;
  }

  /** Whole-body lean in degrees toward the travel direction. */
  lean(p: Pose, deg: number): void {
    p.grot += deg * D * this.amount * this.dir;
  }

  /** Lifts the whole body by a fraction of its height. */
  lift(p: Pose, frac: number): void {
    p.gy -= frac * this.H * this.amount;
  }
}

export interface Clip {
  name: string;
  loop: boolean;
  /** Seconds (cycle length for loops). */
  dur: number;
  /** Gait clips keep their phase when switching between each other (walk ↔ run). */
  gait?: boolean;
  /** Where a one-shot goes when done (default: back to what was playing before, else idle). */
  next?: string;
  /** Holds its last frame when done (die). */
  hold?: boolean;
  /** Plays over running legs on the arms, spine and head (attack, shoot, hurt, wave). */
  upper?: boolean;
  fn(c: ClipCtx, t: number, p: Pose): void;
}
