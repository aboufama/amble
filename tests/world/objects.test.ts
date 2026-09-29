/** Change mode's tags, hit tests and landing spots from the runtime's objects reports (§2.7, §2.17). */
import { describe, expect, it } from 'vitest';
import type { WorldObject } from '../../src/cores/play';
import { boxOfKey, countsOf, hitTest, placeTag, sameObjects, tagsOf, toPage } from '../../src/world/objects';

function obj(id: number, key: string | null, over: Partial<WorldObject> = {}): WorldObject {
  return { id, key, label: key ?? 'thing', role: 'enemy', group: null, x: 0, y: 0, w: 40, h: 40, drawn: false, count: 1, ...over };
}

const report: WorldObject[] = [
  obj(1, 'boss', { role: 'boss', x: 560, y: 90, w: 220, h: 190 }),
  obj(2, 'grumble', { x: 600, y: 300, w: 46, h: 40, count: 2 }),
  obj(3, 'grumble', { x: 780, y: 400, w: 46, h: 40, count: 0 }),
  obj(4, 'hero', { role: 'hero', x: 110, y: 350, w: 36, h: 60, drawn: true }),
  obj(5, 'ground', { role: 'terrain', x: 0, y: 440, w: 880, h: 55, count: 1 }),
  obj(6, null, { role: 'scenery' }),
];

describe('tagsOf', () => {
  it('puts one tag per member on its first instance, with the count, and quiet tags on scenery', () => {
    const tags = tagsOf(report);
    expect(tags.map((t) => [t.key, t.count, t.tone])).toEqual([
      ['boss', 1, 'cast'],
      ['grumble', 2, 'cast'],
      ['hero', 1, 'cast'],
      ['ground', 1, 'scenery'],
    ]);
    expect(tags[1].box).toEqual({ x: 600, y: 300, w: 46, h: 40 });
  });
});

describe('hitTest', () => {
  it('finds the smallest thing under the point, and scenery only when nothing stands on it', () => {
    expect(hitTest(report, 620, 320)?.id).toBe(2);
    expect(hitTest(report, 700, 150)?.id).toBe(1);
    expect(hitTest(report, 300, 460)?.key).toBe('ground');
    expect(hitTest(report, 300, 200)).toBeNull();
  });
});

describe('boxes and counts', () => {
  it('knows where a member stands and how many play', () => {
    expect(boxOfKey(report, 'hero')).toEqual({ x: 110, y: 350, w: 36, h: 60 });
    expect(boxOfKey(report, 'sky')).toBeNull();
    expect(countsOf(report)).toEqual({ boss: 1, grumble: 2, hero: 1, ground: 1 });
    expect(toPage({ x: 10, y: 20, w: 5, h: 6 }, { left: 20, top: 66, width: 880, height: 495 })).toEqual({ x: 30, y: 86, w: 5, h: 6 });
  });

  it('keeps a tag inside the world view: above the thing, or below it at the top edge', () => {
    const frame = { width: 880, height: 495 };
    expect(placeTag({ x: 100, y: 200, w: 40, h: 40 }, 100, 30, frame)).toEqual({ x: 70, y: 162, below: false });
    expect(placeTag({ x: 850, y: 10, w: 20, h: 20 }, 100, 30, frame)).toEqual({ x: 774, y: 38, below: true });
    expect(placeTag({ x: 0, y: 300, w: 10, h: 10 }, 100, 30, frame).x).toBe(6);
  });
});

describe('sameObjects', () => {
  it("tells a frozen game's repeated report from one where something moved, changed or left", () => {
    const again = report.map((o) => ({ ...o }));
    expect(sameObjects(report, again)).toBe(true);
    expect(sameObjects(report, again.map((o) => (o.id === 2 ? { ...o, x: o.x + 1 } : o)))).toBe(false);
    expect(sameObjects(report, again.map((o) => (o.id === 4 ? { ...o, drawn: false } : o)))).toBe(false);
    expect(sameObjects(report, again.slice(1))).toBe(false);
    expect(sameObjects([], [])).toBe(true);
  });
});
