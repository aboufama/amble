/**
 * Boards (§7.3): the paper a drawing is made on, sized by what the game asked for, and how big its export
 * is. Characters get a long side of 1024 (1536 for bosses and big or huge ones), the request's shape plus
 * a 30 % margin, and a ground line at 88 % of the height; items and props a 512 square; platforms and
 * ground strips long thin boards; backgrounds 1920 x 1080; free drawings 1024 square.
 */
import type { DeskRequest } from './request';
import { HERO_H } from './request';

export type BoardKind = 'character' | 'bigCharacter' | 'thing' | 'platform' | 'terrain' | 'background' | 'free' | 'pixel';

export interface BoardSpec {
  kind: BoardKind;
  w: number;
  h: number;
  pixelArt: boolean;
  /** The ground line's y on the board (characters and backgrounds), or null. */
  groundY: number | null;
  /** The longest side of the exported picture, px. */
  exportMax: number;
  /** Board px per in-game px (for the scale ghost and the export size). */
  perGamePx: number;
}

/** Where a character stands, as a share of the board's height. */
export const GROUND = 0.88;
/** How much of the board's height a character's own height takes (from the ground up). */
const FIGURE = 0.78;

/** The board for a request. */
export function boardFor(r: Pick<DeskRequest, 'kind' | 'role' | 'w' | 'h' | 'key'>): BoardSpec {
  const w = Math.max(1, r.w);
  const h = Math.max(1, r.h);
  switch (r.kind) {
    case 'background':
      return { kind: 'background', w: 1920, h: 1080, pixelArt: false, groundY: Math.round(1080 * 0.82), exportMax: 1920, perGamePx: 1920 / Math.max(w, 960) };
    case 'terrain': {
      const platform = /ledge|platform|step|shelf/i.test(r.key ?? '') || w >= h * 1.6;
      const W = platform ? 1024 : 1536;
      // Twice the in-game height, the strip's shape kept (the game tiles it sideways).
      return { kind: platform ? 'platform' : 'terrain', w: W, h: 256, pixelArt: false, groundY: null, exportMax: Math.min(1024, Math.max(64, Math.round(2 * h * (W / 256)))), perGamePx: 256 / h };
    }
    case 'character': {
      const big = r.role === 'boss' || h >= HERO_H * 1.8;
      const long = big ? 1536 : 1024;
      // The request's box plus a 30 % margin, as a board of that shape (kept between 1:2 and 2:1).
      const m = 0.3 * Math.max(w, h);
      const aspect = Math.min(2, Math.max(0.5, (w + m) / (h + m)));
      const W = aspect >= 1 ? long : Math.round(long * aspect);
      const H = aspect >= 1 ? Math.round(long / aspect) : long;
      const perGamePx = (H * FIGURE) / h;
      return { kind: big ? 'bigCharacter' : 'character', w: W, h: H, pixelArt: false, groundY: Math.round(H * GROUND), exportMax: Math.min(big ? 1024 : 512, Math.max(128, Math.round(2 * Math.max(w, h)))), perGamePx };
    }
    default: {
      // Items, props, shots and decorations: a square, the thing centred.
      return { kind: 'thing', w: 512, h: 512, pixelArt: false, groundY: null, exportMax: Math.min(256, Math.max(64, Math.round(2 * Math.max(w, h)))), perGamePx: (512 * 0.7) / Math.max(w, h) };
    }
  }
}

/** A free drawing's board (⋯ → Board size offers the others). */
export function freeBoard(size: 'square' | 'tall' | 'wide' | 'pixel16' | 'pixel32' | 'pixel64' | 'pixel128' = 'square'): BoardSpec {
  if (size.startsWith('pixel')) {
    const n = Number(size.slice(5));
    return { kind: 'pixel', w: n, h: n, pixelArt: true, groundY: null, exportMax: n, perGamePx: 1 };
  }
  const w = size === 'wide' ? 1536 : size === 'tall' ? 768 : 1024;
  const h = size === 'tall' ? 1280 : size === 'wide' ? 864 : 1024;
  return { kind: 'free', w, h, pixelArt: false, groundY: Math.round(h * GROUND), exportMax: 512, perGamePx: (h * FIGURE) / HERO_H };
}

/**
 * The request's board at the size a drawing was made (a starter's drawings have boards of their own, and a
 * drawing keeps its size when its request changes): the ground line and the scale keep their share of it.
 */
export function boardAtSize(spec: BoardSpec, w: number, h: number, pixelArt: boolean): BoardSpec {
  if (w === spec.w && h === spec.h) return { ...spec, pixelArt };
  const k = h / spec.h;
  return { ...spec, w, h, pixelArt, groundY: spec.groundY === null ? null : Math.round(spec.groundY * k), perGamePx: spec.perGamePx * k };
}

/** The free board a drawing of this size was made on (⋯ → Board size). */
export function freeBoardOf(w: number, h: number, pixelArt: boolean): BoardSpec {
  if (pixelArt) return { ...freeBoard('pixel32'), w, h, exportMax: Math.max(w, h) };
  return boardAtSize(freeBoard(w > h ? 'wide' : h > w ? 'tall' : 'square'), w, h, false);
}

/** The hero's height on this board (the scale ghost), board px. */
export function heroHeightOnBoard(board: BoardSpec, heroH: number): number {
  return heroH * board.perGamePx;
}
