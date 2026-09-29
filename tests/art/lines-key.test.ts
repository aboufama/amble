/**
 * The fill analysis is cached by key in the page's engine worker, which outlives every drawing. A drawing
 * opened again keeps its frame and layer ids while its pixel versions start over, so the key must also name
 * the board it came from: two visits with different lines must never share an analysis.
 */
import { describe, expect, it } from 'vitest';
import { Board } from '../../src/art/engine/board';
import { makeLayer } from '../../src/art/engine/model';
import { Painter } from '../../src/art/engine/paint';

function visit(ink: number): { board: Board; painter: Painter } {
  const board = new Board(64, 64, false);
  board.layers = [makeLayer('colors1', 'colors'), makeLayer('lines1', 'lines')];
  board.frames = [{ id: 'page1', hold: 1 }];
  const px = new Uint8ClampedArray(64 * 64 * 4);
  px[ink * 4 + 3] = 255;
  board.setPixels('page1', 'lines1', px);
  return { board, painter: new Painter(board) };
}

describe('the lines-analysis key', () => {
  it('differs between two boards with the same ids and versions but other lines', () => {
    const a = visit(10);
    const b = visit(500);
    expect(a.board.version('page1', 'lines1')).toBe(b.board.version('page1', 'lines1'));
    expect(a.painter.linesKey('page1', 11)).not.toBe(b.painter.linesKey('page1', 11));
  });

  it('stays the same while the lines stay the same, and changes when they change', () => {
    const { board, painter } = visit(10);
    const k = painter.linesKey('page1', 11);
    expect(painter.linesKey('page1', 11)).toBe(k);
    board.changed('page1', 'lines1', null);
    expect(painter.linesKey('page1', 11)).not.toBe(k);
  });
});
