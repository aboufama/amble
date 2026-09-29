/**
 * The Desk's model (§2.10, §7.3): boards sized by the request, part pairs and tool routing, the request
 * note's facts, colour names, paper removal, and the previews' rig transform.
 */
import { describe, expect, it } from 'vitest';
import { boardFor, freeBoard, GROUND } from '../../src/draw/boards';
import { colorId, hexToHsv, hsvToHex, luminance, normalizeHex, NAMED_COLORS } from '../../src/draw/colorNames';
import { KID_SWATCHES, pushRecent, SKIN_TONES, worldColors } from '../../src/draw/palette';
import { bonesLayout, compositePair, FREEHAND_PAIR, inkUnion, mirrorMatrix, nextExtra, otherSide, pairIds, partOfLayer, targetLayer } from '../../src/draw/parts';
import { levels, removePaper } from '../../src/draw/photo';
import { placeCallout } from '../../src/draw/guides';
import { hintsOnExport, rigOnExport } from '../../src/draw/preview';
import { factText, freeRequest, requestFacts, timesTall, type DeskRequest } from '../../src/draw/request';
import { templateFor } from '../../src/cores/rig';
import { t } from '../../src/i18n';

function request(o: Partial<DeskRequest>): DeskRequest {
  return { ...freeRequest('Moon King'), worldId: 'w_1', key: 'boss', ...o };
}

describe('boards (§7.3)', () => {
  it('sizes a walker to its shape with a 30 % margin and a ground line at 88 %', () => {
    const b = boardFor({ kind: 'character', role: 'hero', w: 40, h: 64, key: 'hero' });
    expect(Math.max(b.w, b.h)).toBe(1024);
    expect(b.h).toBe(1024);
    // (40 + 19.2) / (64 + 19.2) of the long side
    expect(b.w).toBe(Math.round(1024 * (59.2 / 83.2)));
    expect(b.groundY).toBe(Math.round(1024 * GROUND));
    expect(b.exportMax).toBeLessThanOrEqual(512);
    expect(b.pixelArt).toBe(false);
  });

  it('gives bosses and big characters a 1536 board and a bigger export', () => {
    const boss = boardFor({ kind: 'character', role: 'boss', w: 220, h: 190, key: 'boss' });
    expect(Math.max(boss.w, boss.h)).toBe(1536);
    expect(boss.kind).toBe('bigCharacter');
    expect(boss.exportMax).toBeLessThanOrEqual(1024);
    const tall = boardFor({ kind: 'character', role: 'enemy', w: 60, h: 130, key: 'giant' });
    expect(Math.max(tall.w, tall.h)).toBe(1536);
  });

  it('keeps boards between 1:2 and 2:1', () => {
    const snake = boardFor({ kind: 'character', role: 'enemy', w: 300, h: 20, key: 'snake' });
    expect(snake.w / snake.h).toBeLessThanOrEqual(2.001);
  });

  it('draws items, props and shots on 512 squares', () => {
    for (const kind of ['item', 'prop', 'projectile', 'decor'] as const) {
      const b = boardFor({ kind, role: null, w: 26, h: 10, key: 'shot' });
      expect([b.w, b.h, b.kind]).toEqual([512, 512, 'thing']);
      expect(b.exportMax).toBeLessThanOrEqual(256);
    }
  });

  it('draws platforms on 1024 x 256 and ground strips on 1536 x 256', () => {
    const ledge = boardFor({ kind: 'terrain', role: 'terrain', w: 32, h: 16, key: 'ledge' });
    expect([ledge.w, ledge.h, ledge.kind]).toEqual([1024, 256, 'platform']);
    const ground = boardFor({ kind: 'terrain', role: 'terrain', w: 32, h: 32, key: 'ground' });
    expect([ground.w, ground.h, ground.kind]).toEqual([1536, 256, 'terrain']);
  });

  it('draws backgrounds at 1920 x 1080 with a ground line, and free drawings on 1024 squares', () => {
    const bg = boardFor({ kind: 'background', role: 'background', w: 960, h: 540, key: 'sky' });
    expect([bg.w, bg.h, bg.exportMax]).toEqual([1920, 1080, 1920]);
    expect(bg.groundY).not.toBeNull();
    const free = freeBoard();
    expect([free.w, free.h, free.pixelArt]).toEqual([1024, 1024, false]);
    const px = freeBoard('pixel32');
    expect([px.w, px.h, px.pixelArt, px.exportMax]).toEqual([32, 32, true, 32]);
  });
});

describe('parts on layers (§7.3)', () => {
  it('pairs each part: its colours under its lines, far limbs first', () => {
    const b = bonesLayout('biped', 0);
    expect(Object.keys(b.parts).sort()).toEqual(['armL', 'armR', 'head', 'legL', 'legR', 'torso']);
    expect(b.parts.head).toEqual({ colors: 'head', lines: 'head-lines' });
    const ids = b.layers.map((l) => l.id);
    for (const [name, p] of Object.entries(b.parts)) {
      expect(ids.indexOf(p.lines)).toBe(ids.indexOf(p.colors) + 1);
      expect(b.layers[ids.indexOf(p.colors)].role).toBe(`part:${name}`);
      expect(b.layers[ids.indexOf(p.lines)].role).toBe('lines');
    }
    expect(b.steps.map((s) => s.step)).toEqual(['body', 'head', 'arms', 'legs', 'extras']);
    expect(b.layers.length).toBeLessThanOrEqual(16);
  });

  it('routes ink tools to the lines and colouring tools to the colours under them', () => {
    const pair = pairIds('armL');
    for (const tool of ['ink', 'pencil', 'shapes', 'pixel'] as const) expect(targetLayer(tool, pair, null)).toBe('armL-lines');
    for (const tool of ['fill', 'lassofill', 'marker', 'crayon', 'airbrush'] as const) expect(targetLayer(tool, pair, null)).toBe('armL');
    expect(targetLayer('eraser', pair, 'armL')).toBe('armL');
    expect(targetLayer('eraser', pair, null)).toBe('armL-lines');
    expect(targetLayer('fill', FREEHAND_PAIR, null)).toBe('colors');
    expect(targetLayer('ink', FREEHAND_PAIR, null)).toBe('lines');
  });

  it('finds a layer’s part, the other side, and room for extras', () => {
    const parts = bonesLayout('biped', 0).parts;
    expect(partOfLayer(parts, 'legR-lines')).toBe('legR');
    expect(partOfLayer(parts, 'lines')).toBeNull();
    expect(otherSide('armL')).toBe('armR');
    expect(otherSide('wingR')).toBe('wingL');
    expect(otherSide('head')).toBeNull();
    expect(nextExtra(parts, 12)).toBe('extra1');
    expect(nextExtra({ ...parts, extra1: pairIds('extra1') }, 14)).toBe('extra2');
    expect(nextExtra(parts, 15)).toBeNull();
  });

  it('mirrors about the spine for figures that face you, and shifts for side views', () => {
    expect(mirrorMatrix([100, 50], [300, 50], 200, true)).toEqual([-1, 0, 0, 1, 400, 0]);
    expect(mirrorMatrix([100, 50], [120, 60], 200, false)).toEqual([1, 0, 0, 1, 20, 10]);
  });

  it('composites a part lines-over-colours, and unions the lines into one ink mask', () => {
    const W = 2;
    const H = 1;
    const colors = new Uint8ClampedArray([255, 0, 0, 255, 0, 0, 255, 255]);
    const lines = new Uint8ClampedArray([0, 0, 0, 255, 0, 0, 0, 0]);
    const out = compositePair(colors, lines, W, H);
    expect([...out.slice(0, 4)]).toEqual([0, 0, 0, 255]);
    expect([...out.slice(4, 8)]).toEqual([0, 0, 255, 255]);
    const mask = inkUnion([lines, new Uint8ClampedArray([0, 0, 0, 0, 9, 9, 9, 128])], W, H);
    expect([mask[3], mask[7]]).toEqual([255, 128]);
  });
});

describe('the request note (§2.10)', () => {
  const pip = { key: 'hero', name: 'Pip', w: 40, h: 64, rig: 'biped' as const };

  it('says big and round, which way, how big and how it moves', () => {
    const r = request({ kind: 'character', rig: 'blob', role: 'boss', shape: 'ellipse', facing: 'left', w: 220, h: 190, hero: pip });
    expect(requestFacts(r).map(factText)).toEqual(['Big and round', 'Faces left, at Pip', '3× as tall as Pip', 'Moves like a blob']);
  });

  it('puts sizes in kid numbers', () => {
    expect(timesTall(190, 64)).toBe('3');
    expect(timesTall(100, 64)).toBe('1½');
    expect(timesTall(64, 64)).toBeNull();
    expect(timesTall(30, 64)).toBe('half');
    expect(timesTall(50, 64)).toBe('small');
    const same = request({ kind: 'character', rig: 'biped', role: 'npc', facing: 'viewer', w: 40, h: 60, hero: pip });
    expect(requestFacts(same).map(factText)).toContain('As tall as Pip');
    expect(requestFacts(same).map(factText)).toContain('Looks at you');
  });

  it('keeps every fact short and free of banned words', () => {
    for (const rig of ['biped', 'quadruped', 'blob', 'flyer', 'swimmer', 'object'] as const) {
      const text = factText({ key: 'moves', vars: { rig } });
      expect(text.split(' ').length).toBeLessThanOrEqual(15);
      expect(text).not.toMatch(/\bdraft|\bsprite|\basset\b/i);
    }
  });
});

describe('colours with names (§2.10)', () => {
  it('names every named colour by itself and near colours by their neighbour', () => {
    for (const [hex, id] of NAMED_COLORS) expect(colorId(hex)).toBe(id);
    expect(colorId('#fe6246')).toBe(colorId('#ff6347'));
    expect(t(`draw.color_${colorId('#ffffff')}`)).toMatch(/white/i);
  });

  it('gives each kid swatch and skin tone a name', () => {
    for (const c of [...KID_SWATCHES, ...SKIN_TONES]) expect(t(`draw.color_${colorId(c)}`)).not.toMatch(/^draw\./);
    expect(KID_SWATCHES).toHaveLength(18);
    expect(SKIN_TONES).toHaveLength(9);
  });

  it('reads colour codes and round-trips HSV', () => {
    expect(normalizeHex('#ABC')).toBe('#aabbcc');
    expect(normalizeHex('f6e7a4')).toBe('#f6e7a4');
    expect(normalizeHex('nope')).toBeNull();
    for (const c of ['#f6e7a4', '#221b2e', '#4f8bff', '#ffffff']) {
      const { h, s, v } = hexToHsv(c);
      expect(hsvToHex(h, s, v)).toBe(c);
    }
    expect(luminance('#ffffff')).toBeCloseTo(1, 3);
    expect(luminance('#000000')).toBe(0);
  });

  it('collects "From your world" without near twins, ink or the box’s own colours', () => {
    const got = worldColors([
      ['#6a4cff', '#6b4dff', '#221b2e', '#e5484d'],
      ['#6a4cff', '#33c2a0'],
    ]);
    expect(got[0]).toBe('#6a4cff');
    expect(got).toContain('#33c2a0');
    expect(got).not.toContain('#6b4dff');
    expect(got).not.toContain('#221b2e');
    expect(got).not.toContain('#e5484d');
    expect(pushRecent(['#111111', '#222222'], '#222222')).toEqual(['#222222', '#111111']);
  });
});

describe('a photo of a paper drawing (§2.10)', () => {
  /** A grey, shadowed page with a dark line down the middle. */
  function page(W: number, H: number): Uint8ClampedArray {
    const px = new Uint8ClampedArray(W * H * 4);
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4;
        const shade = 190 - Math.round((x / W) * 30); // the page, greyer to one side
        const ink = Math.abs(x - W / 2) <= 2 ? 40 : shade;
        px[i] = px[i + 1] = px[i + 2] = ink;
        px[i + 3] = 255;
      }
    return px;
  }

  it('stretches the photo’s own range', () => {
    const { lo, hi } = levels(page(40, 20), 40, 20);
    expect(lo).toBeLessThan(0.3);
    expect(hi).toBeGreaterThan(0.6);
  });

  it('takes the paper out and keeps the ink solid, with a soft edge', () => {
    const W = 40;
    const H = 20;
    const out = removePaper(page(W, H), W, H);
    const a = (x: number, y: number) => out[(y * W + x) * 4 + 3];
    expect(a(2, 10)).toBe(0);
    expect(a(37, 10)).toBe(0);
    expect(a(20, 10)).toBe(255);
    // The edge feathers over about 2 px.
    expect(a(23, 10)).toBeGreaterThan(0);
    expect(a(23, 10)).toBeLessThan(255);
    expect(a(26, 10)).toBe(0);
    // Transparent pixels carry no colour.
    expect([...out.slice(0, 4)]).toEqual([0, 0, 0, 0]);
  });
});

describe('the previews’ bones', () => {
  it('moves a board rig into the export’s pixels', () => {
    const rig = templateFor('biped', 200, 400, 0);
    const moved = rigOnExport(rig, [100, 50, 300, 500], 0.5);
    expect(moved.anchor).toEqual([(rig.anchor[0] - 100) * 0.5, (rig.anchor[1] - 50) * 0.5]);
    expect(moved.bones[3].x2).toBeCloseTo((rig.bones[3].x2 - 100) * 0.5);
    expect(moved.bones.length).toBe(rig.bones.length);
    expect(hintsOnExport({ head: [120, 70] }, [100, 50, 300, 500], 2)).toEqual({ head: [40, 40] });
  });
});

describe('the on-the-bones callout (§2.10)', () => {
  const inside = (p: { x: number; y: number }, box: { w: number; h: number }, board: { w: number; h: number }, u: number) =>
    p.x >= 8 * u - 1e-9 && p.x + box.w <= board.w - 8 * u + 1e-9 && p.y >= 8 * u - 1e-9 && p.y + box.h <= board.h - 8 * u + 1e-9;

  it('sits beside the bone when there is room', () => {
    const board = { w: 1024, h: 1024 };
    const p = placeCallout({ x: 300, y: 400 }, { w: 300, h: 40 }, board, 1.65);
    expect(p.beside).toBe(true);
    expect(p.x).toBeGreaterThan(300);
    expect(inside(p, { w: 300, h: 40 }, board, 1.65)).toBe(true);
  });

  it('stays whole on a narrow board (a tall hero): above the tip, never cut off at the edge', () => {
    // Pip's board is 729 x 1024; the callout is wider than either side of the spine.
    const board = { w: 729, h: 1024 };
    const u = 1024 / 620;
    const box = { w: 420, h: 48 };
    const tip = { x: 364, y: 330 };
    const p = placeCallout(tip, box, board, u);
    expect(inside(p, box, board, u)).toBe(true);
    expect(p.beside).toBe(false);
    expect(p.y + box.h).toBeLessThanOrEqual(tip.y);
  });
});
