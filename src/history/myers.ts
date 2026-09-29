/**
 * A line diff (Myers, "An O(ND) Difference Algorithm", 1986) for provenance and Footsteps' unified diffs.
 * The common prefix and suffix are trimmed first (most edits touch a few lines), and the middle is diffed
 * with the greedy forward pass plus a trace for backtracking. Past `maxEdits` differences it gives up on a
 * minimal script and replaces the whole middle, so a rewrite of a 40 KB file never costs much memory.
 */

export type DiffOp = '=' | '-' | '+';

/** A run of one kind: `n` lines at `a` in the old list and/or `b` in the new one (0-based). */
export interface DiffRun {
  op: DiffOp;
  a: number;
  b: number;
  n: number;
}

/** Past this many edits the middle is treated as replaced (the trace would need (D+1)² cells). */
const MAX_EDITS = 1200;

function push(runs: DiffRun[], op: DiffOp, a: number, b: number, n = 1): void {
  if (n <= 0) return;
  const last = runs[runs.length - 1];
  if (last && last.op === op && last.a + (op === '+' ? 0 : last.n) === a && last.b + (op === '-' ? 0 : last.n) === b) {
    last.n += n;
    return;
  }
  runs.push({ op, a, b, n });
}

/** Interns lines as small integers so the inner loop compares numbers. */
function intern(a: readonly string[], b: readonly string[], from: number, aEnd: number, bEnd: number): [Int32Array, Int32Array] {
  const ids = new Map<string, number>();
  const idOf = (line: string): number => {
    let id = ids.get(line);
    if (id === undefined) {
      id = ids.size;
      ids.set(line, id);
    }
    return id;
  };
  const x = new Int32Array(aEnd - from);
  const y = new Int32Array(bEnd - from);
  for (let i = from; i < aEnd; i++) x[i - from] = idOf(a[i]);
  for (let j = from; j < bEnd; j++) y[j - from] = idOf(b[j]);
  return [x, y];
}

/**
 * The edit script of the middle part as (op, index) steps in order, or null past `maxEdits`.
 * Deletions come before insertions inside a changed block.
 */
function middle(a: Int32Array, b: Int32Array, maxEdits: number): Array<[DiffOp, number, number]> | null {
  const n = a.length;
  const m = b.length;
  const max = Math.min(n + m, maxEdits);
  const off = max + 1;
  const v = new Int32Array(2 * max + 3);
  const trace: Int32Array[] = [];
  v[off + 1] = 0;
  let found = -1;
  for (let d = 0; d <= max && found < 0; d++) {
    for (let k = -d; k <= d; k += 2) {
      const down = k === -d || (k !== d && v[off + k - 1] < v[off + k + 1]);
      let x = down ? v[off + k + 1] : v[off + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }
      v[off + k] = x;
      if (x >= n && y >= m) {
        found = d;
        break;
      }
    }
    trace.push(v.slice(off - d, off + d + 1));
  }
  if (found < 0) return null;

  // Backtrack from (n, m): each step d came from diagonal k±1 of step d-1, then slid down a snake.
  const steps: Array<[DiffOp, number, number]> = [];
  let x = n;
  let y = m;
  for (let d = found; d > 0; d--) {
    const k = x - y;
    const prev = trace[d - 1];
    const at = (kk: number) => prev[kk + d - 1];
    const down = k === -d || (k !== d && at(k - 1) < at(k + 1));
    const prevK = down ? k + 1 : k - 1;
    const prevX = at(prevK);
    const prevY = prevX - prevK;
    const midX = down ? prevX : prevX + 1;
    while (x > midX) {
      x--;
      y--;
      steps.push(['=', x, y]);
    }
    if (down) steps.push(['+', prevX, prevY]);
    else steps.push(['-', prevX, prevY]);
    x = prevX;
    y = prevY;
  }
  while (x > 0 && y > 0) {
    x--;
    y--;
    steps.push(['=', x, y]);
  }
  steps.reverse();
  // Within each changed block, list the deletions first (a stable, readable order).
  const out: Array<[DiffOp, number, number]> = [];
  let i = 0;
  while (i < steps.length) {
    if (steps[i][0] === '=') {
      out.push(steps[i++]);
      continue;
    }
    const block: Array<[DiffOp, number, number]> = [];
    while (i < steps.length && steps[i][0] !== '=') block.push(steps[i++]);
    for (const s of block) if (s[0] === '-') out.push(s);
    for (const s of block) if (s[0] === '+') out.push(s);
  }
  return out;
}

/**
 * The line diff of `a` → `b` as runs of equal, deleted and inserted lines, covering both lists in order.
 * `maxEdits` bounds the work (the default suits files of a few hundred lines).
 */
export function diffLines(a: readonly string[], b: readonly string[], maxEdits = MAX_EDITS): DiffRun[] {
  const runs: DiffRun[] = [];
  let start = 0;
  const limit = Math.min(a.length, b.length);
  while (start < limit && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  push(runs, '=', 0, 0, start);
  if (endA > start || endB > start) {
    const [x, y] = intern(a, b, start, endA, endB);
    const steps = middle(x, y, maxEdits);
    if (steps) {
      let ai = start;
      let bi = start;
      for (const [op] of steps) {
        push(runs, op, ai, bi);
        if (op !== '+') ai++;
        if (op !== '-') bi++;
      }
    } else {
      push(runs, '-', start, start, endA - start);
      push(runs, '+', endA, start, endB - start);
    }
  }
  push(runs, '=', endA, endB, a.length - endA);
  return runs;
}

/** How many lines were inserted and deleted (a changed line counts once each way). */
export function countEdits(runs: readonly DiffRun[]): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const r of runs) {
    if (r.op === '+') added += r.n;
    else if (r.op === '-') removed += r.n;
  }
  return { added, removed };
}
