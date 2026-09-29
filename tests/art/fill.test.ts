import { describe, expect, it } from 'vitest';
import { analyze, defaultFillParams, distanceTransform, escapeLevels, fillRegion, gapsFor, wallsFromAlpha, wallsFromColor, type FillParams } from '../../src/art/engine/fill';
import { arc, board, inkRgba, line, maskAt, ringWithGap } from './helpers';

const W = 400;
const H = 400;
const auto = (): FillParams => defaultFillParams('auto', 1024, 1024, false);

function analysisOf(draw: (t: ReturnType<typeof board>) => void, maxGap = 11) {
  const t = board(W, H);
  draw(t);
  return analyze(wallsFromAlpha(inkRgba(t), W, H), W, H, maxGap);
}

describe('gap-closing fill', () => {
  it('fills a closed circle exactly (G = 0) and stays inside', () => {
    const a = analysisOf((t) => ringWithGap(t, 200, 200, 100, 7, 0));
    const r = fillRegion(a, 200, 200, auto());
    expect(r).not.toBeNull();
    expect(r!.gap).toBe(0);
    expect(r!.background).toBe(false);
    expect(maskAt(r!, 200, 200)).toBe(255);
    expect(maskAt(r!, 200, 320)).toBe(0);
    expect(maskAt(r!, 20, 20)).toBe(0);
    // Tucked 2 px under the line: the ink's inner edge is covered.
    expect(maskAt(r!, 200, 200 - 100 + 2)).toBeGreaterThan(0);
    const inside = Math.PI * 96.5 * 96.5;
    expect(r!.area).toBeGreaterThan(inside * 0.95);
    expect(r!.area).toBeLessThan(inside * 1.1);
  });

  it('seals a sketchy 8 px gap that a naive fill leaks through', () => {
    const a = analysisOf((t) => ringWithGap(t, 200, 200, 100, 6, 8));
    const naive = fillRegion(a, 200, 200, { ...auto(), gaps: [0], fallbackGap: 0 });
    expect(naive!.background).toBe(true);
    expect(maskAt(naive!, 10, 10)).toBe(255);
    const r = fillRegion(a, 200, 200, auto());
    expect(r!.background).toBe(false);
    expect(r!.gap).toBeGreaterThanOrEqual(4);
    expect(r!.gap).toBeLessThanOrEqual(7);
    expect(maskAt(r!, 10, 10)).toBe(0);
    expect(maskAt(r!, 200, 200)).toBe(255);
    // The gap is closed near its midline: nothing leaks far outside it.
    expect(maskAt(r!, 200, 200 - 100 - 12)).toBe(0);
  });

  it('picks the smallest gap that seals: a closed shape stays at G = 0 next to a gapped one', () => {
    const a = analysisOf((t) => {
      ringWithGap(t, 110, 200, 70, 6, 0);
      ringWithGap(t, 290, 200, 70, 6, 14);
    });
    expect(fillRegion(a, 110, 200, auto())!.gap).toBe(0);
    expect(fillRegion(a, 290, 200, auto())!.gap).toBeGreaterThan(4);
  });

  it('never bleeds a background tap into shapes with gaps', () => {
    const a = analysisOf((t) => {
      ringWithGap(t, 120, 200, 70, 6, 10);
      ringWithGap(t, 290, 200, 70, 6, 0);
    });
    const r = fillRegion(a, 10, 10, auto());
    expect(r!.background).toBe(true);
    expect(maskAt(r!, 10, 390)).toBe(255);
    expect(maskAt(r!, 120, 200)).toBe(0);
    expect(maskAt(r!, 290, 200)).toBe(0);
  });

  it('a tap on a line fills the nearest side', () => {
    const a = analysisOf((t) => ringWithGap(t, 200, 200, 100, 9, 0));
    // The line's centre is at y = 100; 2 px inside it and 2 px outside it.
    const inner = fillRegion(a, 200, 102, auto());
    expect(maskAt(inner!, 200, 200)).toBe(255);
    expect(maskAt(inner!, 10, 10)).toBe(0);
    const outer = fillRegion(a, 200, 98, auto());
    expect(maskAt(outer!, 10, 10)).toBe(255);
    expect(maskAt(outer!, 200, 200)).toBe(0);
  });

  it('splits two inner regions that touch through a gap (face inside a helmet)', () => {
    const a = analysisOf((t) => {
      ringWithGap(t, 200, 200, 150, 7, 0); // helmet, closed
      ringWithGap(t, 200, 215, 80, 7, 18, 180); // face, with a gap on its left
    });
    const glass = fillRegion(a, 200, 90, auto());
    expect(glass!.background).toBe(false);
    expect(glass!.split).toBe(true);
    expect(maskAt(glass!, 200, 90)).toBe(255);
    expect(maskAt(glass!, 200, 215)).toBe(0);
    const face = fillRegion(a, 200, 215, auto());
    expect(face!.split).toBe(true);
    expect(maskAt(face!, 200, 215)).toBe(255);
    expect(maskAt(face!, 200, 90)).toBe(0);
  });

  it('does not split a plain region with no inner gap', () => {
    const a = analysisOf((t) => {
      ringWithGap(t, 200, 200, 150, 7, 0);
      line(t, 60, 200, 150, 200, 5); // a whisker poking in from the outline
    });
    const r = fillRegion(a, 200, 120, auto());
    expect(r!.split).toBe(false);
    expect(maskAt(r!, 200, 300)).toBe(255);
    expect(maskAt(r!, 100, 190)).toBe(255);
    expect(maskAt(r!, 100, 210)).toBe(255);
  });

  it('keeps an eye with a gap out of the face fill', () => {
    const a = analysisOf((t) => {
      ringWithGap(t, 200, 200, 150, 7, 0);
      ringWithGap(t, 150, 170, 26, 5, 7, 0);
    });
    const face = fillRegion(a, 260, 260, auto());
    expect(maskAt(face!, 260, 260)).toBe(255);
    expect(maskAt(face!, 150, 170)).toBe(0);
  });

  it('returns null for a sliver between two lines', () => {
    const a = analysisOf((t) => {
      ringWithGap(t, 200, 200, 100, 8, 0);
      ringWithGap(t, 200, 200, 109, 8, 0);
    });
    expect(fillRegion(a, 200, 200 - 104.5, auto())).toBeNull();
  });

  it('escape levels agree with a brute-force flood on small random boards', () => {
    let seed = 7;
    const rand = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296);
    for (let trial = 0; trial < 6; trial++) {
      const w = 40;
      const h = 32;
      const wall = new Uint8Array(w * h);
      for (let i = 0; i < wall.length; i++) wall[i] = rand() < 0.28 ? 1 : 0;
      const dist = distanceTransform(wall, w, h);
      const esc = escapeLevels(dist, w, h, 4);
      for (const thr of [0, 3, 6, 9, 12]) {
        // Brute force: pixels reachable from the border through pixels with dist >= thr... sealed iff esc < thr.
        const reach = new Uint8Array(w * h);
        const q: number[] = [];
        for (let i = 0; i < w * h; i++) {
          const x = i % w;
          const y = (i / w) | 0;
          if ((x === 0 || y === 0 || x === w - 1 || y === h - 1) && dist[i] >= thr) {
            reach[i] = 1;
            q.push(i);
          }
        }
        while (q.length) {
          const i = q.pop()!;
          const x = i % w;
          const y = (i / w) | 0;
          for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1]) {
            if (j < 0 || reach[j] || dist[j] < thr) continue;
            reach[j] = 1;
            q.push(j);
          }
        }
        for (let i = 0; i < w * h; i++) if (dist[i] >= thr) expect(esc[i] >= thr).toBe(reach[i] === 1);
      }
    }
  });

  it('colour walls: a composite fill stops at a colour change and ignores AA noise within tolerance', () => {
    const w = 60;
    const h = 40;
    const rgba = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      const x = i % w;
      rgba.set(x < 30 ? [250, 250, 245, 255] : [30, 90, 200, 255], i * 4);
    }
    rgba.set([255, 252, 240, 255], (10 * w + 10) * 4); // within tolerance
    const a = analyze(wallsFromColor(rgba, w, h, 5, 5, 40), w, h, 0);
    const r = fillRegion(a, 5, 5, { gaps: [0], fallbackGap: 0, expand: 0, soften: false, innerCheck: false });
    expect(maskAt(r!, 10, 10)).toBe(255);
    expect(maskAt(r!, 29, 20)).toBe(255);
    expect(maskAt(r!, 30, 20)).toBe(0);
  });

  it('pixel-art fills are exact and hard-edged', () => {
    const w = 16;
    const h = 16;
    const rgba = new Uint8ClampedArray(w * h * 4);
    for (let x = 0; x < 16; x++) rgba.set([0, 0, 0, 255], (8 * w + x) * 4);
    const a = analyze(wallsFromColor(rgba, w, h, 3, 3, 0), w, h, 0);
    const r = fillRegion(a, 3, 3, defaultFillParams('auto', w, h, true));
    expect(r!.area).toBe(16 * 8);
    expect([...r!.mask].every((v) => v === 0 || v === 255)).toBe(true);
    expect(maskAt(r!, 3, 8)).toBe(0);
  });

  it('scales the gap radii with the board', () => {
    expect(gapsFor('auto', 1024, 1024).gaps).toEqual([0, 2, 4, 7, 11]);
    expect(gapsFor('auto', 2048, 1024).gaps).toEqual([0, 4, 8, 14, 22]);
    expect(gapsFor('auto', 256, 256).gaps).toEqual([0, 1, 2, 4, 6]);
    expect(gapsFor('off', 1024, 1024)).toEqual({ gaps: [0], fallbackGap: 0 });
  });

  it('an arc-only drawing is open background', () => {
    const a = analysisOf((t) => arc(t, 200, 200, 100, 6, 0, 120));
    expect(fillRegion(a, 200, 200, auto())!.background).toBe(true);
  });
});
