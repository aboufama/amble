/**
 * A rigged character survives one bad frame. Game code sets `hero.animSpeed` and moves characters, and a
 * slip there (a 0/0, an undefined speed) hands the rig a NaN time step or a NaN position for a frame. The
 * drawing must come back as soon as the numbers do, instead of staying invisible for the rest of the run.
 */
import { describe, expect, it } from 'vitest';
import { RigPuppet } from '../../src/rig/runtime/puppet';
import { bound } from './helpers';

const finite = (p: RigPuppet): boolean => p.vertices!.every((v) => Number.isFinite(v));

const run = (p: RigPuppet, frames: number, motion: { dx?: number; dy?: number } = {}): void => {
  for (let i = 0; i < frames; i++) p.update(1 / 60, motion);
};

describe('a rigged character after a non-finite frame', () => {
  it('recovers from a NaN time step', () => {
    const p = new RigPuppet(bound('dog'));
    run(p, 30);
    expect(finite(p)).toBe(true);
    p.update(NaN);
    run(p, 60);
    expect(finite(p)).toBe(true);
  });

  it('recovers from an infinite time step', () => {
    const p = new RigPuppet(bound('stick'));
    p.update(Infinity);
    run(p, 60);
    expect(finite(p)).toBe(true);
  });

  it('plays a move asked for at a NaN speed at its normal speed', () => {
    const p = new RigPuppet(bound('stick'));
    p.play('walk', { speed: NaN });
    run(p, 30);
    expect(finite(p)).toBe(true);
  });

  it('recovers from one frame of NaN motion (its springs too)', () => {
    const p = new RigPuppet(bound('dog'));
    run(p, 30, { dx: 2 });
    p.update(1 / 60, { dx: NaN, dy: NaN });
    run(p, 60, { dx: 2 });
    expect(finite(p)).toBe(true);
  });
});
