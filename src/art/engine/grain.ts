/** Procedural, tileable paper grain for the pencil and crayon (anchored to the document, like real paper). */
import type { Grain } from './raster';
import { smoothstep } from './geom';

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const N = 256;

function octave(out: Float32Array, rand: () => number, periodX: number, periodY: number, amp: number): void {
  const gx = Math.max(1, Math.round(N / periodX));
  const gy = Math.max(1, Math.round(N / periodY));
  const lat = new Float32Array(gx * gy);
  for (let i = 0; i < lat.length; i++) lat[i] = rand();
  for (let y = 0; y < N; y++) {
    const fy = (y / N) * gy;
    const iy = Math.floor(fy);
    let ty = fy - iy;
    ty = ty * ty * (3 - 2 * ty);
    const r0 = (iy % gy) * gx;
    const r1 = ((iy + 1) % gy) * gx;
    for (let x = 0; x < N; x++) {
      const fx = (x / N) * gx;
      const ix = Math.floor(fx);
      let tx = fx - ix;
      tx = tx * tx * (3 - 2 * tx);
      const c0 = ix % gx;
      const c1 = (ix + 1) % gx;
      const top = lat[r0 + c0] + (lat[r0 + c1] - lat[r0 + c0]) * tx;
      const bot = lat[r1 + c0] + (lat[r1 + c1] - lat[r1 + c0]) * tx;
      out[y * N + x] += (top + (bot - top) * ty) * amp;
    }
  }
}

/** Rank-equalise so grain values are uniform: threshold t then covers exactly (1 - t) of the paper. */
function equalize(v: Float32Array): Uint8Array {
  const idx = new Uint32Array(v.length);
  for (let i = 0; i < idx.length; i++) idx[i] = i;
  idx.sort((a, b) => v[a] - v[b]);
  const out = new Uint8Array(v.length);
  for (let r = 0; r < idx.length; r++) out[idx[r]] = Math.min(255, Math.floor((r / idx.length) * 256));
  return out;
}

export type GrainKind = 'pencil' | 'crayon';

export function makeGrain(kind: GrainKind, seed: number): Grain {
  const rand = mulberry32(seed);
  const v = new Float32Array(N * N);
  if (kind === 'pencil') {
    octave(v, rand, 1.25, 1.25, 0.6); // paper tooth
    octave(v, rand, 2.5, 2.5, 0.3);
    octave(v, rand, 6, 3, 0.1);
  } else {
    octave(v, rand, 1.5, 1.5, 0.35);
    octave(v, rand, 3, 3, 0.3);
    octave(v, rand, 7, 4, 0.22); // waxy clumps
    octave(v, rand, 20, 20, 0.1);
  }
  const tex = equalize(v);
  const lut = new Float32Array(32 * 256);
  for (let L = 0; L < 32; L++) {
    const p = L / 31;
    // f: fraction of the paper that catches pigment at this pressure; dark: pigment strength.
    // floor: continuous tone under the grain (pencil lines never break into dashes).
    const f = kind === 'pencil' ? 0.3 + 0.62 * Math.pow(p, 0.9) : 0.42 + 0.5 * p;
    const dark = kind === 'pencil' ? 0.34 + 0.62 * p : 0.84 + 0.16 * p;
    const soft = kind === 'pencil' ? 0.2 : 0.1;
    const floor = kind === 'pencil' ? 0.28 : 0.06;
    for (let g = 0; g < 256; g++) lut[(L << 8) | g] = (floor + (1 - floor) * smoothstep(1 - f - soft, 1 - f + soft, g / 255)) * dark;
  }
  return { tex, lut };
}

/** The same seeds as the editor probe, so art previewed there replays identically. */
const SEEDS: Record<GrainKind, number> = { pencil: 11, crayon: 5 };
const cache = new Map<GrainKind, Grain>();

/** Shared, lazily built grain textures (about 330 KB each). */
export function grainFor(kind: GrainKind): Grain {
  let g = cache.get(kind);
  if (!g) {
    g = makeGrain(kind, SEEDS[kind]);
    cache.set(kind, g);
  }
  return g;
}
