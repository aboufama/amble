/**
 * The simple palette's layout: a board of titled cards, where the blocks of each card flow in
 * rows like words in a paragraph, so that every block is on screen at once. The first cards span
 * the board; the others stand in columns under them.
 *
 * This file is geometry only (no Blockly): the palette measures its blocks, asks for the largest
 * layout that fits its width and height, and places them (src/blocks/workspaceUi.ts).
 */

export interface BoardItem {
  /** Size in block units (Blockly's workspace units: the size on screen is this times the scale). */
  width: number;
  height: number;
  /** Sits in the middle of its row's height (round blocks and buttons); other blocks hang from the top. */
  centred?: boolean;
  /** Starts a row, even when there is room left on the one before. */
  newRow?: boolean;
}

export interface BoardSection {
  /** The column its card stands in (0 is the left one), or null for a card across the top of the board. */
  column: number | null;
  /** Width its heading needs, in pixels. */
  headingWidth?: number;
  items: BoardItem[];
}

/** The board's chrome, in screen pixels (it keeps its size at every scale), and the gaps between blocks, in block units. */
export interface BoardStyle {
  /** Space around the board. */
  outer: number;
  /** Space between columns, and between cards one above the other. */
  columnGap: number;
  cardGap: number;
  /** Space inside a card: left and right of its blocks, above its heading, under its last row. */
  padX: number;
  padTop: number;
  padBottom: number;
  /** Height of a card's heading, with the space under it. */
  heading: number;
  /** Space between blocks in a row, and between rows (block units). */
  gapX: number;
  gapY: number;
}

/** The tightest the board gets. */
export const BOARD_STYLE: BoardStyle = { outer: 7, columnGap: 6, cardGap: 6, padX: 8, padTop: 6, padBottom: 7, heading: 21, gapX: 9, gapY: 8 };

/** With height to spare, rows and cards stand further apart: this much more at most, and steps towards it. */
const AIR: Pick<BoardStyle, 'cardGap' | 'padTop' | 'padBottom' | 'heading' | 'gapY'> = { cardGap: 4, padTop: 2, padBottom: 3, heading: 3, gapY: 6 };
const AIR_STEPS = 4;

function airy(style: BoardStyle, share: number): BoardStyle {
  return {
    ...style,
    cardGap: style.cardGap + AIR.cardGap * share,
    padTop: style.padTop + AIR.padTop * share,
    padBottom: style.padBottom + AIR.padBottom * share,
    heading: style.heading + AIR.heading * share,
    gapY: style.gapY + AIR.gapY * share,
  };
}

export interface PlacedSection {
  /** The card, in pixels from the board's top left corner. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** The top left corner of each item, in pixels. */
  items: Array<{ x: number; y: number }>;
}

export interface BoardLayout {
  scale: number;
  /** The style it was laid out with. */
  style: BoardStyle;
  /** Size of the laid out board, in pixels. */
  width: number;
  height: number;
  /** Every card is wide enough for its widest block (the height is the caller's to check). */
  fitsWidth: boolean;
  sections: PlacedSection[];
}

interface Row {
  y: number;
  height: number;
  items: Array<{ index: number; x: number }>;
}

/** Flows items into rows no wider than `width` (block units). A wider item gets a row to itself. */
function flow(items: BoardItem[], width: number, style: BoardStyle): { rows: Row[]; height: number } {
  const rows: Row[] = [];
  let row: Row | null = null;
  let x = 0;
  let y = 0;
  items.forEach((item, index) => {
    if (row && (item.newRow || x + style.gapX + item.width > width + 0.01)) {
      y += row.height + style.gapY;
      row = null;
    }
    if (!row) {
      row = { y, height: 0, items: [] };
      rows.push(row);
      x = 0;
    } else {
      x += style.gapX;
    }
    row.items.push({ index, x });
    row.height = Math.max(row.height, item.height);
    x += item.width;
  });
  const last = rows[rows.length - 1];
  return { rows, height: last ? last.y + last.height : 0 };
}

/** Stacks cards `width` pixels wide from (x, y) down. Returns the cards and where the next one would start. */
function stack(sections: BoardSection[], x: number, y: number, width: number, scale: number, style: BoardStyle): { placed: PlacedSection[]; bottom: number } {
  const placed: PlacedSection[] = [];
  for (const section of sections) {
    const { rows, height } = flow(section.items, (width - 2 * style.padX) / scale, style);
    const top = y + style.padTop + style.heading;
    const items: Array<{ x: number; y: number }> = [];
    for (const row of rows) {
      for (const { index, x: itemX } of row.items) {
        const item = section.items[index];
        const drop = item.centred ? (row.height - item.height) / 2 : 0;
        items[index] = { x: x + style.padX + itemX * scale, y: top + (row.y + drop) * scale };
      }
    }
    const cardHeight = style.padTop + style.heading + height * scale + style.padBottom;
    placed.push({ x, y, width, height: cardHeight, items });
    y += cardHeight + style.cardGap;
  }
  return { placed, bottom: y };
}

/** The width a stack of cards needs for its widest block (and its headings), in pixels. */
function widthNeeded(sections: BoardSection[], scale: number, style: BoardStyle): number {
  return 2 * style.padX + Math.max(0, ...sections.map((s) => Math.max(s.headingWidth ?? 0, ...s.items.map((i) => i.width * scale))));
}

/** How many ways of sharing the spare width between two columns are tried. */
const SPLITS = 24;

/**
 * The board at one scale, `width` pixels wide. Each column is at least as wide as its widest
 * block; the width left over goes where it makes the board shortest (blocks that share a row).
 * The columns end on one line: the last card of a shorter column is stretched down to it.
 */
export function layoutBoard(sections: BoardSection[], width: number, scale: number, style: BoardStyle = BOARD_STYLE): BoardLayout {
  const placed = new Map<BoardSection, PlacedSection>();
  const inner = width - 2 * style.outer;

  // The cards across the top.
  const across = sections.filter((s) => s.column === null);
  const top = stack(across, style.outer, style.outer, inner, scale, style);
  across.forEach((s, i) => placed.set(s, top.placed[i]));
  let fitsWidth = widthNeeded(across, scale, style) <= inner + 0.01;

  // The columns under them.
  const columns = [...new Set(sections.flatMap((s) => (s.column === null ? [] : [s.column])))].sort((a, b) => a - b);
  const inColumn = columns.map((c) => sections.filter((s) => s.column === c));
  const needs = inColumn.map((list) => widthNeeded(list, scale, style));
  const room = inner - style.columnGap * Math.max(0, columns.length - 1);
  const need = needs.reduce((a, b) => a + b, 0);
  const spare = room - need;
  if (spare < -0.01) fitsWidth = false;

  const build = (widths: number[]) => {
    let x = style.outer;
    return inColumn.map((list, c) => {
      const column = stack(list, x, top.bottom, widths[c], scale, style);
      x += widths[c] + style.columnGap;
      return column;
    });
  };
  const bottomOf = (built: ReturnType<typeof build>) => Math.max(top.bottom, ...built.map((column) => column.bottom));

  let widths: number[];
  if (spare < 0) {
    // Too narrow: every column gives way by the same share (its widest blocks stick out).
    widths = needs.map((n) => (n * room) / need);
  } else if (columns.length === 2) {
    // Try ways of sharing the spare width; keep the shortest board (the most even one on a tie).
    let best: { widths: number[]; bottom: number; lean: number } | null = null;
    for (let i = 0; i <= SPLITS; i++) {
      const share = i / SPLITS;
      const candidate = [needs[0] + spare * share, needs[1] + spare * (1 - share)];
      const bottom = bottomOf(build(candidate));
      const lean = Math.abs(share - 0.5);
      if (!best || bottom < best.bottom - 0.01 || (Math.abs(bottom - best.bottom) <= 0.01 && lean < best.lean)) best = { widths: candidate, bottom, lean };
    }
    widths = best!.widths;
  } else {
    widths = needs.map((n) => n + spare / Math.max(1, columns.length));
  }

  const built = build(widths);
  const bottom = bottomOf(built);
  built.forEach((column, c) => {
    inColumn[c].forEach((s, i) => placed.set(s, column.placed[i]));
    const last = column.placed[column.placed.length - 1];
    if (last) last.height += bottom - column.bottom;
  });
  return { scale, style, width, height: bottom - style.cardGap + style.outer, fitsWidth, sections: sections.map((s) => placed.get(s)!) };
}

export interface BoardScales {
  /** The largest scale to use (blocks at their normal size) and the smallest that still reads. */
  max: number;
  min: number;
  step: number;
}

/**
 * The board at the largest scale at which everything fits in `width` x `height` pixels, with as
 * much air between its rows and cards as the height allows. When nothing fits (a very small
 * window, or very many variables), the smallest scale: the palette then scrolls.
 */
export function fitBoard(sections: BoardSection[], width: number, height: number, scales: BoardScales, style: BoardStyle = BOARD_STYLE): BoardLayout & { fits: boolean } {
  for (let scale = scales.max; scale > scales.min - 1e-9; scale -= scales.step) {
    for (let air = AIR_STEPS; air >= 0; air--) {
      const layout = layoutBoard(sections, width, Math.max(scales.min, scale), airy(style, air / AIR_STEPS));
      if (!layout.fitsWidth) break;
      if (layout.height <= height + 0.01) return { ...layout, fits: true };
    }
  }
  return { ...layoutBoard(sections, width, scales.min, style), fits: false };
}
