/** Unified diffs (±3 lines of context) and what a step changed (§2.9 "See the change"). */
import { describe, expect, it } from 'vitest';
import { codeDiff, countHunkChanges, dialDiff, drawingDiff, linesWritten, parseUnified, stepDiff, twistDiff, unifiedDiff } from '../../src/history/diff';
import type { CodeFile, StepSnapshot } from '../../src/model/types';
import { REF_A, REF_B, REF_C, sampleStep, sampleWorld } from '../foundation/samples';

const lines = (n: number) => Array.from({ length: n }, (_, i) => `line ${i + 1}`);

describe('unifiedDiff', () => {
  it('writes one hunk with three lines of context', () => {
    const a = lines(10);
    const b = [...a];
    b[4] = 'line 5 changed';
    expect(unifiedDiff(a.join('\n'), b.join('\n'))).toBe(
      ['@@ -2,7 +2,7 @@', ' line 2', ' line 3', ' line 4', '-line 5', '+line 5 changed', ' line 6', ' line 7', ' line 8'].join('\n'),
    );
  });

  it('splits far-apart changes into hunks and joins close ones', () => {
    const a = lines(30);
    const far = [...a];
    far[2] = 'x';
    far[25] = 'y';
    expect(unifiedDiff(a.join('\n'), far.join('\n')).match(/^@@/gm)).toHaveLength(2);
    const near = [...a];
    near[2] = 'x';
    near[8] = 'y';
    expect(unifiedDiff(a.join('\n'), near.join('\n')).match(/^@@/gm)).toHaveLength(1);
  });

  it('diffs new and deleted files against nothing', () => {
    expect(unifiedDiff('', 'a\nb')).toBe('@@ -0,0 +1,2 @@\n+a\n+b');
    expect(unifiedDiff('a\nb', '')).toBe('@@ -1,2 +0,0 @@\n-a\n-b');
    expect(unifiedDiff('same', 'same')).toBe('');
  });

  it('reads its own output back with line numbers on both sides', () => {
    const a = lines(12);
    const b = [...a.slice(0, 5), 'new line', ...a.slice(5)];
    b.splice(10, 1);
    const hunks = parseUnified(unifiedDiff(a.join('\n'), b.join('\n')));
    expect(countHunkChanges(hunks)).toEqual({ added: 1, removed: 1 });
    const added = hunks.flatMap((h) => h.lines).find((l) => l.kind === '+');
    expect(added).toEqual({ kind: '+', text: 'new line', a: null, b: 6 });
    const removed = hunks.flatMap((h) => h.lines).find((l) => l.kind === '-');
    expect(removed?.a).toBe(10);
    for (const h of hunks) {
      expect(h.lines.filter((l) => l.kind !== '+')).toHaveLength(h.aLen);
      expect(h.lines.filter((l) => l.kind !== '-')).toHaveLength(h.bLen);
    }
  });
});

describe('step diffs', () => {
  const code = (source: string, path = 'game.js'): CodeFile => ({ path, source, authors: [], locked: [] });

  it('lists changed files, helpers first', () => {
    const out = codeDiff([code('a'), code('x', 'boss.js')], [code('b'), code('x', 'boss.js'), code('y', 'arena.js')]);
    expect(out.map((f) => f.path)).toEqual(['arena.js', 'game.js']);
    expect(linesWritten([code('a\nb')], [code('a\nc\nd')])).toBe(2);
  });

  it('finds drawings that changed, appeared or went back to bones', () => {
    const world = sampleWorld();
    const before = sampleStep(world, {
      art: { a_hero000001: { version: 1, doc: REF_A, cels: [], export: { hash: 'h1', flat: REF_A, w: 1, h: 1, anchor: [0, 0], inkMask: null, parts: {}, sticker: REF_A, thumb: REF_A, frames: null }, rigData: null } },
    });
    const after: StepSnapshot = {
      ...before,
      id: 's_after00001',
      cast: { ...before.cast, moonKing: { ...before.cast.moonKing, art: 'a_moon000001' } },
      art: {
        a_hero000001: { ...before.art.a_hero000001, version: 2, export: { ...before.art.a_hero000001.export!, hash: 'h2', sticker: REF_B } },
        a_moon000001: { version: 1, doc: REF_C, cels: [], export: { hash: 'h3', flat: REF_C, w: 1, h: 1, anchor: [0, 0], inkMask: null, parts: {}, sticker: REF_C, thumb: REF_C, frames: null }, rigData: null },
      },
    };
    expect(drawingDiff(before, after)).toEqual([
      { key: 'hero', before: REF_A, after: REF_B },
      { key: 'moonKing', before: null, after: REF_C },
    ]);
    expect(drawingDiff(before, before)).toEqual([]);
  });

  it('compares dials against the game defaults', () => {
    expect(dialDiff({ jump: 820 }, { jump: 900, orb: 200 }, { orb: 240 })).toEqual([
      { key: 'jump', before: 820, after: 900 },
      { key: 'orb', before: 240, after: 200 },
    ]);
    expect(dialDiff({ jump: 820 }, {}, { jump: 720 })).toEqual([{ key: 'jump', before: 820, after: 720 }]);
    expect(twistDiff(['a', 'b'], ['b', 'c'])).toEqual({ on: ['c'], off: ['a'] });
  });

  it('has nothing to compare for a first step', () => {
    expect(stepDiff(null, sampleStep())).toEqual({ files: [], drawings: [], dials: [] });
  });
});
