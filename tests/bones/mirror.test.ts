/** Mirror sides (§7.11): one side's stars copied onto the other about the spine. */
import { describe, expect, it } from 'vitest';
import { mirrorAxis, mirrorBones } from '../../src/bones/edits';
import { findJoint, moveJoint, templateFor, type RigData } from '../../src/cores/rig';

const at = (rig: RigData, id: string): [number, number] => {
  const j = findJoint(rig, id);
  if (!j) throw new Error(`no joint ${id}`);
  return [j.x, j.y];
};

describe('mirror about the spine', () => {
  it('copies the left arm onto the right, reflected about the spine', () => {
    const base = templateFor('biped', 200, 300);
    const moved = moveJoint(base, 'armL2', 30, 160);
    const axis = mirrorAxis(moved);
    const out = mirrorBones(moved, 'L');
    const [lx, ly] = at(out, 'armL2');
    const [rx, ry] = at(out, 'armR2');
    expect(lx).toBeCloseTo(30);
    expect(rx).toBeCloseTo(2 * axis - lx, 5);
    expect(ry).toBeCloseTo(ly, 5);
    // every left joint has its reflection on the right
    for (const role of ['armL1', 'armL2', 'legL1', 'legL2']) {
      const l = out.bones.find((b) => b.role === role)!;
      const r = out.bones.find((b) => b.role === role.replace('L', 'R'))!;
      expect(r.x).toBeCloseTo(2 * axis - l.x, 5);
      expect(r.x2).toBeCloseTo(2 * axis - l.x2, 5);
      expect(r.y).toBeCloseTo(l.y, 5);
    }
    expect(out.made).toBe('hand');
  });

  it('copies from the side the student fixed last', () => {
    const base = templateFor('biped', 200, 300);
    const moved = moveJoint(base, 'armR2', 185, 150);
    const axis = mirrorAxis(moved);
    const out = mirrorBones(moved, 'R');
    const [rx, ry] = at(out, 'armR2');
    const [lx, ly] = at(out, 'armL2');
    expect(rx).toBeCloseTo(185);
    expect(lx).toBeCloseTo(2 * axis - 185, 5);
    expect(ly).toBeCloseTo(ry, 5);
  });

  it('adds a missing limb from the other side', () => {
    const base = templateFor('biped', 200, 300);
    const oneArm: RigData = { ...base, bones: base.bones.filter((b) => b.role !== 'armR1' && b.role !== 'armR2') };
    // parents are indexes: rebuild them for the filtered list
    oneArm.bones = oneArm.bones.map((b) => ({ ...b, parent: b.parent < 0 ? -1 : oneArm.bones.indexOf(base.bones[b.parent]) }));
    const out = mirrorBones(oneArm, null);
    expect(out.bones.some((b) => b.role === 'armR1')).toBe(true);
    expect(out.bones.some((b) => b.role === 'armR2')).toBe(true);
    expect(out.bones.length).toBe(base.bones.length);
  });

  it('leaves a rig with no sides alone', () => {
    const blob = templateFor('blob', 200, 200);
    expect(mirrorBones(blob, 'L')).toBe(blob);
  });
});
