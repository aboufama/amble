/** The Myers line diff: minimal, complete, and bounded on rewrites. */
import { describe, expect, it } from 'vitest';
import { countEdits, diffLines, type DiffRun } from '../../src/history/myers';

/** Rebuilds `b` from `a` and the runs (and checks that the runs cover both lists in order). */
function apply(a: string[], b: string[], runs: DiffRun[]): string[] {
  const out: string[] = [];
  let ai = 0;
  let bi = 0;
  for (const r of runs) {
    expect(r.a).toBe(ai);
    expect(r.b).toBe(bi);
    if (r.op === '=') {
      for (let i = 0; i < r.n; i++) expect(a[ai + i]).toBe(b[bi + i]);
      out.push(...a.slice(ai, ai + r.n));
      ai += r.n;
      bi += r.n;
    } else if (r.op === '-') ai += r.n;
    else {
      out.push(...b.slice(bi, bi + r.n));
      bi += r.n;
    }
  }
  expect(ai).toBe(a.length);
  expect(bi).toBe(b.length);
  return out;
}

/** Deterministic pseudo-random lists over a small alphabet (lots of repeats, like real code). */
function lists(seed: number): [string[], string[]] {
  let s = seed;
  const rand = () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
  const make = () => Array.from({ length: Math.floor(rand() * 14) }, () => 'abcde'[Math.floor(rand() * 5)]);
  return [make(), make()];
}

/** The LCS length by dynamic programming (the minimal diff keeps exactly this many lines). */
function lcs(a: string[], b: string[]): number {
  const dp = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
  return dp[a.length][b.length];
}

describe('diffLines', () => {
  it('finds nothing to change in equal lists', () => {
    expect(diffLines(['a', 'b'], ['a', 'b'])).toEqual([{ op: '=', a: 0, b: 0, n: 2 }]);
    expect(diffLines([], [])).toEqual([]);
  });

  it('describes a changed line as a deletion then an insertion', () => {
    expect(diffLines(['a', 'b', 'c'], ['a', 'x', 'c'])).toEqual([
      { op: '=', a: 0, b: 0, n: 1 },
      { op: '-', a: 1, b: 1, n: 1 },
      { op: '+', a: 2, b: 1, n: 1 },
      { op: '=', a: 2, b: 2, n: 1 },
    ]);
  });

  it('handles insertions and deletions at the ends and into empty lists', () => {
    expect(diffLines([], ['a', 'b'])).toEqual([{ op: '+', a: 0, b: 0, n: 2 }]);
    expect(diffLines(['a', 'b'], [])).toEqual([{ op: '-', a: 0, b: 0, n: 2 }]);
    expect(diffLines(['b'], ['a', 'b', 'c'])).toEqual([
      { op: '+', a: 0, b: 0, n: 1 },
      { op: '=', a: 0, b: 1, n: 1 },
      { op: '+', a: 1, b: 2, n: 1 },
    ]);
  });

  it('is minimal and rebuilds the new list for many random pairs', () => {
    for (let seed = 1; seed <= 400; seed++) {
      const [a, b] = lists(seed);
      const runs = diffLines(a, b);
      expect(apply(a, b, runs)).toEqual(b);
      const kept = runs.filter((r) => r.op === '=').reduce((n, r) => n + r.n, 0);
      expect(kept).toBe(lcs(a, b));
    }
  });

  it('replaces the middle when the edit count passes the limit', () => {
    const a = Array.from({ length: 50 }, (_, i) => `a${i}`);
    const b = Array.from({ length: 50 }, (_, i) => `b${i}`);
    const runs = diffLines(['same', ...a, 'end'], ['same', ...b, 'end'], 10);
    expect(runs).toEqual([
      { op: '=', a: 0, b: 0, n: 1 },
      { op: '-', a: 1, b: 1, n: 50 },
      { op: '+', a: 51, b: 1, n: 50 },
      { op: '=', a: 51, b: 51, n: 1 },
    ]);
    expect(countEdits(runs)).toEqual({ added: 50, removed: 50 });
  });

  it('stays fast on a 400-line file with scattered edits', () => {
    const a = Array.from({ length: 400 }, (_, i) => `line ${i % 37} ${i}`);
    const b = a.map((l, i) => (i % 25 === 0 ? `${l} // changed` : l));
    b.splice(200, 0, 'inserted();');
    const started = performance.now();
    const runs = diffLines(a, b);
    expect(performance.now() - started).toBeLessThan(200);
    expect(apply(a, b, runs)).toEqual(b);
    expect(countEdits(runs)).toEqual({ added: 17, removed: 16 });
  });
});
