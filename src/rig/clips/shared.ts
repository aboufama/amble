/** Clips and shapes every kind shares: the jump arc, air states from physics, hurt and die. */
import type { Pose } from '../runtime/pose';
import { clamp01, D, ease, TAU, wobble, type Clip, type ClipCtx } from './ctx';

/**
 * Scripted jump for previews (in a game the physics body moves; see rise/fall/land): anticipation
 * squash → parabolic arc with stretch at take-off and tuck at the apex → landing squash wobble.
 */
export function jumpArc(
  c: ClipCtx, t: number, p: Pose,
  legs: (p: Pose, tuck: number, spread: number) => void, arms: (p: Pose, up: number) => void, pitch = 0, height = 0.6,
): void {
  if (t < 0.16) {
    const k = ease(t / 0.16);
    c.squash(p, 1 + 0.14 * k, 1 - 0.2 * k);
    arms(p, -18 * k);
    legs(p, 0.25 * k, 0);
    p.ground = 1;
  } else if (t < 0.86) {
    const u = (t - 0.16) / 0.7;
    p.gy = -height * c.H * 4 * u * (1 - u);
    const st = Math.pow(1 - u, 3) * 0.22 + Math.max(0, u - 0.7) * 0.2;
    c.squash(p, 1 - st * 0.6, 1 + st);
    // stretch about the feet at take-off (they stay down), about the middle in the air
    p.pivotY = -0.45 * c.H * Math.min(1, u / 0.25);
    arms(p, 70 * (1 - u) + 25 * u);
    legs(p, Math.sin(Math.PI * u), u > 0.75 ? (u - 0.75) * 2 : 0);
    // nose up rising, nose down falling
    p.grot = pitch * Math.sin(TAU * u) * D * c.dir;
  } else {
    const k = (t - 0.86) / 0.3;
    const wv = wobble(k, 11, 5);
    c.squash(p, 1 + 0.16 * wv, 1 - 0.22 * wv);
    arms(p, 25 * (1 - clamp01(k * 2)));
    legs(p, 0.3 * Math.max(0, wv), 0);
    p.ground = 1;
  }
}

/** Limbs in the air, for any kind: legs tuck, arms and wings lift, tails follow. */
export function airLimbs(c: ClipCtx, p: Pose, tuck: number, arms: number): void {
  for (const n of ['legL', 'legR', 'legFL', 'legFR']) {
    c.swing(p, `${n}1`, 20 * tuck);
    c.swing(p, `${n}2`, -40 * tuck);
  }
  for (const n of ['legBL', 'legBR']) {
    c.swing(p, `${n}1`, -20 * tuck);
    c.swing(p, `${n}2`, 25 * tuck);
  }
  c.raise(p, 'armL1', arms);
  c.raise(p, 'armR1', arms);
  c.raise(p, 'tail1', arms * 0.4);
}

export const rise: Clip = {
  name: 'rise', loop: true, dur: 1,
  fn(c, _t, p) {
    c.squash(p, 0.94, 1.1);
    p.pivotY = -0.5 * c.H;
    airLimbs(c, p, 0.5, 60);
    c.rot(p, 'top', 6);
  },
};

export const fall: Clip = {
  name: 'fall', loop: true, dur: 0.6,
  fn(c, t, p) {
    const fl = Math.sin((TAU * t) / this.dur);
    c.squash(p, 0.98, 1.04);
    p.pivotY = -0.5 * c.H;
    airLimbs(c, p, 0.15, 40 + 12 * fl);
    c.rot(p, 'top', -5 + 3 * fl);
  },
};

export const land: Clip = {
  name: 'land', loop: false, dur: 0.32,
  fn(c, t, p) {
    const wv = wobble(t / 0.32, 11, 5);
    c.squash(p, 1 + 0.15 * wv, 1 - 0.2 * wv);
    airLimbs(c, p, 0.3 * Math.max(0, wv), 10 * wv);
    c.rot(p, 'top', -8 * wv);
    p.ground = 1;
  },
};

export const hurt: Clip = {
  name: 'hurt', loop: false, dur: 0.5, upper: true,
  fn(c, t, p) {
    const k = wobble(t, 18, 7);
    c.swing(p, 'spine', -12 * k);
    c.swing(p, 'body', -8 * k);
    c.rot(p, 'head', -10 * k);
    c.rot(p, 'top', -12 * k);
    c.raise(p, 'armL1', 25 * Math.abs(k));
    c.raise(p, 'armR1', 25 * Math.abs(k));
    c.raise(p, 'wingL1', 20 * Math.abs(k));
    c.raise(p, 'wingR1', 20 * Math.abs(k));
    c.raise(p, 'tail1', 15 * k);
    c.squash(p, 1 - 0.1 * k, 1 + 0.1 * k);
    p.flash = t < 0.12 ? 1 : 0;
    p.ground = 1;
  },
};

/**
 * Falls over about the feet, bounces once, fades. `side` picks which way (backward by default).
 * Holds its last frame.
 */
export function topple(c: ClipCtx, t: number, p: Pose, opts: { angle?: number; pivotY?: number; fade?: boolean } = {}): void {
  const angle = opts.angle ?? -84;
  p.flash = t < 0.1 ? 1 : 0;
  if (t < 0.15) {
    const k = wobble(t, 18, 7);
    c.squash(p, 1 - 0.1 * k, 1 + 0.1 * k);
    p.ground = 1;
    return;
  }
  const u = clamp01((t - 0.15) / 0.45);
  const fallA = u * u; // gravity: slow start, fast end
  const bounce = t > 0.6 ? wobble(t - 0.6, 16, 7) * 0.12 : 0;
  p.grot = (angle * (fallA - bounce)) * D * c.dir;
  p.pivotY = opts.pivotY ?? 0;
  if (t > 0.6) c.squash(p, 1 + 0.08 * Math.abs(bounce) * 8, 1 - 0.08 * Math.abs(bounce) * 8);
  if (opts.fade !== false) p.alpha = 1 - clamp01((t - 0.85) / 0.35);
}

export const die: Clip = {
  name: 'die', loop: false, dur: 1.2, hold: true,
  fn(c, t, p) {
    const u = clamp01((t - 0.15) / 0.45);
    // limbs go loose while falling
    c.raise(p, 'armL1', 40 * u);
    c.raise(p, 'armR1', 30 * u);
    c.swing(p, 'legL1', 10 * u);
    c.rot(p, 'head', -10 * u);
    topple(c, t, p);
  },
};

/** Shakes and grows (about the feet), fists and tail up: a boss getting angry. */
export const rage: Clip = {
  name: 'rage', loop: true, dur: 0.5,
  fn(c, t, p) {
    const pulse = Math.sin((TAU * 2 * t) / this.dur);
    c.squash(p, 1.1 + 0.02 * pulse, 1.1 + 0.02 * pulse);
    p.gx = 0.025 * c.H * Math.sin(TAU * 9 * t) * c.amount;
    c.raise(p, 'armL1', 35 + 8 * pulse);
    c.raise(p, 'armR1', 35 - 8 * pulse);
    c.raise(p, 'armL2', 30);
    c.raise(p, 'armR2', 30);
    c.swing(p, 'spine', 4);
    c.rot(p, 'head', 4 * Math.sin(TAU * 6 * t));
    c.rot(p, 'top', 6 * Math.sin(TAU * 6 * t));
    c.raise(p, 'tail1', 20);
    c.raise(p, 'wingL1', 25 + 10 * pulse);
    c.raise(p, 'wingR1', 25 + 10 * pulse);
    p.ground = 1;
  },
};

/** A happy side-to-side wiggle for any kind. */
export const wiggle: Clip = {
  name: 'wiggle', loop: true, dur: 0.9,
  fn(c, t, p) {
    const s = Math.sin((TAU * t) / this.dur);
    c.squash(p, 1 + 0.07 * s, 1 - 0.07 * s);
    c.lean(p, 6 * Math.sin((TAU * t) / this.dur + 1.2));
    c.rot(p, 'top', 8 * s);
    c.rot(p, 'head', 5 * s);
    c.rot(p, 'spine', 4 * s);
    c.raise(p, 'armL1', 12 * (1 + s));
    c.raise(p, 'armR1', 12 * (1 - s));
    c.raise(p, 'tail1', 18 * s);
    p.ground = 1;
  },
};

/** A full turn about the middle. */
export const spin: Clip = {
  name: 'spin', loop: true, dur: 0.8,
  fn(c, t, p) {
    p.grot = ((360 * t) / this.dur) * D * c.dir;
    p.pivotY = -0.5 * c.H;
    c.lift(p, 0.08);
  },
};

export const SHARED_CLIPS: Clip[] = [rise, fall, land, hurt, die, rage, wiggle, spin];
