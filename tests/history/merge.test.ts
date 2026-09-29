/**
 * The three-way code merge (§2.8): an AI change that finished while the student ran code of their own. A
 * file only one side changed takes that side; a file both changed gets a diff3 line merge; on a real
 * conflict the student's file stays and the other change to it is left out.
 */
import { describe, expect, it } from 'vitest';
import { mergeCode, mergeLines } from '../../src/history/merge';
import type { CodeFile } from '../../src/model/types';

const L = (s: string) => s.split('\n');
const BASE = L('class Game extends Amble.Scene {\n  create() {\n    this.speed = 200;\n    this.lives = 3;\n  }\n  update() {\n    this.move();\n  }\n}');

function file(path: string, source: string, authors: CodeFile['authors'] = [['starter', source.split('\n').length]]): CodeFile {
  return { path, source, authors, locked: [] };
}

describe('mergeLines (diff3)', () => {
  it('takes the only side that changed', () => {
    const mine = BASE.map((l) => l.replace('200', '300'));
    expect(mergeLines(BASE, mine, BASE)).toEqual(mine);
    expect(mergeLines(BASE, BASE, mine)).toEqual(mine);
  });

  it('merges changes to different places', () => {
    const mine = BASE.map((l) => l.replace('200', '300'));
    const theirs = [...BASE.slice(0, 7), '    this.fx.shake(0.01);', ...BASE.slice(7)];
    expect(mergeLines(BASE, mine, theirs)).toEqual([...mine.slice(0, 7), '    this.fx.shake(0.01);', ...mine.slice(7)]);
  });

  it('merges a deletion on one side with an edit on the other', () => {
    const mine = BASE.map((l) => l.replace('200', '300'));
    const theirs = BASE.filter((l) => !l.includes('this.move()'));
    expect(mergeLines(BASE, mine, theirs)).toEqual(mine.filter((l) => !l.includes('this.move()')));
  });

  it('takes the same change made on both sides once', () => {
    const both = BASE.map((l) => l.replace('lives = 3', 'lives = 5'));
    expect(mergeLines(BASE, both, both)).toEqual(both);
  });

  it('merges insertions at the start and the end', () => {
    const mine = ['// mine', ...BASE];
    const theirs = [...BASE, '// theirs'];
    expect(mergeLines(BASE, mine, theirs)).toEqual(['// mine', ...BASE, '// theirs']);
  });

  it('is a conflict when both change the same line differently', () => {
    expect(mergeLines(BASE, BASE.map((l) => l.replace('200', '300')), BASE.map((l) => l.replace('200', '120')))).toBeNull();
  });

  it('is a conflict when both insert different lines at the same place', () => {
    const mine = [...BASE.slice(0, 4), '    this.a = 1;', ...BASE.slice(4)];
    const theirs = [...BASE.slice(0, 4), '    this.b = 2;', ...BASE.slice(4)];
    expect(mergeLines(BASE, mine, theirs)).toBeNull();
  });

  it('is a conflict when both change neighbouring lines (no unchanged line between them)', () => {
    const mine = BASE.map((l) => l.replace('200', '300'));
    const theirs = BASE.map((l) => l.replace('lives = 3', 'lives = 5'));
    expect(mergeLines(BASE, mine, theirs)).toBeNull();
  });

  it('merges changes with one unchanged line between them', () => {
    const mine = BASE.map((l) => l.replace('200', '300'));
    const theirs = BASE.map((l) => l.replace('  }', '  } // end'));
    const merged = mergeLines(BASE, mine, theirs);
    expect(merged).toEqual(mine.map((l) => l.replace('  }', '  } // end')));
  });

  it('handles empty files', () => {
    expect(mergeLines([], [], [])).toEqual([]);
    expect(mergeLines([], ['a'], [])).toEqual(['a']);
    expect(mergeLines([], ['a'], ['b'])).toBeNull();
    expect(mergeLines(['a'], [], ['a'])).toEqual([]);
  });
});

describe('mergeCode', () => {
  const game = file('game.js', BASE.join('\n'));
  const boss = file('boss.js', 'export const boss = { hp: 10 };\nexport const phase = 1;');

  it('keeps a file only the student changed, and takes a file only the AI changed', () => {
    const mineBoss = { ...boss, source: boss.source.replace('hp: 10', 'hp: 12'), authors: [['student', 1], ['starter', 1]] as CodeFile['authors'] };
    const theirsGame = { ...game, source: game.source.replace('this.move();', 'this.move();\n    this.fx.shake(0.01);') };
    const r = mergeCode([boss, game], [mineBoss, game], [boss, theirsGame]);
    expect(r.leftOut).toEqual([]);
    expect(r.files.map((f) => f.path)).toEqual(['boss.js', 'game.js']);
    expect(r.files[0]).toBe(mineBoss);
    expect(r.files[1].source).toBe(theirsGame.source);
  });

  it('merges a file both changed in different places', () => {
    const mine = { ...game, source: game.source.replace('200', '300') };
    const theirs = { ...game, source: game.source.replace('this.move();', 'this.move();\n    this.fx.shake(0.01);') };
    const r = mergeCode([game], [mine], [theirs]);
    expect(r.leftOut).toEqual([]);
    expect(r.files[0].source).toContain('this.speed = 300;');
    expect(r.files[0].source).toContain('this.fx.shake(0.01);');
  });

  it("keeps the student's file on a conflict and says it was left out", () => {
    const mine = { ...game, source: game.source.replace('200', '300') };
    const theirs = { ...game, source: game.source.replace('200', '120') };
    const theirsBoss = { ...boss, source: boss.source.replace('phase = 1', 'phase = 2') };
    const r = mergeCode([boss, game], [boss, mine], [theirsBoss, theirs]);
    expect(r.leftOut).toEqual(['game.js']);
    expect(r.files.find((f) => f.path === 'game.js')).toBe(mine);
    // The AI's change to the other file still goes in.
    expect(r.files.find((f) => f.path === 'boss.js')?.source).toContain('phase = 2');
  });

  it('adds a file the AI added, and removes one it removed that the student left alone', () => {
    const added = file('bullets.js', 'export const speed = 9;');
    const r = mergeCode([boss, game], [boss, game], [added, game]);
    expect(r.files.map((f) => f.path)).toEqual(['bullets.js', 'game.js']);
    expect(r.leftOut).toEqual([]);
  });

  it("keeps a file the AI removed when the student changed it, and one the student removed when the AI changed it", () => {
    const mineBoss = { ...boss, source: boss.source.replace('hp: 10', 'hp: 12') };
    const r1 = mergeCode([boss, game], [mineBoss, game], [game]);
    expect(r1.files.map((f) => f.path)).toEqual(['boss.js', 'game.js']);
    expect(r1.leftOut).toEqual(['boss.js']);
    const theirsBoss = { ...boss, source: boss.source.replace('hp: 10', 'hp: 8') };
    const r2 = mergeCode([boss, game], [game], [theirsBoss, game]);
    expect(r2.files.map((f) => f.path)).toEqual(['game.js']);
    expect(r2.leftOut).toEqual(['boss.js']);
  });

  it('keeps helpers first (alphabetical) and game.js last', () => {
    const extra = file('zap.js', 'export const zap = 1;');
    const added = file('aim.js', 'export const aim = 1;');
    const r = mergeCode([game], [game, extra], [game, added]);
    expect(r.files.map((f) => f.path)).toEqual(['aim.js', 'zap.js', 'game.js']);
  });

  it('is the AI result itself when the student changed nothing', () => {
    const theirs = [boss, { ...game, source: game.source.replace('200', '120') }];
    const r = mergeCode([boss, game], [boss, game], theirs);
    expect(r.files.map((f) => f.source)).toEqual(theirs.map((f) => f.source));
    expect(r.leftOut).toEqual([]);
  });
});
