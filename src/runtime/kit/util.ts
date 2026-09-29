/** Small maths helpers shared by the kit and exposed to games as `Amble.util`. Pure. */

export interface Point {
  x: number;
  y: number;
}

export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;

export const util = {
  rand: (a = 0, b = 1): number => a + Math.random() * (b - a),
  randInt: (a: number, b: number): number => Math.floor(a + Math.random() * (b - a + 1)),
  pick: <T>(arr: readonly T[]): T => arr[Math.floor(Math.random() * arr.length)],
  chance: (p: number): boolean => Math.random() < p,
  clamp: (v: number, a: number, b: number): number => (v < a ? a : v > b ? b : v),
  lerp: (a: number, b: number, t: number): number => a + (b - a) * t,
  dist: (a: Point, b: Point): number => Math.hypot(b.x - a.x, b.y - a.y),
  /** Degrees from a to b (0 = right, 90 = down). */
  angleTo: (a: Point, b: Point): number => Math.atan2(b.y - a.y, b.x - a.x) / DEG,
  approach: (v: number, target: number, step: number): number => (v < target ? Math.min(v + step, target) : Math.max(v - step, target)),
};

/** A deterministic random source (mulberry32): the same seed always gives the same numbers. */
export function seeded(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A stable 32-bit hash of a string (FNV-1a). */
export function hash(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function isPoint(v: unknown): v is Point {
  return typeof v === 'object' && v !== null && typeof (v as Point).x === 'number' && typeof (v as Point).y === 'number';
}
