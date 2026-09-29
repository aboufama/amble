/** "13 more steps ▾" (§2.9): only steps really hidden below the Footsteps list count. */
import { describe, expect, it } from 'vitest';
import { stepsBelow, type Span } from '../../src/screens/footsteps/moreBelow';

const ZONE = 34;
/** `n` steps of `h` px from `top`, 4 px apart. */
const steps = (n: number, h = 56, top = 0): Span[] => Array.from({ length: n }, (_, i) => ({ top: top + i * (h + 4), bottom: top + i * (h + 4) + h }));

describe('steps below the Footsteps list', () => {
  it('never counts the only step a short panel shows (shorter than one step plus the button)', () => {
    expect(stepsBelow({ top: 0, bottom: 80 }, steps(1), ZONE, false)).toBe(0);
    expect(stepsBelow({ top: 0, bottom: 30 }, steps(1), ZONE, false)).toBe(0);
  });

  it('counts the steps after the first one on screen that end under the button', () => {
    expect(stepsBelow({ top: 0, bottom: 80 }, steps(3), ZONE, false)).toBe(2);
    // A tall panel: steps 0-3 show whole, step 4 ends under the button, steps 5-9 are out of sight.
    expect(stepsBelow({ top: 0, bottom: 300 }, steps(10), ZONE, false)).toBe(6);
  });

  it('skips steps scrolled away above the view', () => {
    // Scrolled so that steps 0-2 are above the view: step 3 is the first on screen.
    expect(stepsBelow({ top: 0, bottom: 300 }, steps(10, 56, -180), ZONE, false)).toBe(3);
  });

  it('counts nothing once the list is scrolled to its end, or fits', () => {
    expect(stepsBelow({ top: 0, bottom: 300 }, steps(5), ZONE, true)).toBe(0);
    expect(stepsBelow({ top: 0, bottom: 80 }, steps(3), ZONE, true)).toBe(0);
  });
});
