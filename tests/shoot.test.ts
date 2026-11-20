import { describe, expect, it } from 'vitest';
import { intercept } from '../src/engine/sprite';

describe('aiming a shot at something that moves', () => {
  it('aims straight at a target that stands still', () => {
    expect(intercept({ x: 0, y: 0 }, 500, { x: 300, y: 0 }, { x: 0, y: 0 })).toEqual({ x: 300, y: 0 });
  });

  it('aims ahead of a target crossing in front, so the shot and the target meet', () => {
    const from = { x: 0, y: 0 };
    const p = { x: 0, y: 300 };
    const v = { x: 100, y: 0 };
    const aim = intercept(from, 500, p, v);
    expect(aim.x).toBeGreaterThan(0);
    // The shot reaches the aim point exactly when the target does.
    const t = (aim.x - p.x) / v.x;
    expect(Math.hypot(aim.x - from.x, aim.y - from.y) / 500).toBeCloseTo(t, 5);
  });

  it('aims straight at a target too fast to catch', () => {
    expect(intercept({ x: 0, y: 0 }, 100, { x: 200, y: 0 }, { x: 400, y: 0 })).toEqual({ x: 200, y: 0 });
  });
});
