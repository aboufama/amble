/** Clips for people: stand, walk, run, dash, jump, fly, attack, shoot, wave, win (hurt and die are shared). */
import type { Pose } from '../runtime/pose';
import { clamp01, ease, TAU, wobble, type Clip, type ClipCtx } from './ctx';
import { jumpArc } from './shared';

const idle: Clip = {
  name: 'idle', loop: true, dur: 2.6,
  fn(c, t, p) {
    const b = Math.sin((TAU * t) / this.dur);
    c.scale(p, 'spine', 1 + 0.03 * b, 1 + 0.015 * b);
    c.rot(p, 'head', 2.5 * Math.sin((TAU * t) / this.dur + 0.9));
    c.raise(p, 'armL1', 3 + 3 * b);
    c.raise(p, 'armR1', 3 + 3 * b);
    c.raise(p, 'armL2', 2 * b);
    c.raise(p, 'armR2', 2 * b);
    c.squash(p, 1 - 0.006 * b, 1 + 0.012 * b);
    p.ground = 1;
  },
};

interface StrideStyle { leg: number; knee: number; arm: number; elbow: number; lean: number; bob: number; hop: number }

/** Side-view stride: legs scissor, knees bend on the forward swing, arms opposite. */
function stride(c: ClipCtx, ph: number, p: Pose, s: StrideStyle): void {
  const sL = Math.sin(ph), sR = Math.sin(ph + Math.PI);
  const cL = Math.cos(ph), cR = Math.cos(ph + Math.PI);
  c.swing(p, 'legL1', s.leg * sL);
  c.swing(p, 'legR1', s.leg * sR);
  c.swing(p, 'legL2', -s.knee * Math.pow(Math.max(0, cL), 1.5));
  c.swing(p, 'legR2', -s.knee * Math.pow(Math.max(0, cR), 1.5));
  c.swing(p, 'armL1', -s.arm * sL);
  c.swing(p, 'armR1', -s.arm * sR);
  c.swing(p, 'armL2', s.elbow * (0.6 + 0.4 * Math.sin(ph - 0.6)));
  c.swing(p, 'armR2', s.elbow * (0.6 + 0.4 * Math.sin(ph + Math.PI - 0.6)));
  c.swing(p, 'spine', s.lean + 1.5 * Math.sin(2 * ph));
  c.rot(p, 'head', -2 * Math.sin(2 * ph + 0.5) - s.lean * 0.4);
  const bounce = Math.cos(2 * ph);
  c.squash(p, 1 - s.bob * 0.8 * bounce, 1 + s.bob * bounce);
  c.lift(p, s.hop * Math.max(0, -bounce));
  p.ground = 1;
}

interface MarchStyle { lift: number; knee: number; arm: number; sway: number; bounce: number; lean: number }

/**
 * Front-facing people march instead of scissoring their legs: the lifted leg foreshortens toward the
 * viewer with the knee kicked out, the hip hikes, the torso sways over the standing leg, the arms
 * swing opposite. Legs never cross.
 */
function march(c: ClipCtx, ph: number, p: Pose, s: MarchStyle): void {
  const lL = Math.max(0, Math.sin(ph)), lR = Math.max(0, -Math.sin(ph));
  c.scale(p, 'legL1', 1 - s.lift * lL, 1);
  c.scale(p, 'legR1', 1 - s.lift * lR, 1);
  c.scale(p, 'legL2', 1 - s.lift * 1.2 * lL, 1);
  c.scale(p, 'legR2', 1 - s.lift * 1.2 * lR, 1);
  c.raise(p, 'legL1', s.knee * lL);
  c.raise(p, 'legR1', s.knee * lR);
  c.raise(p, 'legL2', -s.knee * 1.6 * lL);
  c.raise(p, 'legR2', -s.knee * 1.6 * lR);
  c.raise(p, 'armL1', s.arm * (lR - 0.6 * lL));
  c.raise(p, 'armR1', s.arm * (lL - 0.6 * lR));
  c.raise(p, 'armL2', s.arm * 0.5 * lR);
  c.raise(p, 'armR2', s.arm * 0.5 * lL);
  c.rot(p, 'hips', s.sway * 0.6 * (lL - lR));
  c.swing(p, 'spine', s.lean);
  c.rot(p, 'spine', s.sway * (lL - lR));
  c.rot(p, 'head', -s.sway * 0.8 * (lL - lR));
  const step = lL + lR;
  c.squash(p, 1 - s.bounce * 0.8 * (step - 0.5) * 2, 1 + s.bounce * (step - 0.5) * 2);
  p.ground = 1;
}

const walk: Clip = {
  name: 'walk', loop: true, dur: 0.8, gait: true,
  fn(c, t, p) {
    const ph = (TAU * t) / this.dur;
    if (c.sk.rig.facing === 0) march(c, ph, p, { lift: 0.24, knee: 9, arm: 20, sway: 4, bounce: 0.03, lean: 3 });
    else stride(c, ph, p, { leg: 26, knee: 40, arm: 22, elbow: 12, lean: 4, bob: 0.025, hop: 0.012 });
  },
};

const run: Clip = {
  name: 'run', loop: true, dur: 0.5, gait: true,
  fn(c, t, p) {
    const ph = (TAU * t) / this.dur;
    if (c.sk.rig.facing === 0) march(c, ph, p, { lift: 0.4, knee: 16, arm: 42, sway: 5, bounce: 0.06, lean: 9 });
    else stride(c, ph, p, { leg: 40, knee: 75, arm: 42, elbow: 55, lean: 12, bob: 0.05, hop: 0.05 });
  },
};

const dash: Clip = {
  name: 'dash', loop: true, dur: 0.32, gait: true,
  fn(c, t, p) {
    const ph = (TAU * t) / this.dur;
    if (c.sk.rig.facing === 0) {
      march(c, ph, p, { lift: 0.45, knee: 18, arm: 8, sway: 3, bounce: 0.05, lean: 12 });
      c.raise(p, 'armL1', 25);
      c.raise(p, 'armR1', 25);
    } else {
      stride(c, ph, p, { leg: 46, knee: 85, arm: 10, elbow: 40, lean: 16, bob: 0.04, hop: 0.03 });
      // arms swept back
      c.swing(p, 'armL1', -40);
      c.swing(p, 'armR1', -34);
    }
    c.lean(p, 6);
  },
};

/** Flying like a superhero: body along the flight, leading arm out front, legs trailing. */
const fly: Clip = {
  name: 'fly', loop: true, dur: 1.2,
  fn(c, t, p) {
    const b = Math.sin((TAU * t) / this.dur);
    p.pivotY = -0.5 * c.H;
    c.lift(p, 0.12 + 0.03 * b);
    if (c.sk.rig.facing === 0) {
      c.lean(p, 10 + 2 * b);
      c.raise(p, 'armR1', 45);
      c.raise(p, 'armL1', 20);
      c.raise(p, 'legL1', 6 + 3 * b);
      c.raise(p, 'legR1', -4 - 3 * b);
    } else {
      c.lean(p, 58 + 3 * b);
      c.swing(p, 'armR1', 45);
      c.swing(p, 'armL1', -30);
      c.swing(p, 'legL1', -14 + 4 * b);
      c.swing(p, 'legR1', -8 - 4 * b);
      c.swing(p, 'legL2', -12);
      c.rot(p, 'head', -20);
    }
  },
};

function legsTuck(c: ClipCtx, p: Pose, tuck: number): void {
  c.swing(p, 'legL1', 24 * tuck);
  c.swing(p, 'legR1', 16 * tuck);
  c.swing(p, 'legL2', -46 * tuck);
  c.swing(p, 'legR2', -40 * tuck);
}

function armsUp(c: ClipCtx, p: Pose, up: number): void {
  c.raise(p, 'armL1', up);
  c.raise(p, 'armR1', up);
  c.raise(p, 'armL2', up * 0.3);
  c.raise(p, 'armR2', up * 0.3);
}

const jump: Clip = {
  name: 'jump', loop: false, dur: 1.16,
  fn(c, t, p) {
    jumpArc(c, t, p, (q, tuck) => legsTuck(c, q, tuck), (q, up) => armsUp(c, q, up), 0);
  },
};

const attack: Clip = {
  name: 'attack', loop: false, dur: 0.45, upper: true,
  fn(c, t, p) {
    const wind = t < 0.15 ? ease(t / 0.15) : 1 - ease(clamp01((t - 0.15) / 0.12));
    const strike = t < 0.15 ? 0 : ease(clamp01((t - 0.15) / 0.1)) * (1 - ease(clamp01((t - 0.3) / 0.15)));
    c.raise(p, 'armR1', 70 * wind - 20 * strike);
    c.swing(p, 'armR1', 60 * strike);
    c.swing(p, 'armR2', 30 * strike);
    c.raise(p, 'armL1', 10 * wind);
    c.swing(p, 'spine', -6 * wind + 10 * strike);
    c.squash(p, 1 + 0.08 * strike, 1 - 0.05 * strike);
    p.ground = 1;
  },
};

const shoot: Clip = {
  name: 'shoot', loop: false, dur: 0.35, upper: true,
  fn(c, t, p) {
    // the arm comes up to point, then kicks back with the shot
    const aim = ease(clamp01(t / 0.08)) * (1 - ease(clamp01((t - 0.22) / 0.13)));
    const kick = t < 0.08 ? 0 : wobble(t - 0.08, 22, 12);
    c.swing(p, 'armR1', 70 * aim - 8 * kick);
    c.raise(p, 'armR1', 10 * aim);
    c.swing(p, 'armR2', 10 * aim);
    c.swing(p, 'spine', -4 * kick);
    c.rot(p, 'head', -2 * kick);
    p.ground = 1;
  },
};

const wave: Clip = {
  name: 'wave', loop: false, dur: 1.4, upper: true,
  fn(c, t, p) {
    const up = ease(clamp01(t / 0.2)) * (1 - ease(clamp01((t - 1.15) / 0.25)));
    c.raise(p, 'armR1', 120 * up);
    c.raise(p, 'armR2', (20 + 25 * Math.sin(TAU * 3 * t)) * up);
    c.rot(p, 'head', 4 * up * Math.sin(TAU * 1.5 * t));
    c.swing(p, 'spine', -2 * up);
    p.ground = 1;
  },
};

const win: Clip = {
  name: 'win', loop: true, dur: 0.9,
  fn(c, t, p) {
    const u = t / this.dur;
    const hop = Math.max(0, Math.sin(TAU * u));
    armsUp(c, p, 120 + 12 * Math.sin(TAU * 2 * u));
    c.raise(p, 'armL2', 15 * Math.sin(TAU * 2 * u));
    c.raise(p, 'armR2', -15 * Math.sin(TAU * 2 * u));
    c.lift(p, 0.12 * hop);
    c.squash(p, 1 + 0.06 * (1 - hop) * (1 - hop), 1 - 0.05 * (1 - hop) * (1 - hop) + 0.05 * hop);
    legsTuck(c, p, 0.4 * hop);
    c.rot(p, 'head', 5 * Math.sin(TAU * u));
    p.ground = 1 - hop;
  },
};

export const BIPED_CLIPS: Clip[] = [idle, walk, run, dash, jump, fly, attack, shoot, wave, win];
