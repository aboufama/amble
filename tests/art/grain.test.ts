import { describe, expect, it } from 'vitest';
import { equalize, grainFor, makeGrain, mulberry32 } from '../../src/art/engine/grain';
import { sameBytes } from './helpers';

/** The editor probe's equalization (a comparator sort): the reference the fast one must match exactly. */
function probeEqualize(v: Float32Array): Uint8Array {
  const idx = new Uint32Array(v.length);
  for (let i = 0; i < idx.length; i++) idx[i] = i;
  idx.sort((a, b) => v[a] - v[b]);
  const out = new Uint8Array(v.length);
  for (let r = 0; r < idx.length; r++) out[idx[r]] = Math.min(255, Math.floor((r / idx.length) * 256));
  return out;
}

describe('paper grain', () => {
  it('ranks exactly like the probe, ties included', () => {
    const rand = mulberry32(3);
    const smooth = new Float32Array(65536).map(() => rand() * 1.7);
    const ties = new Float32Array(65536).map(() => Math.floor(rand() * 90) / 7);
    for (const v of [smooth, ties]) expect(sameBytes(equalize(v.slice()), probeEqualize(v))).toBe(true);
  });

  it('is uniform: a threshold covers the matching share of the paper', () => {
    const { tex } = makeGrain('pencil', 11);
    const over = tex.reduce((n, g) => n + (g >= 192 ? 1 : 0), 0);
    expect(over / tex.length).toBeCloseTo(0.25, 2);
  });

  it('caches one texture per brush', () => {
    expect(grainFor('crayon')).toBe(grainFor('crayon'));
    expect(grainFor('pencil').tex).not.toEqual(grainFor('crayon').tex);
  });
});
