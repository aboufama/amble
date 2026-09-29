/**
 * The engine operations the Desk adds (§7.2, §7.4 escape hatches): lasso fill (a fill-only polygon), the
 * Curve shape, "Fill all of this colour" and "Copy it to the other side". Each is one logged op that replays
 * to the same pixels.
 */
import { describe, expect, it } from 'vitest';
import { Board } from '../../src/art/engine/board';
import type { LogCopy, LogFill, LogOp, LogShape } from '../../src/art/engine/log';
import { makeLayer } from '../../src/art/engine/model';
import { Painter } from '../../src/art/engine/paint';
import { applyOp, replayLog } from '../../src/art/engine/replay';
import { curveThrough } from '../../src/art/engine/shape';

const F = 'f1';

function setup(W: number, H: number, layers: Array<[string, Parameters<typeof makeLayer>[1]]>) {
  const b = new Board(W, H, false);
  b.layers = layers.map(([id, role]) => makeLayer(id, role));
  b.frames = [{ id: F, hold: 1 }];
  return { b, painter: new Painter(b) };
}

const alphaAt = (b: Board, layer: string, x: number, y: number): number => b.pixels(F, layer)?.[(y * b.W + x) * 4 + 3] ?? 0;

function shape(o: Partial<LogShape> & Pick<LogShape, 'shape' | 'points' | 'layer'>): LogShape {
  return { op: 'shape', frame: F, brush: 'ink', size: 6, color: '#204080', opacity: 1, filled: false, mirror: null, ...o };
}

describe('lasso fill and shapes', () => {
  it('a fill-only polygon fills inside and draws no outline', () => {
    const { b, painter } = setup(100, 100, [['colors', 'colors']]);
    painter.paintShape(shape({ layer: 'colors', shape: 'polygon', points: [[20, 20], [80, 20], [80, 80], [20, 80]], filled: true, outline: false }));
    expect(alphaAt(b, 'colors', 50, 50)).toBe(255);
    expect(alphaAt(b, 'colors', 22, 50)).toBe(255);
    expect(alphaAt(b, 'colors', 17, 50)).toBe(0); // an outline would reach 3 px outside
    expect(alphaAt(b, 'colors', 5, 5)).toBe(0);
  });

  it('a curve passes through its middle point and a closed curve can be filled', () => {
    const pts = curveThrough([
      { x: 10, y: 50 },
      { x: 50, y: 10 },
      { x: 90, y: 50 },
    ]);
    expect(Math.min(...pts.map((p) => Math.hypot(p.x - 50, p.y - 10)))).toBeLessThan(1);
    const { b, painter } = setup(100, 100, [['colors', 'colors']]);
    painter.paintShape(
      shape({
        layer: 'colors',
        shape: 'curve',
        points: [[20, 50], [50, 20], [80, 50], [50, 80], [20, 50]],
        filled: true,
        outline: false,
      }),
    );
    expect(alphaAt(b, 'colors', 50, 50)).toBe(255);
    expect(alphaAt(b, 'colors', 5, 5)).toBe(0);
  });
});

describe('fill all of this colour', () => {
  it('changes every pixel of that colour on the layer, wherever it is, and nothing else', () => {
    const { b, painter } = setup(60, 20, [['colors', 'colors']]);
    const d = b.pixels(F, 'colors', true)!;
    const put = (x: number, rgba: number[]) => d.set(rgba, (10 * 60 + x) * 4);
    put(5, [200, 30, 30, 255]);
    put(30, [205, 28, 33, 255]); // close to it
    put(50, [30, 200, 30, 255]); // another colour
    put(52, [200, 30, 30, 120]); // same colour, softer edge
    const op: LogFill = { op: 'fill', layer: 'colors', frame: F, x: 5, y: 10, color: '#0000ff', tolerance: 40, sample: 'layer', gaps: [0], fallbackGap: 0, all: true };
    painter.paintLogFill(op);
    const at = (x: number) => [...d.subarray((10 * 60 + x) * 4, (10 * 60 + x) * 4 + 4)];
    expect(at(5)).toEqual([0, 0, 255, 255]);
    expect(at(30)).toEqual([0, 0, 255, 255]);
    expect(at(50)).toEqual([30, 200, 30, 255]);
    expect(at(52)).toEqual([0, 0, 255, 120]);
  });
});

describe('copy it to the other side', () => {
  it('mirrors a part pair onto the opposite pair, replacing it, and replays the same', async () => {
    const W = 100;
    const init: LogOp = {
      op: 'init',
      width: W,
      height: 60,
      pixelArt: false,
      layers: [makeLayer('armL', 'part:armL'), makeLayer('armL-lines', 'lines'), makeLayer('armR', 'part:armR'), makeLayer('armR-lines', 'lines')],
      frames: [{ id: F, hold: 1 }],
    };
    const ink: LogShape = shape({ layer: 'armL-lines', shape: 'line', points: [[10, 30], [30, 30]] });
    const old: LogShape = shape({ layer: 'armR-lines', shape: 'line', points: [[60, 10], [60, 50]] });
    const copy: LogCopy = { op: 'copy', frame: F, pairs: [['armL', 'armR'], ['armL-lines', 'armR-lines']], matrix: [-1, 0, 0, 1, W, 0] };
    const board = await replayLog([init, ink, old, copy]);
    expect(alphaAt(board, 'armR-lines', 80, 30)).toBe(255); // mirrored: x = 100 - 20
    expect(alphaAt(board, 'armR-lines', 60, 12)).toBe(0); // the old line is gone
    expect(alphaAt(board, 'armL-lines', 20, 30)).toBe(255); // the source stays
    // The same op applied step by step matches.
    const { b, painter } = setup(W, 60, [
      ['armL', 'part:armL'],
      ['armL-lines', 'lines'],
      ['armR', 'part:armR'],
      ['armR-lines', 'lines'],
    ]);
    for (const op of [ink, old, copy]) await applyOp(painter, op);
    expect([...(b.pixels(F, 'armR-lines') ?? [])]).toEqual([...(board.pixels(F, 'armR-lines') ?? [])]);
  });
});
