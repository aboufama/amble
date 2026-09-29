/**
 * Clips for things (props, vehicles, items): a small wobble, rolling on wheels that turn by the
 * distance travelled over their radius, hops, bumps, tipping over, a spin.
 */
import type { Pose } from '../runtime/pose';
import { clamp01, D, ease, TAU, wobble, type Clip, type ClipCtx } from './ctx';
import { topple } from './shared';

/** Turns every `wheel*` bone by distance / radius. `speed` (heights per second) is used when not moving. */
function wheels(c: ClipCtx, p: Pose, t: number, speed: number): void {
  const d = c.moving ? c.distance : speed * c.H * t * c.dir;
  const bones = c.sk.rig.bones;
  for (let i = 0; i < bones.length; i++) {
    if (!bones[i].name.startsWith('wheel')) continue;
    p.rot[i] += d / Math.max(2, c.sk.len[i]);
  }
}

const idle: Clip = {
  name: 'idle', loop: true, dur: 2.2,
  fn(c, t, p) {
    const b = Math.sin((TAU * t) / this.dur);
    c.squash(p, 1 - 0.008 * b, 1 + 0.012 * b);
    c.rot(p, 'extra1', 4 * Math.sin((TAU * t) / this.dur + 1));
    p.ground = 1;
  },
};

function roll(c: ClipCtx, t: number, p: Pose, speed: number, bob: number, lean: number, rate: number): void {
  wheels(c, p, t, speed);
  const s = Math.sin(TAU * rate * t);
  c.lift(p, bob * Math.abs(s));
  c.lean(p, lean + 1.5 * s);
  p.pivotY = -0.1 * c.H;
}

const walk: Clip = { name: 'walk', loop: true, dur: 0.6, gait: true, fn(c, t, p) { roll(c, t, p, 1.2, 0.02, 1, 1 / this.dur); } };
const run: Clip = { name: 'run', loop: true, dur: 0.4, gait: true, fn(c, t, p) { roll(c, t, p, 3, 0.035, 4, 1 / this.dur); } };

const jump: Clip = {
  name: 'jump', loop: false, dur: 0.9,
  fn(c, t, p) {
    const u = t / this.dur;
    if (u < 0.15) {
      const k = ease(u / 0.15);
      c.squash(p, 1 + 0.1 * k, 1 - 0.14 * k);
      p.ground = 1;
    } else if (u < 0.8) {
      const a = (u - 0.15) / 0.65;
      p.gy = -0.55 * c.H * Math.sin(Math.PI * a) * c.amount;
      p.grot = -8 * Math.sin(TAU * a) * D * c.dir;
      p.pivotY = -0.5 * c.H;
    } else {
      const wv = wobble((u - 0.8) / 0.2, 11, 5);
      c.squash(p, 1 + 0.12 * wv, 1 - 0.16 * wv);
      p.ground = 1;
    }
  },
};

const rise: Clip = { name: 'rise', loop: true, dur: 1, fn(c, _t, p) { c.squash(p, 0.95, 1.07); c.lean(p, -5); p.pivotY = -0.5 * c.H; } };
const fall: Clip = { name: 'fall', loop: true, dur: 1, fn(c, _t, p) { c.squash(p, 0.98, 1.03); c.lean(p, 5); p.pivotY = -0.5 * c.H; } };

const land: Clip = {
  name: 'land', loop: false, dur: 0.35,
  fn(c, t, p) {
    const wv = wobble(t / this.dur, 11, 5);
    c.squash(p, 1 + 0.12 * wv, 1 - 0.16 * wv);
    p.ground = 1;
  },
};

const attack: Clip = {
  name: 'attack', loop: false, dur: 0.45,
  fn(c, t, p) {
    const back = ease(clamp01(t / 0.15)) * (1 - ease(clamp01((t - 0.15) / 0.06)));
    const bump = t < 0.15 ? 0 : ease(clamp01((t - 0.15) / 0.06)) * (1 - ease(clamp01((t - 0.25) / 0.2)));
    p.gx = (-0.05 * back + 0.14 * bump) * c.H * c.dir;
    c.lean(p, -8 * back + 10 * bump);
    c.squash(p, 1 + 0.06 * bump, 1 - 0.05 * bump);
    p.ground = 1;
  },
};

const hurt: Clip = {
  name: 'hurt', loop: false, dur: 0.45,
  fn(c, t, p) {
    const k = wobble(t, 26, 8);
    p.gx = 0.04 * c.H * k;
    c.squash(p, 1 - 0.06 * k, 1 + 0.06 * k);
    p.flash = t < 0.12 ? 1 : 0;
    p.ground = 1;
  },
};

const die: Clip = { name: 'die', loop: false, dur: 1.2, hold: true, fn(c, t, p) { topple(c, t, p, { angle: -90 }); } };

const spin: Clip = {
  name: 'spin', loop: true, dur: 0.8,
  fn(c, t, p) {
    p.grot = (360 * t / this.dur) * D * c.dir;
    p.pivotY = -0.5 * c.H;
    wheels(c, p, t, 2);
  },
};

const wiggle: Clip = {
  name: 'wiggle', loop: true, dur: 0.9,
  fn(c, t, p) {
    const s = Math.sin((TAU * t) / this.dur);
    c.squash(p, 1 + 0.07 * s, 1 - 0.07 * s);
    c.lean(p, 5 * Math.sin((TAU * t) / this.dur + 1.2));
    p.ground = 1;
  },
};

const win: Clip = {
  name: 'win', loop: true, dur: 0.6,
  fn(c, t, p) {
    const u = t / this.dur;
    const hop = Math.max(0, Math.sin(TAU * u));
    c.lift(p, 0.14 * hop);
    c.squash(p, 1 + 0.06 * (1 - hop), 1 - 0.05 * (1 - hop));
    p.grot = 8 * Math.sin(TAU * u) * D * c.dir;
    p.pivotY = -0.5 * c.H;
    p.ground = 1 - hop;
  },
};

export const OBJECT_CLIPS: Clip[] = [idle, walk, run, jump, rise, fall, land, attack, hurt, die, spin, wiggle, win];
