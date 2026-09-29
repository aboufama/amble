/** M4's starting point (FOUNDATION-STUB test; M4 replaces it): the template bones every kind starts from. */
import { describe, expect, it } from 'vitest';
import { CHARACTER_KINDS, clipsFor, mirrorSides, templateFor } from '../../src/cores/rig';
import { isRigData } from '../../src/model/guards';

describe('bones (stub)', () => {
  it('has a valid template rig and moves for every kind', () => {
    for (const kind of CHARACTER_KINDS) {
      const rig = templateFor(kind, 200, 300);
      expect(isRigData(rig), kind).toBe(true);
      expect(clipsFor(kind).length, kind).toBeGreaterThan(0);
    }
  });

  it('mirrors a side onto the other', () => {
    const rig = templateFor('biped', 200, 300);
    const mirrored = mirrorSides(rig, 'left');
    expect(mirrored.bones).toHaveLength(rig.bones.length);
  });
});
