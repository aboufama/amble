/** Content hashes for cache keys: art pixels, rig bones and the bind recipe. */
import type { Pixels, RigData } from './types';

/**
 * Bumped whenever binding (parts, hidden areas, mesh, weights) changes its output, so cached bakes
 * made by an older build are never reused.
 */
export const BIND_VERSION = 1;

/** Two independent 32-bit hashes (FNV-1a and a murmur-style mix) as 16 hex digits. */
function hex64(h1: number, h2: number): string {
  return (h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0');
}

export function hashString(s: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x9747b28c;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193);
    h2 = Math.imul(h2 ^ c, 0x5bd1e995);
    h2 ^= h2 >>> 15;
  }
  return hex64(h1, h2);
}

/**
 * Hash of every pixel (not a sample: a one-pixel edit must change it). About 1 ms per megapixel.
 * Fully transparent pixels hash the same whatever their colour, so editors that clear to
 * transparent black or transparent white agree.
 */
export function hashPixels(p: Pixels): string {
  const n = p.width * p.height;
  const d = p.data;
  let h1 = 0x811c9dc5 ^ p.width;
  let h2 = 0x9747b28c ^ p.height;
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    const a = d[o + 3];
    const v = a === 0 ? 0 : (d[o] | (d[o + 1] << 8) | (d[o + 2] << 16) | (a << 24));
    h1 = Math.imul(h1 ^ v, 0x01000193);
    let k = Math.imul(v, 0xcc9e2d51);
    k = (k << 15) | (k >>> 17);
    h2 ^= Math.imul(k, 0x1b873593);
    h2 = ((h2 << 13) | (h2 >>> 19)) * 5 + 0xe6546b64;
  }
  h2 ^= h2 >>> 16;
  h2 = Math.imul(h2, 0x85ebca6b);
  h2 ^= h2 >>> 13;
  return `${p.width}x${p.height}:${hex64(h1, h2)}`;
}

const r2 = (v: number) => Math.round(v * 100) / 100;

/**
 * Hash of what binding depends on: kind (default parts), bones (geometry, hierarchy, rigidity),
 * parts and skin settings. Facing, anchor, springs, clip tweaks and authorship don't change the mesh.
 */
export function hashRig(rig: RigData): string {
  const bones = rig.bones.map((b) => [b.name, b.role, b.parent, r2(b.x), r2(b.y), r2(b.x2), r2(b.y2), b.rigid ? 1 : 0]);
  const parts = rig.parts?.map((p) => [p.name, p.bones, r2(p.order), p.layer ?? '']) ?? null;
  return hashString(JSON.stringify([rig.kind, bones, parts, rig.skin?.cell ?? null, rig.skin?.blend ?? null]));
}

/** Cache key of a bind (and of its bake): same art + same bones + same binder = same result. */
export function bindKey(rig: RigData, layersKey = ''): string {
  return `${rig.artHash}|${hashRig(rig)}|${layersKey}|b${BIND_VERSION}`;
}
