import { describe, expect, it } from 'vitest';
import { HITSTOP_MAX_MS, hitstopEnd } from '../../src/runtime/kit/util';

// fx.hitstop(ms) sets the kit's `hitstopUntil = hitstopEnd(hitstopUntil, now, ms)`, and the world stands still
// while the clock is before it. Game code picks ms, so a ratio with a zero under it can hand it Infinity or NaN.
describe('the hit-stop the kit freezes the world for', () => {
  it('pauses for the ms asked, and never shortens a pause already running', () => {
    expect(hitstopEnd(0, 1000, 80)).toBe(1080);
    expect(hitstopEnd(1200, 1000, 80)).toBe(1200);
    expect(hitstopEnd(1050, 1000, 120)).toBe(1120);
  });

  it('keeps an endless pause to a moment instead of freezing the game', () => {
    expect(hitstopEnd(0, 1000, Infinity)).toBe(1000 + HITSTOP_MAX_MS);
    expect(hitstopEnd(0, 1000, 1e9)).toBe(1000 + HITSTOP_MAX_MS);
    expect(HITSTOP_MAX_MS).toBeLessThanOrEqual(1000);
  });

  it('turns NaN into the default pause, so hit-stop keeps working for the rest of the run', () => {
    let until = hitstopEnd(0, 1000, NaN);
    expect(until).toBe(1060);
    expect(Number.isFinite(until)).toBe(true);
    // A later hit still pauses the world.
    until = hitstopEnd(until, 5000, 100);
    expect(until).toBe(5100);
  });

  it('recovers from a pause that was already broken', () => {
    expect(hitstopEnd(NaN, 1000, 100)).toBe(1100);
    expect(hitstopEnd(Infinity, 1000, 100)).toBe(1100);
  });

  it('reads what game code passes: a missing value, a number in a string, a negative one', () => {
    expect(hitstopEnd(0, 1000, undefined)).toBe(1060);
    expect(hitstopEnd(0, 1000, '150')).toBe(1150);
    expect(hitstopEnd(0, 1000, 'long')).toBe(1060);
    expect(hitstopEnd(0, 1000, -500)).toBe(1000);
    expect(hitstopEnd(0, 1000, -Infinity)).toBe(1000);
  });
});
