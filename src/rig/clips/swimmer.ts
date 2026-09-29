/**
 * Clips for swimmers (fish, snakes, worms): a travelling wave runs from head to tail along the chain,
 * growing toward the tail (rot_i = A_i sin(ωt − k·i)); leaps pitch nose up then down.
 */
import type { Pose } from '../runtime/pose';
import { clamp01, D, ease, TAU, wobble, type Clip, type ClipCtx } from './ctx';

const CHAIN = ['head', 'neck', 'body', 'tail1', 'tail2', 'tail3'];

function wave(c: ClipCtx, p: Pose, t: number, freq: number, amp: number, k = 0.9): void {
  const present = CHAIN.filter((r) => c.has(r));
  const n = Math.max(2, present.length);
  present.forEach((r, i) => {
    const a = amp * (0.2 + (0.8 * i) / (n - 1));
    c.rot(p, r, a * Math.sin(TAU * freq * t - k * i));
  });
}

const idle: Clip = {
  name: 'idle', loop: true, dur: 1.6,
  fn(c, t, p) {
    wave(c, p, t, 1 / this.dur, 6);
    c.lift(p, 0.015 * Math.sin((TAU * t) / this.dur));
  },
};

function swimming(c: ClipCtx, t: number, p: Pose, freq: number, amp: number): void {
  wave(c, p, t, freq, amp);
  c.lift(p, 0.02 * Math.sin(TAU * freq * 2 * t));
  p.pivotY = -0.5 * c.H;
}

const walk: Clip = { name: 'walk', loop: true, dur: 0.625, gait: true, fn(c, t, p) { swimming(c, t, p, 1.6, 12); } };
const run: Clip = { name: 'run', loop: true, dur: 0.42, gait: true, fn(c, t, p) { swimming(c, t, p, 2.4, 16); } };
const swim: Clip = { name: 'swim', loop: true, dur: 0.625, gait: true, fn(c, t, p) { swimming(c, t, p, 1.6, 12); } };

const jump: Clip = {
  name: 'jump', loop: false, dur: 1.1,
  fn(c, t, p) {
    const u = clamp01(t / this.dur);
    wave(c, p, t, 2.5, 14);
    p.gy = -0.8 * c.H * Math.sin(Math.PI * u) * c.amount;
    p.grot = -30 * Math.cos(Math.PI * u) * D * c.dir;
    p.pivotY = -0.5 * c.H;
  },
};

const rise: Clip = { name: 'rise', loop: true, dur: 0.5, fn(c, t, p) { wave(c, p, t, 2, 12); p.grot = -16 * D * c.dir; p.pivotY = -0.5 * c.H; } };
const fall: Clip = { name: 'fall', loop: true, dur: 0.5, fn(c, t, p) { wave(c, p, t, 1.2, 8); p.grot = 16 * D * c.dir; p.pivotY = -0.5 * c.H; } };

const land: Clip = {
  name: 'land', loop: false, dur: 0.4,
  fn(c, t, p) {
    const wv = wobble(t / this.dur, 11, 5);
    c.squash(p, 1 + 0.12 * wv, 1 - 0.16 * wv);
    wave(c, p, t, 2, 10 * (1 - t / this.dur));
  },
};

const attack: Clip = {
  name: 'attack', loop: false, dur: 0.5,
  fn(c, t, p) {
    const coil = ease(clamp01(t / 0.18)) * (1 - ease(clamp01((t - 0.18) / 0.06)));
    const lunge = t < 0.18 ? 0 : ease(clamp01((t - 0.18) / 0.07)) * (1 - ease(clamp01((t - 0.3) / 0.2)));
    p.gx = (-0.08 * coil + 0.2 * lunge) * c.H * c.dir;
    c.rot(p, 'tail1', 20 * coil - 10 * lunge);
    c.rot(p, 'tail2', 25 * coil - 15 * lunge);
    c.rot(p, 'head', -10 * lunge);
    c.squash(p, 1 + 0.08 * lunge, 1 - 0.05 * lunge);
  },
};

const die: Clip = {
  name: 'die', loop: false, dur: 1.3, hold: true,
  fn(c, t, p) {
    // belly up, then fade
    p.flash = t < 0.1 ? 1 : 0;
    const u = ease(clamp01((t - 0.1) / 0.6));
    wave(c, p, t, 3, 14 * (1 - u));
    p.grot = 180 * u * D * c.dir;
    p.pivotY = -0.5 * c.H;
    p.alpha = 1 - clamp01((t - 0.95) / 0.35);
  },
};

const win: Clip = {
  name: 'win', loop: true, dur: 1.2,
  fn(c, t, p) {
    const u = t / this.dur;
    wave(c, p, t, 3, 16);
    const arc = clamp01(u / 0.7);
    p.gy = -0.6 * c.H * Math.sin(Math.PI * arc) * c.amount;
    p.grot = -360 * ease(arc) * D * c.dir;
    p.pivotY = -0.5 * c.H;
  },
};

export const SWIMMER_CLIPS: Clip[] = [idle, walk, run, swim, jump, rise, fall, land, attack, die, win];
