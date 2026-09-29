import { describe, expect, it } from 'vitest';
import {
  addDynamic, artSizeOf, findJoint, hintsFromRig, jointList, magicBones, mirrorSides, moveBone, moveJoint, removeBone, rigForRedraw,
  setAnchor, setDynamic, setFacing, setKind, setRigid, setTweak, spineAxis,
} from '../../src/rig/editing';
import { parseRig } from '../../src/rig/format';
import type { RigData } from '../../src/rig/types';
import { rigged, sample } from './helpers';

function deepFreeze<T>(o: T): T {
  if (o && typeof o === 'object') {
    Object.freeze(o);
    for (const v of Object.values(o as Record<string, unknown>)) deepFreeze(v);
  }
  return o;
}

const hero = (): RigData => deepFreeze(structuredClone(rigged('hero').rig));

describe('joints', () => {
  it('lists the stars a student drags, with readable names', () => {
    const joints = jointList(hero());
    const labels = joints.map((j) => j.label);
    for (const l of ['Left shoulder', 'Left elbow', 'Left hand', 'Right knee', 'Right foot', 'Neck', 'Head top']) expect(labels).toContain(l);
    const elbow = joints.find((j) => j.label === 'Left elbow')!;
    expect(elbow.id).toBe('armL2');
    expect(elbow.side).toBe('L');
    expect(elbow.ends).toHaveLength(2);
    // ids are unique
    expect(new Set(joints.map((j) => j.id)).size).toBe(joints.length);
    expect(findJoint(hero(), 'armL1.tip')!.id).toBe('armL2');
  }, 60_000);
});

describe('editing never changes the rig it is given', () => {
  it('moveJoint stretches the bones that meet there and marks the rig hand-made', () => {
    const a = hero();
    const b = moveJoint(a, 'armL2', 50, 150);
    const upper = b.bones.find((x) => x.name === 'armL1')!, lower = b.bones.find((x) => x.name === 'armL2')!;
    expect([upper.x2, upper.y2]).toEqual([50, 150]);
    expect([lower.x, lower.y]).toEqual([50, 150]);
    expect(b.made).toBe('hand');
    expect(a.made).toBe('auto');
    expect(moveJoint(a, 'nope', 1, 1)).toBe(a);
  }, 60_000);

  it('moveBone moves both of its joints', () => {
    const a = hero();
    const before = a.bones.find((x) => x.name === 'armR1')!;
    const b = moveBone(a, 'armR1', 5, -3);
    const after = b.bones.find((x) => x.name === 'armR1')!;
    expect(after.x).toBeCloseTo(before.x + 5);
    expect(after.y2).toBeCloseTo(before.y2 - 3);
  }, 60_000);

  it('mirrorSides copies a lost arm onto the other side, mirrored about the spine', () => {
    const one = removeBone(hero(), 'armR1');
    expect(one.bones.some((b) => b.role === 'armR1' || b.role === 'armR2')).toBe(false);
    const both = mirrorSides(one);
    const l = both.bones.find((b) => b.role === 'armL2')!, r = both.bones.find((b) => b.role === 'armR2')!;
    const axis = spineAxis(one);
    expect(r.x2).toBeCloseTo(2 * axis - l.x2, 3);
    expect(r.y2).toBeCloseTo(l.y2, 3);
    expect(both.bones[r.parent].role).toBe('armR1');
    expect(() => parseRig(both)).not.toThrow();
  }, 60_000);

  it('mirrorSides in a side view only adds what is missing, in place', () => {
    const dog = deepFreeze(structuredClone(rigged('dog').rig));
    expect(mirrorSides(dog)).toBe(dog);
    const three = removeBone(dog, 'legBR1');
    const four = mirrorSides(three);
    const bl = four.bones.find((b) => b.role === 'legBL2')!, br = four.bones.find((b) => b.role === 'legBR2')!;
    expect(br.x2).toBeCloseTo(bl.x2);
  }, 60_000);

  it('addDynamic grows a springy chain from a joint', () => {
    const a = hero();
    const b = addDynamic(a, 'head.tip', [150, -10]);
    const added = b.bones.slice(a.bones.length);
    expect(added.length).toBeGreaterThanOrEqual(1);
    expect(added.every((x) => x.role === 'extra' && !!x.dynamic)).toBe(true);
    expect(b.bones[added[0].parent].name).toBe('head');
    for (let i = 1; i < added.length; i++) expect(b.bones[added[i].parent]).toBe(added[i - 1]);
    expect(() => parseRig(b)).not.toThrow();
  }, 60_000);

  it('removeBone takes what hangs off it, and keeps parents in order', () => {
    const a = hero();
    const b = removeBone(a, 'spine');
    expect(b.bones.map((x) => x.name).sort()).toEqual(['hips', 'legL1', 'legL2', 'legR1', 'legR2']);
    b.bones.forEach((x, i) => expect(x.parent).toBeLessThan(i));
    expect(() => parseRig(b)).not.toThrow();
    const blob: RigData = deepFreeze(structuredClone(rigged('slime').rig));
    expect(removeBone(blob, 'body')).toBe(blob);
  }, 60_000);

  it('setRigid, setDynamic, setFacing, setAnchor, setTweak', () => {
    const a = hero();
    const r = setRigid(a, 'armR2');
    expect(r.bones.find((b) => b.name === 'armR2')!.rigid).toBe(true);
    expect(setRigid(r, 'armR2')).toBe(r);
    const d = setDynamic(r, 'armR2', { stiffness: 0.3 });
    const bone = d.bones.find((b) => b.name === 'armR2')!;
    expect(bone.dynamic!.stiffness).toBe(0.3);
    expect(bone.rigid).toBeUndefined();
    expect(setFacing(a, 1).facing).toBe(1);
    expect(setAnchor(a, 1, 2).anchor).toEqual([1, 2]);
    const t = setTweak(a, 'walk', { amount: 1.5 });
    expect(t.anims).toEqual({ walk: { amount: 1.5 } });
    expect(setTweak(t, 'walk', null).anims).toBeUndefined();
    expect(setTweak(a, 'walk', { amount: 1, speed: 1 })).toBe(a);
  }, 60_000);
});

describe('re-fitting', () => {
  it('Magic bones keeps hand-placed joints when asked', () => {
    const s = sample('hero');
    const moved = moveJoint(hero(), 'armL2', rigged('hero').rig.bones[3].x2 - 6, rigged('hero').rig.bones[3].y2 + 4);
    const kept = magicBones(s, moved, { keep: true });
    const elbow = kept.rig.bones.find((b) => b.role === 'armL2')!;
    const want = moved.bones.find((b) => b.role === 'armL2')!;
    expect(Math.hypot(elbow.x - want.x, elbow.y - want.y)).toBeLessThan(10);
    expect(kept.rig.made).toBe('hand');
    const fresh = magicBones(s, moved);
    expect(fresh.rig.made).toBe('auto');
    expect(hintsFromRig(moved).joints.armL2).toEqual([want.x, want.y]);
  }, 60_000);

  it('"What is it?" re-fits as another kind', () => {
    const s = sample('slime');
    const r = setKind(s, rigged('slime').rig, 'object');
    expect(r.rig.kind).toBe('object');
  }, 60_000);

  it('a redraw in the same box keeps the bones; a new box re-fits', () => {
    const s = sample('hero');
    const rig = rigged('hero').rig;
    expect(artSizeOf(rig)).toEqual([s.image.width, s.image.height]);
    const same = rigForRedraw(s, rig);
    expect(same.kept).toBe(true);
    expect(same.rig.bones).toEqual(rig.bones);
    // a taller canvas: the drawing moved down by 20 px
    const W = s.image.width, H = s.image.height + 20;
    const data = new Uint8ClampedArray(W * H * 4);
    data.set(s.image.data, W * 20 * 4);
    const moved = rigForRedraw({ image: { data, width: W, height: H } }, moveJoint(rig, 'armL2', rig.bones[3].x2, rig.bones[3].y2));
    expect(moved.kept).toBe(false);
    const hips = moved.rig.bones.find((b) => b.role === 'hips')!;
    expect(hips.y).toBeGreaterThan(rig.bones.find((b) => b.role === 'hips')!.y + 12);
  }, 60_000);
});
