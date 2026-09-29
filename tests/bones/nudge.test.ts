/** Keyboard nudges, the drawing's fit in the sky, and the AI helper's hints in art px. */
import { describe, expect, it } from 'vitest';
import { clampTo, fitArt, isArrowKey, nudge, nudgeStep, scaleHints, starBounds, toArt, toSky, MAX_ZOOM } from '../../src/bones/geometry';

describe('keyboard nudge maths', () => {
  it('moves a star 1 art px per arrow, 10 with Shift', () => {
    expect(nudgeStep(false)).toBe(1);
    expect(nudgeStep(true)).toBe(10);
    expect(nudge([64, 179], 'ArrowRight', false)).toEqual([65, 179]);
    expect(nudge([64, 179], 'ArrowLeft', false)).toEqual([63, 179]);
    expect(nudge([64, 179], 'ArrowUp', true)).toEqual([64, 169]);
    expect(nudge([64, 179], 'ArrowDown', true)).toEqual([64, 189]);
  });

  it('lands on whole art px, so the label stays true', () => {
    expect(nudge([64.4, 179.6], 'ArrowRight', false)).toEqual([65, 180]);
    expect(nudge([64.5, 0.2], 'ArrowUp', false)).toEqual([65, -1]);
  });

  it('keeps the star inside its bounds', () => {
    const b = { x0: 0, y0: 0, x1: 100, y1: 200 };
    expect(nudge([2, 50], 'ArrowLeft', true, b)).toEqual([0, 50]);
    expect(nudge([99, 199], 'ArrowRight', true, b)).toEqual([100, 199]);
    expect(nudge([50, 195], 'ArrowDown', true, b)).toEqual([50, 200]);
    expect(nudge([50, 5], 'ArrowUp', true, { x0: 0.4, y0: 0.4, x1: 99.6, y1: 199.6 })).toEqual([50, 1]);
  });

  it('knows the arrow keys', () => {
    for (const k of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']) expect(isArrowKey(k)).toBe(true);
    for (const k of ['Enter', 'Tab', 'a', 'Left']) expect(isArrowKey(k)).toBe(false);
  });
});

describe('the drawing in the sky', () => {
  it('fits the drawing in the free room, centred', () => {
    const f = fitArt(884, 632, 260, 310);
    expect(f.k).toBeCloseTo((632 - 44 - 84) / 310, 5);
    const [x0, y0] = toSky(f, 0, 0);
    const [x1, y1] = toSky(f, 260, 310);
    expect(y0).toBeCloseTo(44, 5);
    expect(y1).toBeCloseTo(632 - 84, 5);
    expect((x0 + x1) / 2).toBeCloseTo(72 + (884 - 72 - 72) / 2, 5);
  });

  it('never blows a small drawing up past the zoom cap', () => {
    expect(fitArt(884, 632, 40, 40).k).toBe(MAX_ZOOM);
  });

  it('maps sky px and art px both ways', () => {
    const f = fitArt(800, 600, 300, 400);
    const [sx, sy] = toSky(f, 123, 321);
    const [ax, ay] = toArt(f, sx, sy);
    expect(ax).toBeCloseTo(123, 6);
    expect(ay).toBeCloseTo(321, 6);
  });

  it('keeps dragged stars inside the sky', () => {
    const f = fitArt(800, 600, 300, 400);
    const b = starBounds(f, 800, 600, 12);
    const [x, y] = clampTo([-5000, 5000], b);
    const [sx, sy] = toSky(f, x, y);
    expect(sx).toBeCloseTo(12, 5);
    expect(sy).toBeCloseTo(588, 5);
  });
});

describe("the AI helper's hints", () => {
  it('scales hints from the outline it saw to the drawing', () => {
    const out = scaleHints({ armL2: [64, 100], head: [128, 20] }, 256, 200, 512, 400);
    expect(out.armL2).toEqual([128, 200]);
    expect(out.head).toEqual([256, 40]);
  });

  it('reads hints in the reply space (0..1000) when they go past the outline', () => {
    const out = scaleHints({ armL2: [500, 900] }, 256, 200, 512, 400);
    expect(out.armL2![0]).toBeCloseTo(256);
    expect(out.armL2![1]).toBeCloseTo(360);
  });

  it('drops broken points', () => {
    const out = scaleHints({ armL2: [Number.NaN, 3], legL1: [10, 10] }, 100, 100, 100, 100);
    expect(out.armL2).toBeUndefined();
    expect(out.legL1).toEqual([10, 10]);
  });
});
