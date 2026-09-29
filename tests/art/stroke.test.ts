import { describe, expect, it } from 'vitest';
import { type BeginOpts, StrokeEngine } from '../../src/art/engine/stroke';
import { brushFor, type BrushId } from '../../src/art/engine/brushes';
import { grainFor } from '../../src/art/engine/grain';
import { PixelStroke } from '../../src/art/engine/pixel';
import { sameBytes } from './helpers';

const W = 256;
const H = 256;

function opts(id: BrushId, size: number, extra: Partial<BeginOpts> = {}): BeginOpts {
  const brush = brushFor(id, { size });
  return { brush, realPressure: true, scale: 1, stabilizer: 0, predictMs: 12, symmetry: null, grain: brush.texture ? grainFor(brush.texture) : null, ...extra };
}

/** A wavy pen stroke: [x, y, pressure, t] at 240 Hz. */
function samples(n = 120): Array<[number, number, number, number]> {
  return Array.from({ length: n }, (_, i) => {
    const u = i / (n - 1);
    return [30 + 190 * u, 128 + 50 * Math.sin(u * Math.PI * 2.5), 0.2 + 0.7 * Math.sin(Math.PI * u), i * 4.1667];
  });
}

/** Draws the samples, calling update() every `every` samples (0 = only at the end). */
function draw(e: StrokeEngine, o: BeginOpts, every: number): Float32Array {
  const s = samples();
  e.clearBuffers();
  e.begin(o, s[0][0], s[0][1], s[0][2], s[0][3]);
  for (let i = 1; i < s.length; i++) {
    e.addSample(s[i][0], s[i][1], s[i][2], s[i][3]);
    if (every && i % every === 0) e.update();
  }
  e.finish();
  return e.prefix.buf.slice();
}

describe('stroke engine', () => {
  it('gives the same pixels however often the screen updated (live drawing = replay)', () => {
    for (const [id, size] of [['ink', 9], ['pencil', 5], ['crayon', 18], ['marker', 26], ['airbrush', 40]] as Array<[BrushId, number]>) {
      const e = new StrokeEngine(W, H);
      const once = draw(e, opts(id, size), 0);
      const often = draw(e, opts(id, size), 1);
      const sometimes = draw(e, opts(id, size), 7);
      expect(sameBytes(once, often), id).toBe(true);
      expect(sameBytes(once, sometimes), id).toBe(true);
    }
  });

  it('mirrors exactly across a vertical axis', () => {
    const e = new StrokeEngine(W, H);
    const buf = draw(e, opts('ink', 8, { symmetry: { x: W / 2, y: null } }), 3);
    let worst = 0;
    let sum = 0;
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W / 2; x++) {
        worst = Math.max(worst, Math.abs(buf[y * W + x] - buf[y * W + (W - 1 - x)]));
        sum += buf[y * W + x];
      }
    expect(sum).toBeGreaterThan(100);
    expect(worst).toBeLessThan(1e-4);
  });

  it('draws a tap as a round dot and tapers both ends of a pen stroke', () => {
    const e = new StrokeEngine(W, H);
    e.begin(opts('ink', 10), 100.5, 100.5, 0.8, 0);
    e.finish();
    const at = (x: number, y: number): number => e.prefix.buf[y * W + x];
    expect(at(100, 100)).toBe(1);
    expect(at(103, 100)).toBeCloseTo(at(100, 103), 6);
    expect(at(110, 100)).toBe(0);
    // A straight pen stroke, light at both ends: thin tips, full width in the middle.
    e.clearBuffers();
    e.begin(opts('ink', 12), 30, 128, 0.2, 0);
    for (let i = 1; i < 120; i++) {
      const u = i / 119;
      e.addSample(30 + 190 * u, 128, 0.2 + 0.7 * Math.sin(Math.PI * u), i * 4.1667);
      if (i % 3 === 0) e.update();
    }
    e.finish();
    const buf = e.prefix.buf;
    const column = (x: number): number => {
      let s = 0;
      for (let y = 0; y < H; y++) s += buf[y * W + x];
      return s;
    };
    expect(column(33)).toBeLessThan(column(125) * 0.5);
    expect(column(217)).toBeLessThan(column(125) * 0.5);
  });

  it('pixel pen: hard pixels, no L-shaped corners on a diagonal', () => {
    const p = new PixelStroke(64, 64);
    // A slow staircase: every other sample steps sideways, then down (an L each time).
    p.begin(1, null, 5, 5);
    for (let i = 1; i <= 40; i++) p.addSample(5 + Math.ceil(i / 2) + 0.5, 5 + Math.floor(i / 2) + 0.5);
    p.update();
    p.finish();
    const on = (x: number, y: number): boolean => p.prefix.buf[y * 64 + x] > 0;
    let pixels = 0;
    let corners = 0;
    for (let y = 1; y < 63; y++)
      for (let x = 1; x < 63; x++) {
        if (!on(x, y)) continue;
        pixels++;
        expect([0, 1]).toContain(p.prefix.buf[y * 64 + x]);
        // An L corner: a pixel with both a horizontal and a vertical neighbour.
        if ((on(x - 1, y) || on(x + 1, y)) && (on(x, y - 1) || on(x, y + 1))) corners++;
      }
    expect(pixels).toBeGreaterThan(15);
    expect(corners).toBe(0);
  });
});
