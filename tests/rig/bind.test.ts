import { describe, expect, it } from 'vitest';
import { analyze } from '../../src/rig/analyze';
import { bakeBound, isBake, unbakeBound } from '../../src/rig/bake';
import { bindRig, BIND_WORK_SIZE, defaultParts } from '../../src/rig/bind';
import { computeOwnership } from '../../src/rig/bind/ownership';
import { parseRig, serializeRig } from '../../src/rig/format';
import { Pose } from '../../src/rig/runtime/pose';
import { Skeleton, skinVertices } from '../../src/rig/runtime/skeleton';
import type { BoundRig, Pixels } from '../../src/rig/types';
import { bound, rigged, sample } from './helpers';

const NAMES = ['hero', 'stick', 'wand', 'layered', 'dog', 'slime', 'bird', 'fish', 'car'];

function checkMesh(b: BoundRig): void {
  const nv = b.rest.length / 2;
  const nb = b.rig.bones.length;
  expect(b.uvs.length).toBe(b.rest.length);
  expect(b.boneIdx.length).toBe(nv * 4);
  for (let v = 0; v < nv; v++) {
    let sum = 0;
    for (let k = 0; k < 4; k++) {
      const wgt = b.boneW[v * 4 + k];
      expect(wgt).toBeGreaterThanOrEqual(0);
      if (wgt > 0) expect(b.boneIdx[v * 4 + k]).toBeLessThan(nb);
      sum += wgt;
    }
    expect(Math.abs(sum - 1)).toBeLessThan(1e-4);
    expect(b.uvs[2 * v]).toBeGreaterThanOrEqual(0);
    expect(b.uvs[2 * v]).toBeLessThanOrEqual(1);
  }
  for (const i of b.indices) expect(i).toBeLessThan(nv);
  // triangles run back to front by part
  let order = -Infinity;
  for (const pr of b.partRanges) {
    expect(pr.order).toBeGreaterThanOrEqual(order);
    order = pr.order;
  }
}

describe('binding', () => {
  for (const name of NAMES) {
    it(`${name}: weights sum to 1, at most 4 bones each, parts back to front`, () => {
      checkMesh(bound(name));
    }, 60_000);
  }

  it('the rest pose reproduces the drawing exactly', () => {
    for (const name of ['hero', 'dog', 'car']) {
      const b = bound(name);
      const sk = new Skeleton(b.rig);
      sk.solve(new Pose(sk.n), 0, 0, 0, false);
      const out = new Float32Array(b.rest.length);
      skinVertices(sk, b, out);
      const [ax, ay] = b.rig.anchor;
      let worst = 0;
      for (let i = 0; i < out.length; i += 2) worst = Math.max(worst, Math.abs(out[i] + ax - b.rest[i]), Math.abs(out[i + 1] + ay - b.rest[i + 1]));
      expect(worst).toBeLessThan(1e-3);
    }
  }, 60_000);

  it('every solid pixel is owned by a bone', () => {
    for (const name of ['hero', 'bird', 'car']) {
      const s = sample(name);
      const rig = rigged(name).rig;
      const A = analyze(s, { workSize: BIND_WORK_SIZE });
      const parts = defaultParts(rig);
      const index = new Map(rig.bones.map((bn, i) => [bn.name, i] as [string, number]));
      const boneToPart = new Int16Array(rig.bones.length);
      parts.forEach((p, k) => p.bones.forEach((n) => (boneToPart[index.get(n)!] = k)));
      const own = computeOwnership(A, rig, parts, boneToPart, true);
      let unowned = 0;
      for (let i = 0; i < A.w * A.h; i++) if (A.solid[i] && own.owner[i] < 0) unowned++;
      expect(unowned).toBe(0);
    }
  }, 60_000);

  it('every painted pixel of the drawing ends up in the atlas', () => {
    const b = bound('hero');
    const s = sample('hero');
    let painted = 0;
    for (let i = 3; i < s.image.data.length; i += 4) if (s.image.data[i] > 8) painted++;
    let atlas = 0;
    for (let i = 3; i < b.atlas.data.length; i += 4) if (b.atlas.data[i] > 8) atlas++;
    // hidden areas add pixels; nothing is lost
    expect(atlas).toBeGreaterThanOrEqual(painted * 0.99);
  }, 60_000);

  it('a rig read back from JSON binds to the same mesh', () => {
    const s = sample('dog');
    const r = rigged('dog');
    const a = bindRig(s, r.rig);
    const b = bindRig(s, parseRig(serializeRig(r.rig)));
    expect(Array.from(b.indices)).toEqual(Array.from(a.indices));
    expect(Array.from(b.boneIdx)).toEqual(Array.from(a.boneIdx));
    for (let i = 0; i < a.rest.length; i++) expect(b.rest[i]).toBeCloseTo(a.rest[i], 3);
  }, 60_000);

  it('drawn on layers: parts are the layers, nothing is guessed', () => {
    const b = bound('layered');
    expect(b.flat).toBe(false);
    expect(b.partRanges.map((p) => p.name).sort()).toEqual(['armL', 'armR', 'head', 'legL', 'legR', 'torso']);
    expect(bound('hero').flat).toBe(true);
  }, 60_000);

  it('wheels move as one piece', () => {
    const b = bound('car');
    const wheel = b.rig.bones.findIndex((x) => x.name === 'wheel1');
    const pr = b.partRanges.find((p) => p.name === 'wheel1')!;
    const verts = new Set<number>();
    for (let t = pr.first * 3; t < (pr.first + pr.count) * 3; t++) verts.add(b.indices[t]);
    for (const v of verts) {
      expect(b.boneIdx[v * 4]).toBe(wheel);
      expect(b.boneW[v * 4]).toBe(1);
    }
  }, 60_000);

  it('big drawings are cut smaller but keep their size', () => {
    const s = sample('hero');
    const r = rigged('hero');
    const b = bindRig(s, r.rig, { maxSide: 200 });
    expect(b.width).toBe(s.image.width);
    expect(b.height).toBe(s.image.height);
    expect(Math.max(b.atlas.width, b.atlas.height)).toBeLessThan(Math.max(bound('hero').atlas.width, bound('hero').atlas.height));
    let maxY = 0;
    for (let i = 1; i < b.rest.length; i += 2) maxY = Math.max(maxY, b.rest[i]);
    expect(maxY).toBeGreaterThan(s.image.height * 0.9);
    checkMesh(b);
  }, 60_000);

  it('bakes round-trip without copying', () => {
    const b = bound('bird');
    const buf = bakeBound(b);
    expect(isBake(buf)).toBe(true);
    const u = unbakeBound(buf);
    expect(u.rig).toEqual(b.rig);
    expect(Array.from(u.rest)).toEqual(Array.from(b.rest));
    expect(Array.from(u.indices)).toEqual(Array.from(b.indices));
    expect(Array.from(u.boneW)).toEqual(Array.from(b.boneW));
    expect(u.atlas.width).toBe(b.atlas.width);
    expect((u.atlas as Pixels).data.buffer).toBe(buf);
    expect(isBake(new ArrayBuffer(16))).toBe(false);
  }, 60_000);
});
