/** The simulated hand (src/starters/art/hand.ts): timing, pressure and tremor like a kid's pen, and valid ops. */
import { describe, expect, it } from 'vitest';
import { validateArtScript, type ArtScript } from '../../src/cores/art';
import { blob, dot, penStroke, rng, scribble, wobblyPath, type Pt } from '../../src/starters/art/hand';

describe('hand helpers', () => {
  it('rng is seeded', () => {
    const a = rng(5);
    const b = rng(5);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });

  it('wobblyPath runs near the planned points, with a little wobble', () => {
    const plan: Pt[] = [[10, 10], [100, 20], [150, 90]];
    const path = wobblyPath(plan, { wobble: 1.5, seed: 2 });
    for (const [px, py] of plan) expect(Math.min(...path.map(([x, y]) => Math.hypot(x - px, y - py)))).toBeLessThan(3);
    const straight = wobblyPath([[0, 0], [200, 0]], { wobble: 1.5, seed: 3 });
    expect(Math.max(...straight.map((p) => Math.abs(p[1])))).toBeGreaterThan(0.05);
    expect(Math.max(...straight.map((p) => Math.abs(p[1])))).toBeLessThan(2);
  });

  it('penStroke samples every 8 to 14 ms, slow at the ends and fast in the middle, with a pressure ramp', () => {
    const op = penStroke(wobblyPath([[0, 0], [300, 0]]), { layer: 'lines', color: '#2b2622', size: 4.5, dt: 20 });
    expect(op.dt).toBe(14);
    const pts = op.points;
    const gap = (i: number) => Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
    const mid = Math.floor(pts.length / 2);
    expect(gap(mid)).toBeGreaterThan(gap(0) * 3);
    expect(gap(mid)).toBeGreaterThan(gap(pts.length - 2) * 3);
    for (const p of pts) {
      expect(p[2]).toBeGreaterThan(0);
      expect(p[2]).toBeLessThanOrEqual(1);
    }
    expect(pts[0][2]).toBeLessThan(pts[mid][2]);
    expect(pts[pts.length - 1][2]).toBeLessThan(pts[mid][2]);
  });

  it('scribble colours inside the shape', () => {
    const square: Pt[] = [[20, 20], [120, 20], [120, 120], [20, 120]];
    const [op] = scribble(square, { layer: 'colors', color: '#ff6b4a', size: 8, seed: 4 });
    expect(op.op).toBe('stroke');
    if (op.op !== 'stroke') return;
    expect(op.brush).toBe('crayon');
    // A crayon goes a little over the lines, never far.
    for (const [x, y] of op.points) {
      expect(x).toBeGreaterThan(20 - 4);
      expect(x).toBeLessThan(120 + 4);
      expect(y).toBeGreaterThan(20 - 4);
      expect(y).toBeLessThan(120 + 4);
    }
  });

  it('makes a drawing the art engine accepts', () => {
    const body = blob(128, 150, 70, { seed: 9 });
    const script: ArtScript = {
      v: 1,
      name: 'test-blob',
      kind: 'character',
      rig: 'blob',
      width: 256,
      height: 256,
      layers: [{ id: 'colors', role: 'colors' }, { id: 'lines', role: 'lines' }],
      ops: [
        penStroke(wobblyPath(body, { closed: true }), { layer: 'lines', color: '#2b2622', size: 4.5 }),
        { op: 'fill', layer: 'colors', x: 128, y: 150, color: '#a78bfa', underLines: true },
        ...scribble(body, { layer: 'colors', color: '#8b5cf6', size: 6 }),
        dot(105, 130, { layer: 'lines', color: '#2b2622', size: 7 }),
        dot(150, 130, { layer: 'lines', color: '#2b2622', size: 7 }),
      ],
    };
    expect(validateArtScript(script)).toEqual([]);
  });
});
