/** M4's starting point (FOUNDATION-STUB test; M4 replaces it): template bones, joints and edits from the rig core. */
import { describe, expect, it } from 'vitest';
import { CHARACTER_KINDS, clipsFor, jointList, mirrorSides, moveJoint, partSteps, RIG_CORE, templateFor } from '../../src/cores/rig';
import { isRigData } from '../../src/model/guards';

describe('bones (stub)', () => {
  it('uses the real rig core', () => {
    expect(RIG_CORE).toBe('real');
  });

  it('has a valid template rig, moves and drawing steps for every kind', () => {
    for (const kind of CHARACTER_KINDS) {
      const rig = templateFor(kind, 200, 300);
      expect(isRigData(rig), kind).toBe(true);
      expect(clipsFor(kind).length, kind).toBeGreaterThan(0);
      expect(partSteps(kind).length, kind).toBeGreaterThan(0);
    }
  });

  it('moves a joint by id and mirrors a side onto the other', () => {
    const rig = templateFor('biped', 200, 300);
    const elbow = jointList(rig).find((j) => j.id === 'armL2');
    expect(elbow).toBeDefined();
    const moved = moveJoint(rig, 'armL2', 30, 120);
    expect(moved.made).toBe('hand');
    expect(moved).not.toBe(rig);
    const mirrored = mirrorSides(moved, 'L');
    expect(mirrored.bones).toHaveLength(rig.bones.length);
  });
});
