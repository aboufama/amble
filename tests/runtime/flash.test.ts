import { describe, expect, it } from 'vitest';
import {
  FLASH_POLICY,
  FLASH_POLICY_REDUCED,
  FlashLimiter,
  isSaturatedRed,
  isStrobeJump,
  luminance,
  mixColor,
  safeFlashAlpha,
} from '../../src/runtime/shell/flash';

describe('FlashLimiter', () => {
  it('allows at most 3 flashes in any one-second window', () => {
    const f = new FlashLimiter();
    const allowed: number[] = [];
    // A game asking for a flash every frame at 60 fps for 3 seconds.
    for (let frame = 0; frame < 180; frame++) {
      const t = frame * (1000 / 60);
      if (f.allow(t)) allowed.push(t);
    }
    expect(allowed.length).toBe(9);
    for (const t of allowed) expect(allowed.filter((u) => u >= t && u < t + 1000).length).toBeLessThanOrEqual(3);
  });

  it('refuses a fourth flash inside the same second, then allows again later', () => {
    const f = new FlashLimiter();
    expect([f.allow(0), f.allow(10), f.allow(20), f.allow(30)]).toEqual([true, true, true, false]);
    expect(f.recent(40)).toBe(3);
    expect(f.allow(1001)).toBe(true);
  });

  it('is stricter with reduced motion', () => {
    const f = new FlashLimiter(FLASH_POLICY_REDUCED);
    expect([f.allow(0), f.allow(500), f.allow(1000)]).toEqual([true, false, true]);
    f.setPolicy(FLASH_POLICY);
    expect(f.maxAlpha).toBe(0.55);
  });
});

describe('flash colours', () => {
  it('caps alpha and damps saturated red', () => {
    expect(safeFlashAlpha(1, 0xffffff, FLASH_POLICY)).toBe(0.55);
    expect(safeFlashAlpha(0.3, 0xffffff, FLASH_POLICY)).toBe(0.3);
    expect(safeFlashAlpha(1, 0xff0000, FLASH_POLICY)).toBeCloseTo(0.275);
    expect(safeFlashAlpha(Number.NaN, 0xffffff, FLASH_POLICY_REDUCED)).toBe(0.25);
  });

  it('recognises saturated red', () => {
    expect(isSaturatedRed(0xff1010)).toBe(true);
    expect(isSaturatedRed(0xff8c42)).toBe(false);
    expect(isSaturatedRed(0xffffff)).toBe(false);
  });

  it('detects strobe-like background jumps', () => {
    expect(luminance(0xffffff)).toBeCloseTo(1);
    expect(luminance(0x000000)).toBe(0);
    expect(isStrobeJump(0x000000, 0xffffff)).toBe(true);
    expect(isStrobeJump(0x120a2a, 0x2c0a22)).toBe(false);
    expect(isStrobeJump(0x101010, 0xff0000)).toBe(true);
  });

  it('mixes colours', () => {
    expect(mixColor(0x000000, 0xffffff, 0.5)).toBe(0x808080);
    expect(mixColor(0x102030, 0x102030, 0.7)).toBe(0x102030);
  });
});
