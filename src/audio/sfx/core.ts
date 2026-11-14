/**
 * How the effect library is written: a family ("Jump") has a few variants ("Springy", "Cartoon"),
 * each a small function that builds a recipe for the sound engine, with a few details left to
 * chance (`c.r`), so each take is its own. Nothing is stored as audio.
 */

import type { Layer, Recipe, Wave } from '../engine';

export type Category =
  | 'movement'
  | 'pickups'
  | 'combat'
  | 'interface'
  | 'nature'
  | 'creatures'
  | 'vehicles'
  | 'machines'
  | 'magic'
  | 'bells'
  | 'drums'
  | 'instruments'
  | 'cartoon'
  | 'games'
  | 'ambience';

/**
 * What a variant's builder is given. A builder writes the sound at its medium size; the library
 * makes the other sizes by playing the whole recipe higher and shorter, or lower and longer.
 */
export interface Ctx {
  /** Size -2 (tiny) .. 2 (huge), and take 0.. (rarely needed: sizes are applied for you). */
  z: number;
  k: number;
  /** A random number between lo and hi (always the same for the same sound). */
  r(lo: number, hi: number): number;
}

export type Build = (c: Ctx) => Layer[] | Recipe;

/** [search words, what it sounds like, builder]. */
export type Variant = readonly [tags: string, about: string, build: Build];

export interface Family {
  id: string;
  name: string;
  cat: Category;
  /** Everyday words people search with. */
  tags: string;
  /** What it is for, e.g. "a character jumping". */
  about: string;
  /** Variants by name. "%" in a name stands for the family's name; a leading "=" uses the name alone. */
  v: Record<string, Variant>;
  /** How many sizes (5, 3 or 1) and takes (default 2). */
  sizes?: 1 | 3 | 5;
  takes?: number;
}

type Opt = Partial<Layer>;

/** A struck or plucked sound: starts at once and dies away over `d` seconds. */
export const hit = (w: Wave, f: number, f2: number, d: number, o: Opt = {}): Layer => ({ w, f, f2, d, env: [0.001, d, 0, 0.03], ...o });
/** A held sound: quick attack, steady, short release. */
export const hold = (w: Wave, f: number, f2: number, d: number, o: Opt = {}): Layer => ({ w, f, f2, d, env: [0.006, 0.04, 0.85, 0.06], ...o });
/** A swell: fades in over most of `d`, then out. */
export const swell = (w: Wave, f: number, f2: number, d: number, o: Opt = {}): Layer => ({ w, f, f2, d, env: [d * 0.6, d * 0.2, 0.8, d * 0.35], ...o });
/** Filtered noise that dies away over `d` seconds; the filter moves from `fc` to `fc2`. */
export const nz = (w: 'noise' | 'pink' | 'brown', d: number, ft: 'lp' | 'hp' | 'bp', fc: number, fc2 = fc, o: Opt = {}): Layer => ({ w, d, ft, fc, fc2, env: [0.001, d, 0, 0.03], ...o });
/** A bell-like ping: FM sine with a ring of `ring` seconds. */
export const ping = (f: number, ring: number, o: Opt = {}): Layer => ({ w: 'sine', f, d: 0.01, fm: [3.5, 2, 0], env: [0.001, 0.01, 0.9, ring], ...o });
/** A thump: a driven sine dropping from `f` to half of it (the drive adds overtones small speakers can play). */
export const thump = (f: number, d: number, v = 1, o: Opt = {}): Layer => ({ w: 'sine', f: f * 1.25, f2: f * 0.55, g: d * 0.7, c: 0.5, d: 0.01, drv: 0.55, env: [0.001, 0.01, 0.9, d], v: v * 0.8, ...o });
/** A click: a few milliseconds of band-passed noise. */
export const click = (fc: number, v = 1, o: Opt = {}): Layer => ({ w: 'noise', d: 0.002, ft: 'bp', fc, q: 1.5, env: [0, 0.003, 0.4, 0.008], v, ...o });
/** The same layers later, quieter or at another pitch. */
export const shift = (layers: Layer[], dt: number, vMul = 1, fMul = 1): Layer[] =>
  layers.map((L) => ({ ...L, t: (L.t ?? 0) + dt, v: (L.v ?? 0.7) * vMul, ...(L.f ? { f: L.f * fMul } : {}), ...(L.f2 ? { f2: L.f2 * fMul } : {}) }));
/** A run of semitone steps from a scale: `count` notes up (or down) from `from`. */
export const run = (scale: readonly number[], count: number, from = 0, down = false): number[] =>
  Array.from({ length: count }, (_, i) => {
    const j = down ? from - i : from + i;
    return scale[((j % scale.length) + scale.length) % scale.length] + 12 * Math.floor(j / scale.length);
  });

export const MAJOR = [0, 2, 4, 5, 7, 9, 11] as const;
export const PENTA = [0, 2, 4, 7, 9] as const;
export const MINOR = [0, 2, 3, 5, 7, 8, 10] as const;
