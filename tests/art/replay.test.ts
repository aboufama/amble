import { describe, expect, it } from 'vitest';
import { replayArtScript, replayLog, scriptToLog, validateArtScript } from '../../src/art/engine/replay';
import { artDocToBoard, deserializeArtDoc, readLog, serializeArtDoc } from '../../src/art/engine/serialize';
import { decodePng } from '../../src/art/engine/png';
import { exportArt } from '../../src/art/engine/export';
import type { ArtScript } from '../../src/art/engine/model';

/** A little round creature: an ink body in two strokes, a fill under the lines, eyes, a crayon smile. */
function creature(): ArtScript {
  const circle = (cx: number, cy: number, r: number, from: number, sweep: number, p = 0.8): [number, number, number][] => {
    const pts: [number, number, number][] = [];
    const n = Math.ceil((Math.abs(sweep) / 360) * 60);
    for (let i = 0; i <= n; i++) {
      const a = ((from + (sweep * i) / n) * Math.PI) / 180;
      const t = i / n;
      pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a), p * (0.4 + 0.6 * Math.sin(Math.PI * Math.min(1, t * 1.2)))]);
    }
    return pts;
  };
  return {
    v: 1,
    name: 'test-blob',
    kind: 'character',
    rig: 'blob',
    width: 128,
    height: 128,
    layers: [
      { id: 'colors', role: 'colors' },
      { id: 'lines', role: 'lines', name: 'Ink' },
    ],
    ops: [
      { op: 'stroke', layer: 'lines', brush: 'ink', size: 3, color: '#2b1d16', points: circle(64, 70, 40, 100, 200) },
      { op: 'stroke', layer: 'lines', brush: 'ink', size: 3, color: '#2b1d16', points: circle(64, 70, 40, 280, 190) },
      { op: 'fill', layer: 'colors', x: 64, y: 70, color: '#7cc95a', underLines: true },
      { op: 'shape', layer: 'lines', shape: 'ellipse', brush: 'ink', size: 2, color: '#2b1d16', points: [[48, 56], [58, 68]], filled: true },
      { op: 'shape', layer: 'lines', shape: 'ellipse', brush: 'ink', size: 2, color: '#2b1d16', points: [[70, 56], [80, 68]], filled: true },
      { op: 'stroke', layer: 'lines', brush: 'crayon', size: 3, color: '#b03a2e', points: [[50, 84, 0.6], [56, 89, 0.8], [64, 91, 0.9], [72, 89, 0.8], [78, 84, 0.6]], dt: 16 },
    ],
  };
}

const pixelAt = (img: { width: number; data: Uint8ClampedArray }, x: number, y: number): number[] => [...img.data.subarray((y * img.width + x) * 4, (y * img.width + x) * 4 + 4)];

describe('replayArtScript', () => {
  it('validates scripts and reports every problem', () => {
    expect(validateArtScript(creature())).toEqual([]);
    const bad = { ...creature(), width: 0, layers: [{ id: 'a', role: 'nope' }], ops: [{ op: 'fill', layer: 'zzz', x: 1, y: 1, color: 'red' }] } as unknown as ArtScript;
    const errors = validateArtScript(bad);
    expect(errors.length).toBeGreaterThanOrEqual(4);
    expect(errors.join(' ')).toMatch(/width/);
    expect(errors.join(' ')).toMatch(/role/);
    expect(errors.join(' ')).toMatch(/unknown layer/);
    expect(errors.join(' ')).toMatch(/bad color/);
    return expect(replayArtScript(bad)).rejects.toThrow(/Invalid ArtScript/);
  });

  it('draws the script into an ArtDoc with a layer per role', async () => {
    const progress: number[] = [];
    const doc = await replayArtScript(creature(), { onOp: (i, total) => void progress.push(i / total) });
    expect(progress.length).toBe(6);
    expect(progress[5]).toBeCloseTo(5 / 6);
    expect(doc.format).toBe('amble-art');
    expect(doc.name).toBe('test-blob');
    expect(doc.rig).toBe('blob');
    expect([doc.width, doc.height]).toEqual([128, 128]);
    expect(doc.layers.map((l) => [l.id, l.role, l.name])).toEqual([
      ['colors', 'colors', 'Colors'],
      ['lines', 'lines', 'Ink'],
    ]);
    expect(doc.cels.length).toBe(2);
    const colors = doc.cels.find((c) => c.layer === 'colors')!;
    const lines = doc.cels.find((c) => c.layer === 'lines')!;
    // The fill stays inside the outline (plus a little tucked under the ink).
    expect(colors.x).toBeGreaterThanOrEqual(21);
    expect(colors.x + colors.w).toBeLessThanOrEqual(107);
    const cImg = await decodePng(new Uint8Array(await colors.png.arrayBuffer()));
    expect(pixelAt(cImg, 64 - colors.x, 75 - colors.y)).toEqual([124, 201, 90, 255]);
    const lImg = await decodePng(new Uint8Array(await lines.png.arrayBuffer()));
    // An eye is filled solid ink; the ink ring is there on the left.
    expect(pixelAt(lImg, 53 - lines.x, 62 - lines.y)[3]).toBe(255);
    expect(pixelAt(lImg, 24 - lines.x, 70 - lines.y)[3]).toBeGreaterThan(200);
    expect(doc.palette[0]).toBe('#7cc95a');
    expect(doc.strokeLog).not.toBeNull();
  });

  it('is deterministic, and the stored log replays to the same pixels', async () => {
    const a = await replayArtScript(creature());
    const b = await replayArtScript(creature());
    for (let i = 0; i < a.cels.length; i++) {
      const pa = new Uint8Array(await a.cels[i].png.arrayBuffer());
      const pb = new Uint8Array(await b.cels[i].png.arrayBuffer());
      expect(Buffer.from(pa).equals(Buffer.from(pb))).toBe(true);
    }
    const log = await readLog(a);
    expect(log!.length).toBe(7);
    const board = await replayLog(log!);
    const fromDoc = await artDocToBoard(a);
    for (const id of ['colors', 'lines']) {
      const x = board.pixels('f1', id)!;
      const y = fromDoc.pixels('f1', id)!;
      expect(Buffer.from(x.buffer).equals(Buffer.from(y.buffer))).toBe(true);
    }
  });

  it('tapers ink strokes (thin ends, full middle)', async () => {
    const s: ArtScript = {
      v: 1,
      name: 'line',
      kind: 'item',
      width: 200,
      height: 60,
      layers: [{ id: 'lines', role: 'lines' }],
      // Pressure ramps in over the first few samples, as it does with a real pen.
      ops: [{ op: 'stroke', layer: 'lines', brush: 'ink', size: 10, color: '#000000', points: Array.from({ length: 41 }, (_, i) => [20 + i * 4, 30, Math.min(0.9, 0.25 + i * 0.13)] as [number, number, number]) }],
    };
    const board = await replayLog(scriptToLog(s));
    const d = board.pixels('f1', 'lines')!;
    const width = (x: number): number => {
      let n = 0;
      for (let y = 0; y < 60; y++) n += d[(y * 200 + x) * 4 + 3] / 255;
      return n;
    };
    const mid = width(100);
    expect(mid).toBeGreaterThan(8);
    let xa = 0;
    while (width(xa) < 0.3) xa++;
    let xb = 199;
    while (width(xb) < 0.3) xb--;
    expect(width(xa + 1)).toBeLessThan(mid * 0.4);
    expect(width(xb - 1)).toBeLessThan(mid * 0.4);
    // The stroke reaches its drawn ends (the filter lags, the finish line catches up).
    expect(xa).toBeLessThanOrEqual(20);
    expect(xb).toBeGreaterThanOrEqual(179);
  });

  it('serializes to one blob and back', async () => {
    const doc = await replayArtScript(creature());
    const bytes = await serializeArtDoc(doc);
    expect(bytes.length).toBeLessThan(40_000);
    const back = await deserializeArtDoc(bytes);
    expect(back.layers).toEqual(doc.layers);
    expect(back.frames).toEqual(doc.frames);
    expect(back.cels.map((c) => [c.layer, c.x, c.y, c.w, c.h])).toEqual(doc.cels.map((c) => [c.layer, c.x, c.y, c.w, c.h]));
    expect(back.strokeLog!.size).toBe(doc.strokeLog!.size);
    await expect(deserializeArtDoc(new Uint8Array([1, 2, 3, 4, 5]))).rejects.toThrow(/Not an Amble drawing/);
  });

  it('exports a trimmed flat with the feet anchor, parts and the ink mask', async () => {
    const doc = await replayArtScript(creature());
    const board = await artDocToBoard(doc);
    const ex = (await exportArt(board, { kind: 'character' }))!;
    const [x, y, w, h] = ex.box;
    expect(x).toBeGreaterThan(18);
    expect(y).toBeGreaterThan(24);
    expect(w).toBeLessThan(92);
    expect(h).toBeLessThan(92);
    // Feet anchor: the bottom of the drawing, near its middle.
    expect(ex.anchor[1]).toBe(h);
    expect(Math.abs(ex.anchor[0] - w / 2)).toBeLessThan(8);
    expect(ex.layers.map((l) => l.role)).toEqual(['colors', 'lines']);
    expect(ex.linesMask).not.toBeNull();
    expect([ex.linesMask!.w, ex.linesMask!.h]).toEqual([w, h]);
    const flat = await decodePng(new Uint8Array(await ex.flat.png.arrayBuffer()));
    expect(pixelAt(flat, 0, 0)[3]).toBe(0);
    const half = (await exportArt(board, { kind: 'character', maxSize: 40 }))!;
    expect(Math.max(half.flat.w, half.flat.h)).toBe(40);
    expect(half.anchor[1]).toBeCloseTo(half.flat.h, 0);
    const anchored = (await exportArt(board, { kind: 'character', anchor: [64, 100] }))!;
    expect(anchored.anchorBoard).toEqual([64, 100]);
  });
});
