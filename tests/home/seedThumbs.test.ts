/** Seed composites (§2.3, §2.5): the student's character placed in each world type's scene. */
import { describe, expect, it } from 'vitest';
import { alphaBox, FIRST_SEEDS, heroRect, heroRectPercent, HERO_SPOTS, SHEET_SEEDS } from '../../src/home/seedThumbs';

const POSE = { w: 120, h: 200, footX: 60, footY: 190 };

describe('seed thumbnails', () => {
  it('offers the five world types on the sheet and four on the First page', () => {
    expect(SHEET_SEEDS).toEqual(['moon-king', 'sky-run', 'clanks-climb', 'lantern-maze', 'wobble-tower']);
    expect(FIRST_SEEDS).toEqual(['moon-king', 'sky-run', 'clanks-climb', 'wobble-tower']);
    for (const s of SHEET_SEEDS) expect(HERO_SPOTS[s]).toBeDefined();
  });

  it("stands the character's feet on the spot, the height above its feet as the spot says", () => {
    const spot = { x: 0.25, y: 0.8, h: 0.5, maxW: 0.9 };
    const r = heroRect(spot, POSE, 320, 180);
    const scale = r.height / POSE.h;
    expect(r.left + POSE.footX * scale).toBeCloseTo(80, 6);
    expect(r.top + POSE.footY * scale).toBeCloseTo(144, 6);
    expect(POSE.footY * scale).toBeCloseTo(90, 6);
    expect(r.width / r.height).toBeCloseTo(POSE.w / POSE.h, 6);
  });

  it('narrows a wide drawing to the spot’s width', () => {
    const wide = { w: 600, h: 100, footX: 300, footY: 95 };
    const r = heroRect({ x: 0.5, y: 0.8, h: 0.5, maxW: 0.3 }, wide, 320, 180);
    expect(r.width).toBeCloseTo(96, 6);
    expect(r.top + wide.footY * (r.width / wide.w)).toBeCloseTo(144, 6);
  });

  it('gives the same place as percentages of any card', () => {
    const spot = HERO_SPOTS['moon-king'];
    const px = heroRect(spot, POSE, 320, 180);
    const pc = heroRectPercent(spot, POSE, 320 / 180);
    expect(pc.left).toBeCloseTo((px.left / 320) * 100, 6);
    expect(pc.top).toBeCloseTo((px.top / 180) * 100, 6);
    expect(pc.height).toBeCloseTo((px.height / 180) * 100, 6);
  });

  it("finds the drawing's pixels in a posed picture", () => {
    const w = 10;
    const h = 8;
    const data = new Uint8ClampedArray(w * h * 4);
    for (const [x, y] of [
      [2, 3],
      [7, 5],
      [4, 1],
    ])
      data[(y * w + x) * 4 + 3] = 255;
    expect(alphaBox(data, w, h)).toEqual({ x: 2, y: 1, w: 6, h: 5 });
    expect(alphaBox(new Uint8ClampedArray(w * h * 4), w, h)).toBeNull();
  });
});
