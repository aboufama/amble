/** Clips for four-legged animals (side view): trot, gallop, jump with pitch, lunge, lie down. */
import type { Pose } from '../runtime/pose';
import { clamp01, D, ease, TAU, wobble, type Clip, type ClipCtx } from './ctx';
import { jumpArc } from './shared';

const idle: Clip = {
  name: 'idle', loop: true, dur: 2.4,
  fn(c, t, p) {
    const b = Math.sin((TAU * t) / this.dur);
    c.scale(p, 'spine', 1, 1 + 0.035 * b);
    c.rot(p, 'neck', 3 * Math.sin((TAU * t) / this.dur + 1));
    c.rot(p, 'head', 4 * Math.sin((TAU * t) / (this.dur * 1.5)));
    c.raise(p, 'tail1', 10 * Math.sin((TAU * t) / 1.2));
    c.squash(p, 1, 1 + 0.01 * b);
    p.ground = 1;
  },
};

/** Legs in pairs: trot = diagonal pairs together; gallop = front pair, then back pair. */
function gait(c: ClipCtx, ph: number, p: Pose, leg: number, knee: number, bob: number, gallop: boolean): void {
  const pairs: [string, number][] = gallop
    ? [['legFL', 0], ['legFR', 0.5], ['legBL', Math.PI], ['legBR', Math.PI + 0.5]]
    : [['legBL', 0], ['legFR', 0], ['legBR', Math.PI], ['legFL', Math.PI]];
  for (const [n, off] of pairs) {
    c.swing(p, `${n}1`, leg * Math.sin(ph + off));
    c.swing(p, `${n}2`, -knee * Math.pow(Math.max(0, Math.cos(ph + off)), 1.5));
  }
  c.rot(p, 'spine', (gallop ? 4 : 1.5) * Math.sin(gallop ? ph : 2 * ph));
  c.rot(p, 'neck', 3 * Math.sin(2 * ph + 1));
  c.rot(p, 'head', -2 * Math.sin(2 * ph + 1.4));
  c.raise(p, 'tail1', 8 * Math.sin(2 * ph));
  const bounce = Math.cos(gallop ? ph : 2 * ph);
  c.squash(p, 1 - bob * 0.5 * bounce, 1 + bob * bounce);
  if (gallop) c.lift(p, 0.04 * Math.max(0, -bounce));
  p.ground = 1;
}

const walk: Clip = { name: 'walk', loop: true, dur: 0.9, gait: true, fn(c, t, p) { gait(c, (TAU * t) / this.dur, p, 22, 34, 0.02, false); } };
const run: Clip = { name: 'run', loop: true, dur: 0.5, gait: true, fn(c, t, p) { gait(c, (TAU * t) / this.dur, p, 34, 58, 0.05, true); } };

function legs(c: ClipCtx, p: Pose, tuck: number, spread: number): void {
  for (const n of ['legFL', 'legFR']) {
    c.swing(p, `${n}1`, 30 * tuck - 10 * spread);
    c.swing(p, `${n}2`, -40 * tuck);
  }
  for (const n of ['legBL', 'legBR']) {
    c.swing(p, `${n}1`, -30 * tuck + 10 * spread);
    c.swing(p, `${n}2`, 20 * tuck);
  }
}

const jump: Clip = {
  name: 'jump', loop: false, dur: 1.16,
  fn(c, t, p) {
    jumpArc(c, t, p, (q, tuck, spread) => legs(c, q, tuck, spread), (q, up) => {
      c.raise(q, 'tail1', up * 0.5);
      c.rot(q, 'neck', -up * 0.15);
    }, -12);
  },
};

const attack: Clip = {
  name: 'attack', loop: false, dur: 0.5,
  fn(c, t, p) {
    // crouch back, then lunge with the head
    const crouch = ease(clamp01(t / 0.15)) * (1 - ease(clamp01((t - 0.15) / 0.08)));
    const lunge = t < 0.15 ? 0 : ease(clamp01((t - 0.15) / 0.08)) * (1 - ease(clamp01((t - 0.3) / 0.2)));
    p.gx = (-0.06 * crouch + 0.12 * lunge) * c.H * c.dir;
    c.squash(p, 1 + 0.05 * lunge, 1 - 0.08 * crouch);
    c.rot(p, 'neck', 12 * crouch - 18 * lunge);
    c.rot(p, 'head', 8 * lunge);
    c.swing(p, 'legFL1', 18 * lunge);
    c.swing(p, 'legFR1', 22 * lunge);
    c.swing(p, 'legBL1', -12 * crouch);
    c.swing(p, 'legBR1', -12 * crouch);
    c.raise(p, 'tail1', 20 * lunge);
    p.ground = 1;
  },
};

/** The legs fold, then the animal rolls onto its back with its legs in the air, bounces and fades. */
const die: Clip = {
  name: 'die', loop: false, dur: 1.3, hold: true,
  fn(c, t, p) {
    p.flash = t < 0.1 ? 1 : 0;
    if (t < 0.15) {
      const k = wobble(t, 18, 7);
      c.squash(p, 1 - 0.08 * k, 1 + 0.08 * k);
      p.ground = 1;
      return;
    }
    const fold = ease(clamp01((t - 0.15) / 0.3));
    for (const n of ['legFL', 'legFR', 'legBL', 'legBR']) c.swing(p, `${n}2`, -35 * fold);
    c.swing(p, 'legFL1', 15 * fold);
    c.swing(p, 'legFR1', 22 * fold);
    c.swing(p, 'legBL1', -15 * fold);
    c.swing(p, 'legBR1', -22 * fold);
    c.rot(p, 'neck', 15 * fold);
    c.raise(p, 'tail1', -15 * fold);
    const roll = ease(clamp01((t - 0.4) / 0.4));
    const si = c.sk.role('spine');
    const mid = si >= 0 ? (c.sk.restY[si] + c.sk.rig.bones[si].y2) / 2 - c.sk.anchorY : -0.5 * c.H;
    p.pivotY = mid;
    p.grot = 180 * roll * D * c.dir;
    // the middle sinks until the back rests on the ground
    const bounce = t > 0.8 ? wobble(t - 0.8, 16, 7) * 0.05 * c.H : 0;
    p.gy = (-mid - 0.15 * c.H) * roll - bounce;
    c.squash(p, 1 + 0.04 * fold, 1 - 0.08 * fold);
    p.ground = 1 - roll;
    p.alpha = 1 - clamp01((t - 0.95) / 0.35);
  },
};

const win: Clip = {
  name: 'win', loop: true, dur: 0.6,
  fn(c, t, p) {
    const u = t / this.dur;
    const hop = Math.max(0, Math.sin(TAU * u));
    c.lift(p, 0.1 * hop);
    c.raise(p, 'tail1', 25 * Math.sin(TAU * 3 * u));
    c.rot(p, 'neck', -8 * hop);
    legs(c, p, 0.4 * hop, 0);
    c.squash(p, 1 + 0.05 * wobble(u, 12, 4), 1 - 0.04 * wobble(u, 12, 4));
    p.ground = 1 - hop;
  },
};

export const QUADRUPED_CLIPS: Clip[] = [idle, walk, run, jump, attack, die, win];
