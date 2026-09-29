/**
 * Clips for flyers: hover, fly (flap 4-5 Hz with the body bobbing against the wings), glide, dive,
 * tumble. Sideways wings (bats, front view) flap up and down; upright wings (birds, side view) sweep
 * back and foreshorten on the downstroke.
 */
import type { Pose } from '../runtime/pose';
import { clamp01, D, ease, TAU, type Clip, type ClipCtx } from './ctx';
import { topple } from './shared';

const WINGS = ['wingL', 'wingR'];

/** Flap all wings: phase ph, amplitude amp degrees; returns the downstroke amount (0..1). */
function flap(c: ClipCtx, p: Pose, ph: number, amp: number, open = 0): number {
  const s = Math.sin(ph);
  for (const w of WINGS) {
    const i = c.sk.role(`${w}1`);
    if (i < 0) continue;
    const a = c.sk.restA[i];
    const sideways = Math.abs(Math.cos(a)) > Math.abs(Math.sin(a));
    if (sideways) {
      c.raise(p, `${w}1`, amp * s + open);
      c.raise(p, `${w}2`, amp * 0.45 * Math.sin(ph - 0.9) + open * 0.5);
    } else {
      // upright wing seen from the side: sweep back and foreshorten on the downstroke
      const down = 0.5 - 0.5 * s;
      c.swing(p, `${w}1`, -amp * 1.4 * down + open);
      c.scale(p, `${w}1`, 1 - 0.25 * down, 1);
      c.swing(p, `${w}2`, -amp * 0.5 * Math.max(0, Math.sin(ph - 0.9)));
    }
  }
  return 0.5 - 0.5 * s;
}

function dangle(c: ClipCtx, p: Pose, t: number): void {
  c.swing(p, 'legL1', -10 + 4 * Math.sin(TAU * t));
  c.swing(p, 'legR1', -12 + 4 * Math.sin(TAU * t + 1));
  c.raise(p, 'tail1', 6 * Math.sin(TAU * t * 1.3));
}

const idle: Clip = {
  name: 'idle', loop: true, dur: 0.8,
  fn(c, t, p) {
    const ph = (TAU * t) / this.dur;
    const down = flap(c, p, ph, 22);
    c.lift(p, 0.03 * down - 0.015);
    c.rot(p, 'head', 3 * Math.sin(ph * 0.5));
    dangle(c, p, t);
  },
};

function flying(c: ClipCtx, t: number, p: Pose, rate: number, amp: number, lean: number, bob: number): void {
  const ph = TAU * rate * t;
  const down = flap(c, p, ph, amp);
  c.lift(p, bob * down);
  c.lean(p, lean);
  c.rot(p, 'head', -lean * 0.5);
  dangle(c, p, t);
  p.pivotY = -0.5 * c.H;
}

const walk: Clip = { name: 'walk', loop: true, dur: 0.5, gait: true, fn(c, t, p) { flying(c, t, p, 4, 40, 6, 0.05); } };
const run: Clip = { name: 'run', loop: true, dur: 0.4, gait: true, fn(c, t, p) { flying(c, t, p, 5, 45, 12, 0.06); } };
const fly: Clip = { name: 'fly', loop: true, dur: 0.5, gait: true, fn(c, t, p) { flying(c, t, p, 4, 40, 6, 0.05); } };

const glide: Clip = {
  name: 'glide', loop: true, dur: 2,
  fn(c, t, p) {
    const s = Math.sin((TAU * t) / this.dur);
    flap(c, p, -Math.PI / 2, 0, 12);
    c.lift(p, 0.02 * s);
    c.lean(p, 4 + 2 * s);
    p.pivotY = -0.5 * c.H;
    dangle(c, p, t);
  },
};

const jump: Clip = {
  name: 'jump', loop: false, dur: 1.0,
  fn(c, t, p) {
    const u = t / this.dur;
    const down = flap(c, p, TAU * 5 * t, 50 * (1 - u * 0.5));
    p.gy = -0.5 * c.H * Math.sin(Math.PI * u) * c.amount;
    c.lift(p, 0.04 * down);
    c.squash(p, 1 - 0.06 * down, 1 + 0.06 * down);
    p.pivotY = -0.5 * c.H;
  },
};

const rise: Clip = {
  name: 'rise', loop: true, dur: 0.4,
  fn(c, t, p) {
    const down = flap(c, p, TAU * 5 * t, 50);
    c.lift(p, 0.05 * down);
    c.lean(p, -6);
    p.pivotY = -0.5 * c.H;
    dangle(c, p, t);
  },
};

const fall: Clip = {
  name: 'fall', loop: true, dur: 0.6,
  fn(c, t, p) {
    flap(c, p, (TAU * t) / this.dur, 10, 25);
    c.lean(p, 8);
    p.pivotY = -0.5 * c.H;
    dangle(c, p, t);
  },
};

const land: Clip = {
  name: 'land', loop: false, dur: 0.35,
  fn(c, t, p) {
    const k = 1 - t / this.dur;
    flap(c, p, -Math.PI / 2, 0, -20 * k);
    c.squash(p, 1 + 0.12 * k, 1 - 0.14 * k);
    p.ground = 1;
  },
};

const attack: Clip = {
  name: 'attack', loop: false, dur: 0.6,
  fn(c, t, p) {
    // dive: tip forward with the wings swept back, then pull up
    const dive = ease(clamp01(t / 0.2)) * (1 - ease(clamp01((t - 0.35) / 0.25)));
    flap(c, p, -Math.PI / 2, 0, -30 * dive);
    p.grot = 28 * dive * D * c.dir;
    p.gx = 0.15 * c.H * dive * c.dir;
    p.gy = 0.08 * c.H * dive;
    p.pivotY = -0.5 * c.H;
    c.rot(p, 'head', -10 * dive);
  },
};

const die: Clip = {
  name: 'die', loop: false, dur: 1.2, hold: true,
  fn(c, t, p) {
    flap(c, p, TAU * 3 * t, 30 * (1 - clamp01(t / 0.8)));
    topple(c, t, p, { angle: -160, pivotY: -0.5 * c.H });
  },
};

const win: Clip = {
  name: 'win', loop: true, dur: 1.2,
  fn(c, t, p) {
    const u = t / this.dur;
    flap(c, p, TAU * 4 * t, 42);
    p.grot = 360 * ease(clamp01(u / 0.6)) * D * c.dir;
    c.lift(p, 0.15 * Math.sin(Math.PI * clamp01(u / 0.6)));
    p.pivotY = -0.5 * c.H;
  },
};

export const FLYER_CLIPS: Clip[] = [idle, walk, run, fly, glide, jump, rise, fall, land, attack, die, win];
