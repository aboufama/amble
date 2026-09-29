/** A fill that leaked through a gap (§7.4): a spot nearly surrounded by lines, told from open paper. */
import { describe, expect, it } from 'vitest';
import { surroundedByLines } from '../../src/draw/leak';

/** A grid with a ring of lines (radius r, 3 px thick) around (cx, cy), open between angles a0 and a1 (degrees). */
function ring(cx: number, cy: number, r: number, gap?: [number, number]): (x: number, y: number) => boolean {
  return (x, y) => {
    const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
    if (Math.abs(d - r) > 1.5) return false;
    if (!gap) return true;
    let a = (Math.atan2(y + 0.5 - cy, x + 0.5 - cx) * 180) / Math.PI;
    if (a < 0) a += 360;
    return !(a >= gap[0] && a <= gap[1]);
  };
}

describe('surroundedByLines', () => {
  it('sees a shape with a small gap as surrounded (a fill from inside leaked)', () => {
    const wall = ring(128, 128, 70, [350, 360]);
    expect(surroundedByLines(wall, 256, 256, 128, 128)).toBe(true);
  });

  it('sees a closed shape as surrounded', () => {
    expect(surroundedByLines(ring(128, 128, 70), 256, 256, 120, 140)).toBe(true);
  });

  it('leaves a wide opening alone (a C shape, the space between legs)', () => {
    const wall = ring(128, 128, 70, [300, 360]);
    expect(surroundedByLines(wall, 256, 256, 128, 128)).toBe(false);
  });

  it('leaves the open paper beside a drawing alone', () => {
    const wall = ring(180, 180, 40);
    expect(surroundedByLines(wall, 256, 256, 40, 40)).toBe(false);
    expect(surroundedByLines(wall, 256, 256, 60, 200)).toBe(false);
  });

  it('is false off the grid', () => {
    expect(surroundedByLines(() => true, 10, 10, -1, 5)).toBe(false);
  });
});
