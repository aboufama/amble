/**
 * Procedural clips for stand-in characters: functions of time that return a pose (bone rotations in
 * radians, plus `bob` (fraction of the height, + is down), `sx`/`sy` squash and `rot` for the whole body).
 * Written for "facing right". Pure.
 */
import type { RigKind } from '../../../play/protocol';
import { TAU } from '../util';

export type Pose = Record<string, number>;

export interface ClipDef {
  /** Loops until another clip; otherwise a one-shot of `dur` seconds layered over the current movement. */
  loop: boolean;
  dur?: number;
  /** One-shots that move only the upper body (arms, spine, head) while the legs keep walking. */
  upper?: boolean;
  /** Holds its last pose (die). */
  hold?: boolean;
  fn: (t: number) => Pose;
}

const easeOut = (u: number) => 1 - (1 - u) * (1 - u);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const pos = (v: number) => Math.max(0, v);

const BIPED: Record<string, ClipDef> = {
  idle: {
    loop: true,
    fn: (t) => {
      const s = Math.sin(t * 2.4);
      return { bob: s * 0.012, spine: 0.03 + s * 0.015, head: Math.sin(t * 1.1) * 0.05, armF1: 0.14 + s * 0.05, armF2: -0.14, armB1: -0.12 - s * 0.05, armB2: -0.12, legF1: -0.06, legB1: 0.06, legF2: 0.06, legB2: 0.06 };
    },
  },
  walk: {
    loop: true,
    fn: (t) => {
      const p = t * TAU * 1.7;
      const s = Math.sin(p);
      const c = Math.cos(p);
      return {
        bob: -Math.abs(c) * 0.04 + 0.02, spine: 0.08, head: -0.04,
        legF1: -0.55 * s, legB1: 0.55 * s, legF2: 0.25 + 0.5 * pos(c), legB2: 0.25 + 0.5 * pos(-c),
        armF1: 0.6 * s, armB1: -0.6 * s, armF2: -0.3 - 0.35 * pos(-s), armB2: -0.3 - 0.35 * pos(s),
      };
    },
  },
  run: {
    loop: true,
    fn: (t) => {
      const p = t * TAU * 2.6;
      const s = Math.sin(p);
      const c = Math.cos(p);
      return {
        bob: -Math.abs(c) * 0.07 + 0.03, spine: 0.26, head: -0.14,
        legF1: -1.0 * s - 0.15, legB1: 1.0 * s - 0.15, legF2: 0.35 + 1.25 * pos(c), legB2: 0.35 + 1.25 * pos(-c),
        armF1: 1.15 * s - 0.2, armB1: -1.15 * s - 0.2, armF2: -1.3, armB2: -1.3,
      };
    },
  },
  jump: { loop: true, fn: () => ({ spine: 0.06, head: -0.18, legF1: -1.25, legF2: 1.7, legB1: 0.4, legB2: 1.3, armF1: -2.5, armF2: -0.2, armB1: -2.1, armB2: -0.2 }) },
  fall: {
    loop: true,
    fn: (t) => ({ spine: -0.05, head: 0.12, legF1: -0.45, legF2: 0.6, legB1: 0.55, legB2: 0.9, armF1: -2.5 + 0.4 * Math.sin(t * 22), armF2: -0.3, armB1: -2.1 - 0.4 * Math.sin(t * 22), armB2: -0.3 }),
  },
  land: { loop: false, dur: 0.22, fn: () => ({ sx: 1.18, sy: 0.82, bob: 0.03, legF1: -0.5, legF2: 1.0, legB1: 0.3, legB2: 0.9, armF1: 0.4, armB1: 0.3 }) },
  dash: { loop: true, fn: () => ({ bob: 0.03, spine: 0.55, head: -0.25, legF1: -0.9, legF2: 1.1, legB1: 1.0, legB2: 1.3, armF1: 1.3, armF2: -0.4, armB1: 1.5, armB2: -0.4 }) },
  attack: {
    loop: false,
    dur: 0.3,
    upper: true,
    fn: (t) => {
      const u = easeOut(Math.min(1, t / 0.3));
      return { armF1: lerp(-2.9, 0.4, u), armF2: lerp(-0.6, 0, u), armB1: lerp(-1.2, 0.8, u), spine: lerp(-0.15, 0.35, u) };
    },
  },
  shoot: { loop: false, dur: 0.16, upper: true, fn: () => ({ armF1: -1.57, armF2: 0, armB1: -1.25, armB2: -0.2, spine: 0.05 }) },
  hurt: { loop: false, dur: 0.35, fn: () => ({ spine: -0.4, head: -0.35, armF1: -1.4, armB1: -1.9, legF1: -0.35, legB1: 0.3, legF2: 0.4, legB2: 0.4 }) },
  die: { loop: false, dur: 0.6, hold: true, fn: (t) => ({ rot: -1.45 * easeOut(Math.min(1, t / 0.45)), bob: 0.02, head: -0.4, armF1: -2.8, armB1: -2.4, legF1: -0.3, legB1: 0.2, legF2: 0.4, legB2: 0.2 }) },
  cheer: {
    loop: true,
    fn: (t) => ({
      bob: -Math.abs(Math.sin(t * 7)) * 0.11, head: -0.2, armF1: -2.8 + 0.35 * Math.sin(t * 12), armF2: -0.3, armB1: -2.8 - 0.35 * Math.sin(t * 12), armB2: -0.3,
      legF1: -0.2, legB1: 0.2, legF2: 0.3, legB2: 0.3,
    }),
  },
  rage: { loop: true, fn: (t) => ({ spine: 0.1 + 0.05 * Math.sin(t * 20), armF1: -2.6 + 0.4 * Math.sin(t * 17), armB1: -2.6 - 0.4 * Math.sin(t * 17), armF2: -0.6, armB2: -0.6, bob: Math.sin(t * 9) * 0.01 }) },
  fly: { loop: true, fn: (t) => ({ rot: 1.2, bob: -0.2 + Math.sin(t * 3) * 0.02, armF1: -2.9, armB1: -2.7, legF1: 0.2, legB1: 0.3, legF2: 0.2, legB2: 0.3 }) },
  wiggle: { loop: true, fn: (t) => ({ spine: 0.2 * Math.sin(t * 12), head: -0.2 * Math.sin(t * 12), armF1: -1.0 + 0.5 * Math.sin(t * 12), armB1: 1.0 - 0.5 * Math.sin(t * 12) }) },
  spin: { loop: true, fn: (t) => ({ rot: t * TAU * 1.5, armF1: -1.6, armB1: 1.6 }) },
};

const BLOB: Record<string, ClipDef> = {
  idle: {
    loop: true,
    fn: (t) => {
      const s = Math.sin(t * 2.2);
      return { bob: s * 0.015, sx: 1 + s * 0.035, sy: 1 - s * 0.035, armL: 0.3 + s * 0.14, armR: -0.3 - s * 0.14 };
    },
  },
  walk: {
    loop: true,
    fn: (t) => {
      const s = Math.abs(Math.sin(t * 7));
      return { bob: -s * 0.16, sx: 1 + (1 - s) * 0.08, sy: 1 - (1 - s) * 0.08, body: 0.08, armL: 0.5 + s * 0.4, armR: -0.5 - s * 0.4 };
    },
  },
  run: {
    loop: true,
    fn: (t) => {
      const s = Math.abs(Math.sin(t * 10));
      return { bob: -s * 0.22, sx: 1 + (1 - s) * 0.1, sy: 1 - (1 - s) * 0.1, body: 0.14, armL: 0.9 + s * 0.5, armR: -0.9 - s * 0.5 };
    },
  },
  jump: { loop: true, fn: () => ({ sx: 0.88, sy: 1.14, armL: 2.2, armR: -2.2 }) },
  fall: { loop: true, fn: (t) => ({ sx: 1.06, sy: 0.95, armL: 1.6 + 0.3 * Math.sin(t * 20), armR: -1.6 - 0.3 * Math.sin(t * 20) }) },
  land: { loop: false, dur: 0.22, fn: () => ({ sx: 1.25, sy: 0.78, armL: 0.9, armR: -0.9 }) },
  attack: {
    loop: false,
    dur: 0.5,
    fn: (t) => {
      const k = Math.sin(Math.min(1, t / 0.5) * Math.PI);
      return { sx: 1 - 0.1 * k, sy: 1 + 0.14 * k, armL: 0.3 + 2.2 * k, armR: -0.3 - 2.2 * k, bob: -0.12 * k };
    },
  },
  hurt: { loop: false, dur: 0.22, fn: () => ({ sx: 1.18, sy: 0.84, armL: 1.1, armR: -1.1 }) },
  rage: {
    loop: true,
    fn: (t) => ({ shake: 0.03, sx: 1.05 + 0.03 * Math.sin(t * 24), sy: 0.97 - 0.03 * Math.sin(t * 24), armL: 2.3 + 0.5 * Math.sin(t * 17), armR: -2.3 - 0.5 * Math.sin(t * 17), bob: Math.sin(t * 5) * 0.035 }),
  },
  cheer: { loop: true, fn: (t) => ({ bob: -Math.abs(Math.sin(t * 6)) * 0.2, armL: 2.4, armR: -2.4 }) },
  die: { loop: false, dur: 0.5, hold: true, fn: (t) => ({ sx: lerp(1, 1.3, Math.min(1, t / 0.3)), sy: lerp(1, 0.6, Math.min(1, t / 0.3)), armL: 1.5, armR: -1.5 }) },
  wiggle: { loop: true, fn: (t) => ({ body: 0.15 * Math.sin(t * 14), armL: 0.6 + 0.4 * Math.sin(t * 14), armR: -0.6 + 0.4 * Math.sin(t * 14) }) },
  spin: { loop: true, fn: (t) => ({ rot: t * TAU * 1.5 }) },
};

const QUADRUPED: Record<string, ClipDef> = {
  idle: { loop: true, fn: (t) => ({ bob: Math.sin(t * 2) * 0.01, tail: 0.25 * Math.sin(t * 3), head: 0.05 * Math.sin(t * 1.3) }) },
  walk: {
    loop: true,
    fn: (t) => {
      const p = t * TAU * 1.6;
      const s = Math.sin(p);
      return { legFL: 0.45 * s, legBR: 0.45 * s, legFR: -0.45 * s, legBL: -0.45 * s, bob: -Math.abs(Math.cos(p)) * 0.03, tail: 0.3 * Math.sin(p * 2), head: 0.06 * s };
    },
  },
  run: {
    loop: true,
    fn: (t) => {
      const p = t * TAU * 2.4;
      return {
        legFL: 0.9 * Math.sin(p), legFR: 0.9 * Math.sin(p + 0.5), legBL: -0.9 * Math.sin(p + 2.6), legBR: -0.9 * Math.sin(p + 3.1),
        rot: 0.08 * Math.sin(p), bob: -Math.abs(Math.sin(p)) * 0.07, tail: -0.5, head: -0.1,
      };
    },
  },
  jump: { loop: true, fn: () => ({ rot: -0.2, legFL: -0.8, legFR: -0.8, legBL: 0.8, legBR: 0.8, tail: -0.3 }) },
  fall: { loop: true, fn: () => ({ rot: 0.15, legFL: 0.5, legFR: 0.5, legBL: -0.4, legBR: -0.4, tail: 0.4 }) },
  land: { loop: false, dur: 0.22, fn: () => ({ sx: 1.1, sy: 0.85 }) },
  attack: { loop: false, dur: 0.4, fn: (t) => ({ neck: 0.5 * Math.sin(Math.min(1, t / 0.4) * Math.PI), head: -0.3, legFL: -0.4, legFR: -0.4 }) },
  hurt: { loop: false, dur: 0.3, fn: () => ({ rot: -0.3, tail: 0.8, sx: 1.1, sy: 0.9 }) },
  die: { loop: false, dur: 0.6, hold: true, fn: (t) => ({ rot: -1.4 * easeOut(Math.min(1, t / 0.45)), tail: 0.5 }) },
  cheer: { loop: true, fn: (t) => ({ bob: -Math.abs(Math.sin(t * 6)) * 0.15, tail: 0.8 * Math.sin(t * 12), legFL: -0.5, legFR: -0.3 }) },
  wiggle: { loop: true, fn: (t) => ({ tail: 0.9 * Math.sin(t * 14), rot: 0.05 * Math.sin(t * 14) }) },
  spin: { loop: true, fn: (t) => ({ rot: t * TAU * 1.5 }) },
};

const FLYER: Record<string, ClipDef> = {
  idle: {
    loop: true,
    fn: (t) => {
      const f = Math.sin(t * TAU * 2.5);
      return { wingF: 0.55 * f, wingB: 0.55 * Math.sin(t * TAU * 2.5 + 0.3), bob: f * 0.035, tail: 0.1 * Math.sin(t * 3) };
    },
  },
  fly: {
    loop: true,
    fn: (t) => {
      const f = Math.sin(t * TAU * 4);
      return { wingF: 0.75 * f, wingB: 0.75 * Math.sin(t * TAU * 4 + 0.3), bob: f * 0.05, tail: 0.15 * Math.sin(t * 5), rot: 0.1 };
    },
  },
  glide: { loop: true, fn: (t) => ({ wingF: 0.35, wingB: 0.3, bob: Math.sin(t * 2) * 0.02, rot: 0.15 }) },
  attack: { loop: false, dur: 0.4, fn: (t) => ({ rot: 0.5 * Math.sin(Math.min(1, t / 0.4) * Math.PI), wingF: -0.9, wingB: -0.9 }) },
  hurt: { loop: false, dur: 0.3, fn: () => ({ rot: -0.4, wingF: 1.0, wingB: 1.0 }) },
  die: { loop: false, dur: 0.6, hold: true, fn: (t) => ({ rot: 2.6 * easeOut(Math.min(1, t / 0.5)), wingF: 1.2, wingB: 1.2 }) },
  cheer: { loop: true, fn: (t) => ({ wingF: 0.9 * Math.sin(t * TAU * 5), wingB: 0.9 * Math.sin(t * TAU * 5 + 0.3), bob: -Math.abs(Math.sin(t * 5)) * 0.2 }) },
  land: { loop: false, dur: 0.2, fn: () => ({ sx: 1.1, sy: 0.88, wingF: 0.6, wingB: 0.6 }) },
  wiggle: { loop: true, fn: (t) => ({ rot: 0.2 * Math.sin(t * 14), wingF: 0.5 * Math.sin(t * 14), wingB: -0.5 * Math.sin(t * 14) }) },
  spin: { loop: true, fn: (t) => ({ rot: t * TAU * 1.5 }) },
};

function wave(amp: number, speed: number, extra: Pose = {}): (t: number) => Pose {
  return (t) => {
    const pose: Pose = { ...extra };
    for (let i = 1; i <= 4; i++) pose[`spine${i}`] = amp * (i / 4 + 0.35) * Math.sin(t * speed - i * 0.9);
    pose.fin = amp * 1.3 * Math.sin(t * speed - 5 * 0.9);
    return pose;
  };
}

const SWIMMER: Record<string, ClipDef> = {
  idle: { loop: true, fn: wave(0.12, 3, {}) },
  swim: { loop: true, fn: wave(0.32, 8, {}) },
  run: { loop: true, fn: wave(0.38, 12, {}) },
  jump: { loop: true, fn: wave(0.2, 10, { rot: -0.3 }) },
  fall: { loop: true, fn: wave(0.2, 6, { rot: 0.3 }) },
  attack: { loop: false, dur: 0.4, fn: (t) => ({ ...wave(0.45, 16)(t), rot: -0.15 }) },
  hurt: { loop: false, dur: 0.3, fn: () => ({ spine1: 0.35, spine2: 0.35, spine3: 0.35, spine4: 0.35, fin: 0.4 }) },
  die: { loop: false, dur: 0.6, hold: true, fn: (t) => ({ rot: Math.PI * easeOut(Math.min(1, t / 0.5)), spine1: 0.2, spine2: 0.2, spine3: 0.2 }) },
  cheer: { loop: true, fn: wave(0.5, 14, {}) },
  land: { loop: false, dur: 0.2, fn: () => ({ sx: 1.1, sy: 0.9 }) },
  wiggle: { loop: true, fn: wave(0.5, 16, {}) },
  spin: { loop: true, fn: (t) => ({ rot: t * TAU * 1.5 }) },
};

const OBJECT: Record<string, ClipDef> = {
  idle: { loop: true, fn: (t) => ({ sy: 1 + 0.02 * Math.sin(t * 2.5), sx: 1 - 0.02 * Math.sin(t * 2.5) }) },
  walk: { loop: true, fn: (t) => ({ bob: -Math.abs(Math.sin(t * 8)) * 0.05, body: 0.05 * Math.sin(t * 8) }) },
  run: { loop: true, fn: (t) => ({ bob: -Math.abs(Math.sin(t * 12)) * 0.08, body: 0.08 * Math.sin(t * 12) }) },
  jump: { loop: true, fn: () => ({ sx: 0.9, sy: 1.1 }) },
  fall: { loop: true, fn: () => ({ sx: 1.05, sy: 0.95 }) },
  land: { loop: false, dur: 0.2, fn: () => ({ sx: 1.2, sy: 0.82 }) },
  attack: { loop: false, dur: 0.35, fn: (t) => ({ body: 0.3 * Math.sin(Math.min(1, t / 0.35) * Math.PI), sy: 1.08 }) },
  hurt: { loop: false, dur: 0.25, fn: () => ({ sx: 1.15, sy: 0.85, body: -0.15 }) },
  die: { loop: false, dur: 0.5, hold: true, fn: (t) => ({ rot: 1.4 * easeOut(Math.min(1, t / 0.4)) }) },
  cheer: { loop: true, fn: (t) => ({ bob: -Math.abs(Math.sin(t * 6)) * 0.18 }) },
  wiggle: { loop: true, fn: (t) => ({ body: 0.14 * Math.sin(t * 14) }) },
  spin: { loop: true, fn: (t) => ({ rot: t * TAU * 1.5 }) },
};

const SETS: Record<RigKind, Record<string, ClipDef>> = {
  biped: BIPED,
  blob: BLOB,
  quadruped: QUADRUPED,
  flyer: FLYER,
  swimmer: SWIMMER,
  object: OBJECT,
  none: OBJECT,
};

/** Nearest clip a kind has, for names it does not (a flyer asked to "walk" flies). */
const FALLBACKS: Record<string, string[]> = {
  rise: ['jump', 'fly'],
  jump: ['fly', 'idle'],
  fall: ['glide', 'jump', 'idle'],
  land: ['idle'],
  walk: ['swim', 'fly', 'run', 'idle'],
  run: ['swim', 'fly', 'walk', 'idle'],
  dash: ['run', 'fly', 'swim', 'walk'],
  shoot: ['attack'],
  rage: ['attack', 'wiggle'],
  cheer: ['jump', 'wiggle'],
  fly: ['jump', 'swim', 'walk'],
  glide: ['fly', 'fall', 'swim'],
  swim: ['fly', 'walk'],
  die: ['hurt'],
  attack: ['wiggle', 'jump'],
};

export function clipFor(kind: RigKind, name: string): { name: string; def: ClipDef } {
  const set = SETS[kind];
  if (set[name]) return { name, def: set[name] };
  for (const alt of FALLBACKS[name] ?? []) if (set[alt]) return { name: alt, def: set[alt] };
  return { name: 'idle', def: set.idle };
}

/** Whether a kind has its own clip for a name (no fallback). */
export function hasClip(kind: RigKind, name: string): boolean {
  return name in SETS[kind];
}
