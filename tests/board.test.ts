import { describe, expect, it } from 'vitest';
import { BOARD_STYLE, fitBoard, layoutBoard, type BoardItem, type BoardLayout, type BoardSection, type BoardStyle } from '../src/blocks/board';

/** A style with round numbers, so that the answers can be worked out by hand. */
const STYLE: BoardStyle = { outer: 10, columnGap: 10, cardGap: 10, padX: 10, padTop: 5, padBottom: 5, heading: 20, gapX: 10, gapY: 10 };

const item = (width: number, height: number, more: Partial<BoardItem> = {}): BoardItem => ({ width, height, ...more });

interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Where every item ended up on screen (pixels). */
function boxes(sections: BoardSection[], layout: BoardLayout): Box[] {
  return sections.flatMap((s, i) =>
    s.items.map((it, j) => {
      const at = layout.sections[i].items[j];
      return { left: at.x, top: at.y, right: at.x + it.width * layout.scale, bottom: at.y + it.height * layout.scale };
    }),
  );
}

const overlap = (a: Box, b: Box) => a.left < b.right - 0.01 && b.left < a.right - 0.01 && a.top < b.bottom - 0.01 && b.top < a.bottom - 0.01;

/** Pairs of items that lie over each other, and items that stick out of their card. */
function problems(sections: BoardSection[], layout: BoardLayout): string[] {
  const out: string[] = [];
  const all = boxes(sections, layout);
  all.forEach((a, i) => all.forEach((b, j) => i < j && overlap(a, b) && out.push(`items ${i} and ${j} overlap`)));
  let n = 0;
  sections.forEach((s, i) => {
    const card = layout.sections[i];
    for (const _ of s.items) {
      const b = all[n++];
      if (b.left < card.x - 0.01 || b.right > card.x + card.width + 0.01 || b.top < card.y - 0.01 || b.bottom > card.y + card.height + 0.01) out.push(`item ${n - 1} sticks out of card ${i}`);
    }
  });
  layout.sections.forEach((a, i) =>
    layout.sections.forEach((b, j) => {
      if (i < j && overlap({ left: a.x, top: a.y, right: a.x + a.width, bottom: a.y + a.height }, { left: b.x, top: b.y, right: b.x + b.width, bottom: b.y + b.height })) out.push(`cards ${i} and ${j} overlap`);
    }),
  );
  return out;
}

describe('the board (the simple palette laid out)', () => {
  it('flows blocks in rows like words, and starts a row when one is full', () => {
    // One card, 300 wide at scale 1: 10 outside and 10 inside on each side leave 260 for blocks.
    const sections: BoardSection[] = [{ column: 0, items: [item(100, 40), item(100, 40), item(100, 40)] }];
    const layout = layoutBoard(sections, 300, 1, STYLE);
    // The first two share a row (100 + 10 + 100); the third starts the next, a gap under.
    expect(layout.sections[0].items).toEqual([
      { x: 20, y: 35 },
      { x: 130, y: 35 },
      { x: 20, y: 85 },
    ]);
    // The card: heading (5 + 20), two rows of 40 with 10 between, 5 under. The board: 10 around it.
    expect(layout.sections[0]).toMatchObject({ x: 10, y: 10, width: 280, height: 120 });
    expect(layout.height).toBe(140);
    expect(layout.fitsWidth).toBe(true);
  });

  it('keeps its chrome the same size at every scale: only the blocks shrink', () => {
    const sections: BoardSection[] = [{ column: 0, items: [item(100, 40), item(100, 40), item(100, 40)] }];
    const layout = layoutBoard(sections, 300, 0.5, STYLE);
    // At half size all three share the row: 50 wide each, 5 apart.
    expect(layout.sections[0].items).toEqual([
      { x: 20, y: 35 },
      { x: 75, y: 35 },
      { x: 130, y: 35 },
    ]);
    expect(layout.sections[0].height).toBe(5 + 20 + 20 + 5);
  });

  it('starts a row where it is told to, and centres round blocks in a taller row', () => {
    const sections: BoardSection[] = [{ column: 0, items: [item(60, 100), item(60, 40, { centred: true }), item(60, 40, { newRow: true })] }];
    const layout = layoutBoard(sections, 300, 1, STYLE);
    expect(layout.sections[0].items).toEqual([
      { x: 20, y: 35 },
      { x: 90, y: 65 },
      { x: 20, y: 145 },
    ]);
  });

  it('gives each column at least its widest block, and the spare width to where it saves rows', () => {
    // Left: one block of 100. Right: two of 120 that share a row when the column has 250 for them.
    const sections: BoardSection[] = [
      { column: 0, items: [item(100, 40)] },
      { column: 1, items: [item(120, 40), item(120, 40)] },
    ];
    // Needs: 100 + 20 and 120 + 20; with 10 around and 10 between, a 420 board has 130 to spare.
    const layout = layoutBoard(sections, 420, 1, STYLE);
    const [left, right] = layout.sections;
    expect(left.width).toBeGreaterThanOrEqual(120);
    expect(right.width).toBeGreaterThanOrEqual(270);
    expect(left.width + right.width).toBeCloseTo(390, 5);
    expect(right.items[0].y).toBe(right.items[1].y);
    expect(layout.height).toBe(10 + 5 + 20 + 40 + 5 + 10);
    // Too narrow for both columns' widest blocks: it says so.
    expect(layoutBoard(sections, 280, 1, STYLE).fitsWidth).toBe(false);
    expect(layoutBoard(sections, 290, 1, STYLE).fitsWidth).toBe(true);
  });

  it('lays a card across the top, the columns under it, ending on one line', () => {
    const sections: BoardSection[] = [
      { column: null, items: [item(150, 40), item(150, 40)] },
      { column: 0, items: [item(100, 40), item(100, 40), item(100, 40)] },
      { column: 1, items: [item(100, 40)] },
      { column: 1, items: [item(100, 40)] },
    ];
    const layout = layoutBoard(sections, 400, 1, STYLE);
    const [top, left, rightA, rightB] = layout.sections;
    expect(top).toMatchObject({ x: 10, y: 10, width: 380, height: 70 });
    expect(top.items[0].y).toBe(top.items[1].y);
    // Under it, a gap down.
    expect(left.y).toBe(90);
    expect(rightA.y).toBe(90);
    expect(left.x).toBe(10);
    expect(rightA.x).toBeCloseTo(left.x + left.width + 10, 5);
    expect(rightB.y).toBeCloseTo(rightA.y + rightA.height + 10, 5);
    // Both columns end together (the shorter one's last card is stretched), 10 above the board's end.
    expect(left.y + left.height).toBeCloseTo(rightB.y + rightB.height, 5);
    expect(layout.height).toBeCloseTo(left.y + left.height + 10, 5);
    expect(problems(sections, layout)).toEqual([]);
  });

  it('fits: the largest scale at which the board is no taller than the palette', () => {
    const sections: BoardSection[] = [{ column: 0, items: Array.from({ length: 6 }, () => item(200, 50)) }];
    const scales = { max: 1, min: 0.5, step: 0.05 };
    // Roomy: full size, with air between the rows.
    const roomy = fitBoard(sections, 260, 1000, scales, STYLE);
    expect(roomy).toMatchObject({ fits: true, scale: 1 });
    expect(roomy.style.gapY).toBeGreaterThan(STYLE.gapY);
    expect(roomy.height).toBeLessThanOrEqual(1000);
    // Six rows of 50 with 10 between and 50 of chrome is 400 at full size: tight, but it fits.
    expect(fitBoard(sections, 260, 400, scales, STYLE)).toMatchObject({ fits: true, scale: 1, height: 400 });
    // 5 pixels less, and it takes a smaller scale.
    const smaller = fitBoard(sections, 260, 395, scales, STYLE);
    expect(smaller.fits).toBe(true);
    expect(smaller.scale).toBeCloseTo(0.95, 5);
    expect(smaller.height).toBeLessThanOrEqual(395);
    // Too narrow for a block at full size: the width decides the scale.
    const narrow = fitBoard(sections, 200, 1000, scales, STYLE);
    expect(narrow.fits).toBe(true);
    expect(narrow.scale).toBeCloseTo(0.8, 5);
    // No scale fits: the smallest, and the palette scrolls.
    expect(fitBoard(sections, 260, 100, scales, STYLE)).toMatchObject({ fits: false, scale: 0.5 });
  });
});

// -----------------------------------------------------------------------------
// The real palette: the sizes Blockly measures for its blocks in Chromium (block units), at the
// size the palette has in a 1280 x 720 window. (The browser check is e2e/start.spec.ts.)
// -----------------------------------------------------------------------------

const stack = (width: number, height = 56) => item(width, height);
const hat = (width: number) => item(width, 73);
const round = (width: number, height = 40) => item(width, height, { centred: true });
const row = (first: BoardItem, ...rest: BoardItem[]) => [{ ...first, newRow: true }, ...rest];

const REMEMBER: BoardItem[] = [round(154, 38), round(113), ...row(stack(252, 57)), ...row(stack(281, 57)), ...row(stack(274, 57))];

const SPRITE: BoardSection[] = [
  { column: null, headingWidth: 128, items: [item(257, 48), item(238, 48)] },
  { column: 0, headingWidth: 60, items: [hat(153), hat(250), hat(145), hat(224), hat(182)] },
  { column: 0, headingWidth: 60, items: [round(195), ...row(round(225, 59)), ...row(round(245)), ...row(round(233, 41)), ...row(round(184, 41))] },
  {
    column: 1,
    headingWidth: 40,
    items: [stack(211), ...row(stack(351, 57)), ...row(stack(315, 57)), ...row(stack(133), stack(60), stack(60)), ...row(stack(274)), ...row(stack(190), stack(170)), ...row(stack(160, 104), stack(160, 112))],
  },
  { column: 1, headingWidth: 90, items: REMEMBER },
];

const STAGE: BoardSection[] = [
  { column: null, headingWidth: 128, items: [item(282, 67), item(301, 67), item(243, 48)] },
  { column: 0, headingWidth: 60, items: [hat(153), hat(250), hat(210), hat(182)] },
  { column: 0, headingWidth: 60, items: [round(195), ...row(round(225, 59)), ...row(round(233, 41)), ...row(round(184, 41))] },
  { column: 1, headingWidth: 40, items: [stack(211), ...row(stack(182), stack(170)), ...row(stack(160, 104), stack(160, 112))] },
  { column: 1, headingWidth: 90, items: REMEMBER },
];

describe('the simple palette on one screen', () => {
  const scales = { max: 0.675, min: 0.5, step: 0.005 };

  it.each([
    ['a sprite', SPRITE, 0.58],
    ['the stage', STAGE, 0.62],
  ])('shows every block of %s in a 1280 x 720 window, at a size that reads', (_, sections, readable) => {
    // The palette there: 54% of the 780 pixel editor, and its 626 pixels less the switch's strip.
    const layout = fitBoard(sections, 421, 592, scales);
    expect(layout.fits).toBe(true);
    expect(layout.height).toBeLessThanOrEqual(592);
    expect(layout.scale).toBeGreaterThanOrEqual(readable);
    expect(problems(sections, layout)).toEqual([]);
    for (const b of boxes(sections, layout)) {
      expect(b.left).toBeGreaterThanOrEqual(BOARD_STYLE.outer);
      expect(b.right).toBeLessThanOrEqual(421 - BOARD_STYLE.outer);
      expect(b.bottom).toBeLessThanOrEqual(592 - BOARD_STYLE.outer);
    }
  });

  it.each([
    ['a sprite', SPRITE],
    ['the stage', STAGE],
  ])('shows the blocks of %s at their normal size in a 1440 x 900 window', (_, sections) => {
    const layout = fitBoard(sections, 470, 772, scales);
    expect(layout).toMatchObject({ fits: true, scale: 0.675 });
    expect(problems(sections, layout)).toEqual([]);
  });

  it('shrinks to make room for more variables before it scrolls', () => {
    const many: BoardSection[] = SPRITE.map((s, i) => (i === SPRITE.length - 1 ? { ...s, items: [REMEMBER[0], ...Array.from({ length: 8 }, () => round(130)), ...REMEMBER.slice(2)] } : s));
    const layout = fitBoard(many, 421, 592, scales);
    expect(layout.fits).toBe(true);
    expect(layout.scale).toBeLessThan(fitBoard(SPRITE, 421, 592, scales).scale);
    expect(problems(many, layout)).toEqual([]);
  });
});
