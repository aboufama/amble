/**
 * Flipbook moves (§7.12): pages packed into an atlas of at most 2048 px a side, the sheet that says where
 * each page sits (checked when it reaches the game), and `DrawnArt.frames` through the protocol.
 */
import { describe, expect, it } from 'vitest';
import { FLIPBOOK_ATLAS_MAX, parseFlipbookSheet, parseToPlayer } from '../../src/cores/play';
import { layoutAtlas } from '../../src/draw/flipbook';

const sheet = (o: Record<string, unknown> = {}) =>
  JSON.stringify({
    v: 1,
    w: 200,
    h: 300,
    anchor: [100, 290],
    frames: [
      { x: 0, y: 0, w: 180, h: 280, ox: 10, oy: 10, hold: 1 },
      { x: 182, y: 0, w: 190, h: 290, ox: 5, oy: 0, hold: 2 },
    ],
    ...o,
  });

describe('the flipbook atlas', () => {
  it('puts pages in rows, tallest first, without overlaps and inside the limit', () => {
    const sizes = [
      { w: 300, h: 200 },
      { w: 280, h: 260 },
      { w: 900, h: 240 },
      { w: 700, h: 100 },
      { w: 640, h: 220 },
    ];
    const got = layoutAtlas(sizes, 1024);
    expect(got).not.toBeNull();
    const rects = got!.rects.map((r, i) => ({ ...r, ...sizes[i] }));
    for (const a of rects) {
      expect(a.x + a.w).toBeLessThanOrEqual(got!.w);
      expect(a.y + a.h).toBeLessThanOrEqual(got!.h);
      expect(got!.w).toBeLessThanOrEqual(1024);
      for (const b of rects) {
        if (a === b) continue;
        const apart = a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y;
        expect(apart).toBe(true);
      }
    }
  });

  it('says when pages cannot fit', () => {
    expect(layoutAtlas([{ w: FLIPBOOK_ATLAS_MAX + 1, h: 10 }])).toBeNull();
    expect(layoutAtlas(Array.from({ length: 24 }, () => ({ w: 1000, h: 1000 })))).toBeNull();
    expect(layoutAtlas(Array.from({ length: 12 }, () => ({ w: 400, h: 500 })))).not.toBeNull();
  });
});

describe('the flipbook sheet', () => {
  it('reads a good sheet and keeps holds between 1 and 8', () => {
    const s = parseFlipbookSheet(sheet({ frames: [{ x: 0, y: 0, w: 10, h: 10, ox: 0, oy: 0, hold: 0 }, { x: 12, y: 0, w: 10, h: 10, ox: 0, oy: 0, hold: 40 }], k: 0.5 }));
    expect(s?.frames.map((f) => f.hold)).toEqual([1, 8]);
    expect(s?.k).toBe(0.5);
    expect(s?.anchor).toEqual([100, 290]);
  });

  it('turns away sheets that are not one', () => {
    expect(parseFlipbookSheet('not json')).toBeNull();
    expect(parseFlipbookSheet(sheet({ v: 2 }))).toBeNull();
    expect(parseFlipbookSheet(sheet({ frames: [{ x: 0, y: 0, w: 10, h: 10, ox: 0, oy: 0, hold: 1 }] }))).toBeNull();
    expect(parseFlipbookSheet(sheet({ frames: [{ x: 2040, y: 0, w: 20, h: 10, ox: 0, oy: 0, hold: 1 }, { x: 0, y: 0, w: 1, h: 1, ox: 0, oy: 0, hold: 1 }] }))).toBeNull();
    expect(parseFlipbookSheet(sheet({ anchor: 'feet' }))).toBeNull();
    expect(parseFlipbookSheet('x'.repeat(30_000))).toBeNull();
  });

  it('travels as DrawnArt.frames, and a broken one is left out', () => {
    const atlas = 'data:image/png;base64,iVBORw0KGgo=';
    const good = parseToPlayer({ type: 'art', art: { key: 'hero', image: atlas, frames: { atlas, json: sheet(), move: 'attack', fps: 40 } } });
    expect(good).toMatchObject({ type: 'art', art: { key: 'hero', frames: { move: 'attack', fps: 30 } } });
    const bad = parseToPlayer({ type: 'art', art: { key: 'hero', image: atlas, frames: { atlas, json: sheet(), move: 'at tack!', fps: 8 } } });
    expect(bad).toMatchObject({ type: 'art', art: { key: 'hero' } });
    expect((bad as { art: { frames?: unknown } }).art.frames).toBeUndefined();
  });
});
