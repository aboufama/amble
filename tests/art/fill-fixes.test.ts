/**
 * The art department's findings on the core's fill and marker (S/art-dept/README.md, "Engine and rigger
 * requirements"), one block each:
 * 1. the inner-region split fires only at real gaps (a line end near the opening), never at narrow necks;
 * 2. a fill on a part layer takes its walls from its own pair's lines layer;
 * 3. a fill poured into a bare region covers a neighbour's spill along the shared line;
 * 4. a full-bleed fill is opaque right up to the page edge;
 * 5. a white or light marker shows on colour (dark markers still multiply).
 */
import { describe, expect, it } from 'vitest';
import { Board } from '../../src/art/engine/board';
import { analyze, defaultFillParams, fillRegion, wallsFromAlpha, type FillParams } from '../../src/art/engine/fill';
import type { LogFill, LogStroke } from '../../src/art/engine/log';
import { makeLayer, type ArtScript } from '../../src/art/engine/model';
import { Painter } from '../../src/art/engine/paint';
import { replayArtScript } from '../../src/art/engine/replay';
import { arc, board, inkRgba, line, maskAt, ringWithGap } from './helpers';
import type { Target } from '../../src/art/engine/raster';

const auto = (): FillParams => defaultFillParams('auto', 1024, 1024, false);

function analysisOf(W: number, H: number, draw: (t: Target) => void, maxGap = 11) {
  const t = board(W, H);
  draw(t);
  return analyze(wallsFromAlpha(inkRgba(t), W, H), W, H, maxGap);
}

/** A closed stadium (a rounded bar): vertical sides from y0 to y1, half-circle caps. */
function stadium(t: Target, cx: number, y0: number, y1: number, halfW: number, width: number): void {
  line(t, cx - halfW, y0, cx - halfW, y1, width);
  line(t, cx + halfW, y0, cx + halfW, y1, width);
  arc(t, cx, y0, halfW, width, 180, 180);
  arc(t, cx, y1, halfW, width, 0, 180);
}

describe('1. inner regions split at gaps, not at narrow necks', () => {
  it('fills a whole rocket body around its window (two narrow necks, no line ends)', () => {
    const a = analysisOf(400, 400, (t) => {
      stadium(t, 200, 140, 260, 60, 7);
      ringWithGap(t, 200, 200, 45, 7, 0); // the round window, closed
    });
    const r = fillRegion(a, 200, 110, auto())!;
    expect(r.background).toBe(false);
    expect(r.split).toBe(false);
    expect(maskAt(r, 200, 110)).toBe(255);
    expect(maskAt(r, 200, 290)).toBe(255); // below the window: the other side of both necks
    expect(maskAt(r, 147, 200)).toBeGreaterThan(0); // inside a neck
    expect(maskAt(r, 200, 200)).toBe(0); // the window stays out
    expect(maskAt(r, 20, 20)).toBe(0);
  });

  it('fills the whole body of a gear whose bolt holes pinch it into sectors', () => {
    const cx = 200;
    const cy = 200;
    const a = analysisOf(400, 400, (t) => {
      ringWithGap(t, cx, cy, 150, 7, 0); // rim
      ringWithGap(t, cx, cy, 100, 7, 0); // hub
      for (let k = 0; k < 6; k++) {
        const ang = (k * Math.PI) / 3;
        ringWithGap(t, cx + 125 * Math.cos(ang), cy + 125 * Math.sin(ang), 14, 7, 0); // bolt holes
      }
    });
    const tapAng = Math.PI / 6;
    const r = fillRegion(a, cx + 125 * Math.cos(tapAng), cy + 125 * Math.sin(tapAng), auto())!;
    expect(r.split).toBe(false);
    for (let k = 0; k < 6; k++) {
      const ang = Math.PI / 6 + (k * Math.PI) / 3;
      expect(maskAt(r, Math.round(cx + 125 * Math.cos(ang)), Math.round(cy + 125 * Math.sin(ang)))).toBe(255);
      const hole = (k * Math.PI) / 3;
      expect(maskAt(r, Math.round(cx + 125 * Math.cos(hole)), Math.round(cy + 125 * Math.sin(hole)))).toBe(0);
    }
    expect(maskAt(r, cx, cy)).toBe(0); // the hub
  });

  it('still splits at a real gap: a divider line that stops short of the outline', () => {
    const a = analysisOf(400, 400, (t) => {
      ringWithGap(t, 200, 200, 150, 7, 0);
      line(t, 40, 200, 336, 200, 7); // attached on the left, an 8 px gap on the right
    });
    const top = fillRegion(a, 200, 120, auto())!;
    expect(top.split).toBe(true);
    expect(maskAt(top, 200, 120)).toBe(255);
    expect(maskAt(top, 200, 280)).toBe(0);
    const bottom = fillRegion(a, 200, 280, auto())!;
    expect(bottom.split).toBe(true);
    expect(maskAt(bottom, 200, 280)).toBe(255);
    expect(maskAt(bottom, 200, 120)).toBe(0);
  });
});

// ------------------------------------------------------------------------------------------ helpers on boards

const F = 'f1';

function boardWith(W: number, H: number, layers: Array<{ id: string; role: Parameters<typeof makeLayer>[1] }>): { b: Board; painter: Painter } {
  const b = new Board(W, H, false);
  b.layers = layers.map((l) => makeLayer(l.id, l.role));
  b.frames = [{ id: F, hold: 1 }];
  return { b, painter: new Painter(b) };
}

function drawInk(b: Board, layer: string, draw: (t: Target) => void): void {
  const t = board(b.W, b.H);
  draw(t);
  b.setPixels(F, layer, inkRgba(t));
}

function px(b: Board, layer: string, x: number, y: number): [number, number, number, number] {
  const d = b.pixels(F, layer);
  if (!d) return [0, 0, 0, 0];
  const i = (y * b.W + x) * 4;
  return [d[i], d[i + 1], d[i + 2], d[i + 3]];
}

function fillOp(layer: string, x: number, y: number, color: string, extra: Partial<LogFill> = {}): LogFill {
  const p = defaultFillParams('auto', 1024, 1024, false);
  return { op: 'fill', layer, frame: F, x, y, color, tolerance: 40, sample: 'lines', gaps: p.gaps, fallbackGap: p.fallbackGap, ...extra };
}

describe('2. a fill on a part layer is walled by its own lines', () => {
  it('fills the torso under the arm that is drawn across it', () => {
    const { b, painter } = boardWith(240, 240, [
      { id: 'torso', role: 'part:torso' },
      { id: 'torso-lines', role: 'lines' },
      { id: 'armL', role: 'part:armL' },
      { id: 'armL-lines', role: 'lines' },
    ]);
    drawInk(b, 'torso-lines', (t) => ringWithGap(t, 120, 120, 80, 7, 0));
    drawInk(b, 'armL-lines', (t) => ringWithGap(t, 120, 120, 30, 7, 0)); // the arm, over the torso
    painter.paintLogFill(fillOp('torso', 120, 60, '#e04040'));
    expect(px(b, 'torso', 120, 60)[3]).toBe(255);
    expect(px(b, 'torso', 120, 120)[3]).toBe(255); // under the arm: no hole
    expect(px(b, 'torso', 120, 91)[3]).toBe(255); // under the arm's own outline
    expect(px(b, 'torso', 10, 10)[3]).toBe(0);
  });

  it('a script fill on a part layer uses the pair, and ignores other parts', async () => {
    const pts = (cx: number, cy: number, r: number): [number, number, number][] => {
      const out: [number, number, number][] = [];
      for (let k = 0; k <= 64; k++) out.push([cx + r * Math.cos((k / 64) * Math.PI * 2), cy + r * Math.sin((k / 64) * Math.PI * 2), 0.8]);
      return out;
    };
    const script: ArtScript = {
      v: 1,
      name: 'pair-fill',
      kind: 'character',
      rig: 'blob',
      width: 256,
      height: 256,
      layers: [
        { id: 'body', role: 'part:body' },
        { id: 'body-lines', role: 'lines' },
        { id: 'hat', role: 'part:extra1' },
        { id: 'hat-lines', role: 'lines' },
      ],
      ops: [
        { op: 'stroke', layer: 'body-lines', brush: 'ink', size: 7, color: '#221b2e', points: pts(128, 140, 90) },
        { op: 'stroke', layer: 'hat-lines', brush: 'ink', size: 7, color: '#221b2e', points: pts(128, 110, 30) },
        { op: 'fill', layer: 'body', x: 128, y: 200, color: '#f0c040' },
      ],
    };
    const doc = await replayArtScript(script);
    const cel = doc.cels.find((c) => c.layer === 'body');
    expect(cel).toBeTruthy();
    // The body cel covers the hat's circle too (the fill was not walled by the hat's lines).
    expect(cel!.y).toBeLessThan(80);
    expect(cel!.h).toBeGreaterThan(160);
  });
});

describe('3. a fill in a bare region covers a neighbour fill’s spill', () => {
  it('the second fill wins along the shared thin line, and a drawn detail stays on top', () => {
    const { b, painter } = boardWith(200, 120, [
      { id: 'colors', role: 'colors' },
      { id: 'lines', role: 'lines' },
    ]);
    drawInk(b, 'lines', (t) => {
      line(t, 20, 20, 180, 20, 2);
      line(t, 180, 20, 180, 100, 2);
      line(t, 180, 100, 20, 100, 2);
      line(t, 20, 100, 20, 20, 2);
      line(t, 100, 20, 100, 100, 2); // the shared thin line
    });
    painter.paintLogFill(fillOp('colors', 60, 60, '#ff0000'));
    // A crayon-like detail painted inside the right square before its fill.
    const colors = b.pixels(F, 'colors', true)!;
    for (let y = 56; y <= 64; y++) for (let x = 146; x <= 154; x++) colors.set([0, 160, 0, 255], (y * 200 + x) * 4);
    // The first fill spilled past the thin line into the right square.
    const lines = b.pixels(F, 'lines')!;
    let firstOpen = -1;
    for (let x = 100; x < 110; x++)
      if (lines[(60 * 200 + x) * 4 + 3] <= 80) {
        firstOpen = x;
        break;
      }
    expect(firstOpen).toBeGreaterThan(100);
    expect(px(b, 'colors', firstOpen, 60)[3]).toBeGreaterThan(0); // the spill
    painter.paintLogFill(fillOp('colors', 130, 60, '#0000ff'));
    for (let x = firstOpen; x < firstOpen + 4; x++) {
      const [r, , bl, a] = px(b, 'colors', x, 60);
      expect(a).toBe(255);
      expect(r).toBeLessThanOrEqual(16); // blue, with none of the red spill left on top
      expect(bl).toBeGreaterThanOrEqual(239);
    }
    expect(px(b, 'colors', 150, 60).slice(0, 3)).toEqual([0, 160, 0]); // the detail stays
    expect(px(b, 'colors', 60, 60).slice(0, 3)).toEqual([255, 0, 0]); // the neighbour is untouched
  });
});

describe('4. full-bleed fills', () => {
  it('are opaque right up to the page edge (lines on the page)', () => {
    const { b, painter } = boardWith(128, 96, [
      { id: 'colors', role: 'colors' },
      { id: 'lines', role: 'lines' },
    ]);
    drawInk(b, 'lines', (t) => ringWithGap(t, 64, 48, 20, 5, 0));
    painter.paintLogFill(fillOp('colors', 4, 4, '#3060c0'));
    for (const [x, y] of [
      [0, 0],
      [127, 0],
      [0, 95],
      [127, 95],
      [64, 0],
      [64, 95],
      [0, 48],
      [127, 48],
    ])
      expect(px(b, 'colors', x, y)[3]).toBe(255);
  });

  it('are opaque at the page edge with no lines at all', () => {
    const { b, painter } = boardWith(64, 64, [{ id: 'paint', role: 'paint' }]);
    painter.paintLogFill(fillOp('paint', 30, 30, '#20a060', { sample: 'all' }));
    for (const [x, y] of [
      [0, 0],
      [63, 63],
      [0, 31],
      [31, 63],
    ])
      expect(px(b, 'paint', x, y)[3]).toBe(255);
  });
});

function markerStroke(layer: string, color: string, y: number, x0: number, x1: number): LogStroke {
  const n = 24;
  const xyp = new Float32Array(n * 3);
  const dts = new Uint16Array(n);
  for (let i = 0; i < n; i++) {
    xyp[i * 3] = x0 + ((x1 - x0) * i) / (n - 1);
    xyp[i * 3 + 1] = y;
    xyp[i * 3 + 2] = 0.6;
    dts[i] = i ? 80 : 0;
  }
  return { op: 'stroke', layer, frame: F, brush: 'marker', size: 16, color, opacity: 0.5, steady: 0, input: 'pen', scale: 1, mirror: null, xyp, dts };
}

describe('5. marker highlights', () => {
  function blueBoard(): { b: Board; painter: Painter } {
    const r = boardWith(80, 40, [{ id: 'colors', role: 'colors' }]);
    const d = r.b.pixels(F, 'colors', true)!;
    for (let i = 0; i < 80 * 40; i++) d.set([40, 70, 200, 255], i * 4);
    return r;
  }

  it('a white marker lightens colour it is drawn on', () => {
    const { b, painter } = blueBoard();
    painter.paintLogStroke(markerStroke('colors', '#ffffff', 20, 10, 70));
    const [r, g, bl, a] = px(b, 'colors', 40, 20);
    expect(a).toBe(255);
    expect(r).toBeGreaterThan(40 + 60);
    expect(g).toBeGreaterThan(70 + 50);
    expect(bl).toBeGreaterThanOrEqual(200);
  });

  it('a dark marker still multiplies (layering darkens)', () => {
    const { b, painter } = blueBoard();
    painter.paintLogStroke(markerStroke('colors', '#806040', 20, 10, 70));
    const [r, g, bl] = px(b, 'colors', 40, 20);
    // multiply at 50 %: c * (1 - 0.5) + c * m / 255 * 0.5
    expect(Math.abs(r - (40 * 0.5 + (40 * 0x80) / 255 * 0.5))).toBeLessThanOrEqual(2);
    expect(Math.abs(g - (70 * 0.5 + (70 * 0x60) / 255 * 0.5))).toBeLessThanOrEqual(2);
    expect(Math.abs(bl - (200 * 0.5 + (200 * 0x40) / 255 * 0.5))).toBeLessThanOrEqual(2);
  });
});
