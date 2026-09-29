/** Provenance runs across AI, student and teacher edits (§2.9, §4.2 `CodeFile.authors`). */
import { describe, expect, it } from 'vitest';
import { attribute, compressAuthors, expandAuthors, linesOf, mapLockedRanges, normalizeRanges } from '../../src/history/provenance';
import type { CodeFile } from '../../src/model/types';

const START = ['class Game extends Amble.Scene {', '  create() {', '    this.spawnHero(100, 300);', '  }', '}'].join('\n');

function file(source: string, authors: CodeFile['authors'], locked: CodeFile['locked'] = []): CodeFile {
  return { path: 'game.js', source, authors, locked };
}

describe('provenance', () => {
  it('reads an empty file as no lines', () => {
    expect(linesOf('')).toEqual([]);
    expect(linesOf('a\nb')).toEqual(['a', 'b']);
    expect(linesOf('a\n')).toEqual(['a', '']);
  });

  it('expands and compresses runs', () => {
    expect(expandAuthors([['starter', 2], ['ai', 1]], 4)).toEqual(['starter', 'starter', 'ai', 'starter']);
    expect(compressAuthors(['ai', 'ai', 'student', 'ai'])).toEqual([
      ['ai', 2],
      ['student', 1],
      ['ai', 1],
    ]);
  });

  it('keeps authors across an AI change, then a student edit, then a teacher edit', () => {
    const start = file(START, [['starter', 5]]);
    // The AI adds two lines inside create().
    const aiSource = START.replace('    this.spawnHero(100, 300);', '    this.spawnHero(100, 300);\n    this.fx.shake(0.01);\n    this.ui.big("GO!");');
    const [ai] = attribute([start], [{ ...start, source: aiSource }], 'ai');
    expect(ai.authors).toEqual([
      ['starter', 3],
      ['ai', 2],
      ['starter', 2],
    ]);
    // The student changes a number in the AI's line.
    const studentSource = aiSource.replace('0.01', '0.03');
    const [student] = attribute([ai], [{ ...ai, source: studentSource }], 'student');
    expect(student.authors).toEqual([
      ['starter', 3],
      ['student', 1],
      ['ai', 1],
      ['starter', 2],
    ]);
    // The teacher adds a comment at the top.
    const [teacher] = attribute([student], [{ ...student, source: `// Make it yours!\n${studentSource}` }], 'teacher');
    expect(teacher.authors).toEqual([
      ['teacher', 1],
      ['starter', 3],
      ['student', 1],
      ['ai', 1],
      ['starter', 2],
    ]);
    // Deleting a line removes its author.
    const [trimmed] = attribute([teacher], [{ ...teacher, source: studentSource.replace('\n    this.ui.big("GO!");', '') }], 'student');
    expect(trimmed.authors).toEqual([
      ['starter', 3],
      ['student', 1],
      ['starter', 2],
    ]);
  });

  it('keeps runs for unchanged files and credits new files to the author', () => {
    const start = file(START, [['starter', 5]]);
    const helper: CodeFile = { path: 'boss.js', source: 'function roar() {}\n', authors: [], locked: [] };
    const out = attribute([start], [start, helper], 'ai');
    expect(out[0].authors).toBe(start.authors);
    expect(out[1].authors).toEqual([['ai', 2]]);
    expect(attribute([], [{ ...helper, source: '' }], 'ai')[0].authors).toEqual([]);
  });

  it('moves teacher locks with their lines, and drops lines that changed', () => {
    const lines = START.split('\n');
    expect(mapLockedRanges(lines, ['// hi', ...lines], [[2, 4]])).toEqual([[3, 5]]);
    const changed = [...lines];
    changed[2] = '    this.spawnHero(200, 300);';
    expect(mapLockedRanges(lines, changed, [[2, 4]])).toEqual([
      [2, 2],
      [4, 4],
    ]);
    const start = file(START, [['starter', 5]], [[2, 4]]);
    const [moved] = attribute([start], [{ ...start, source: `// hi\n${START}` }], 'ai');
    expect(moved.locked).toEqual([[3, 5]]);
    // A teacher's own edit keeps the ranges the teacher chose.
    const [teacher] = attribute([start], [{ ...start, source: `// hi\n${START}`, locked: [[1, 1]] }], 'teacher');
    expect(teacher.locked).toEqual([[1, 1]]);
  });

  it('normalizes ranges', () => {
    expect(
      normalizeRanges(
        [
          [5, 3],
          [1, 1],
          [2, 2],
          [9, 12],
        ],
        10,
      ),
    ).toEqual([
      [1, 5],
      [9, 10],
    ]);
  });
});
