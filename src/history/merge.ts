/**
 * Three-way merge of a world's code (§2.8): an AI change finished while the student ran code of their own in
 * Look inside. `base` is the code the job started from, `mine` the code as it is now, `theirs` the job's
 * result. Per file: a file only one side changed takes that side's version; a file both changed gets a line
 * merge (diff3: the stretches between lines neither side touched are compared, and a stretch only one side
 * changed takes that side); where both changed the same stretch differently, the student's file stays as it
 * is and the other side's change to it is left out, never half applied.
 */
import type { CodeFile } from '../model/types';
import { diffLines } from './myers';
import { lineMap, linesOf } from './provenance';

/** For each line of `base`, its index in `other` when it is unchanged there, else -1. */
function matched(base: readonly string[], other: readonly string[]): Int32Array {
  return lineMap(diffLines(base, other), base.length);
}

function same(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((line, i) => line === b[i]);
}

/**
 * The diff3 line merge (Khanna, Kunal and Pierce, "A Formal Investigation of Diff3", 2007): lines unchanged on
 * both sides are stable, and each unstable stretch between them takes the side that changed it. Returns null on
 * a conflict (both sides changed the same stretch differently, including two insertions at the same place, or
 * changes on neighbouring lines with no unchanged line between them).
 */
export function mergeLines(base: readonly string[], mine: readonly string[], theirs: readonly string[]): string[] | null {
  const toMine = matched(base, mine);
  const toTheirs = matched(base, theirs);
  const out: string[] = [];
  // Where the three versions line up: everything before o, a and b is merged.
  let o = 0;
  let a = 0;
  let b = 0;
  for (;;) {
    let n = 0;
    while (o + n < base.length && toMine[o + n] === a + n && toTheirs[o + n] === b + n) n++;
    if (n > 0) {
      for (let i = 0; i < n; i++) out.push(base[o + i]);
      o += n;
      a += n;
      b += n;
      continue;
    }
    if (o >= base.length && a >= mine.length && b >= theirs.length) return out;
    // An unstable stretch: up to the next base line both sides kept.
    let j = o;
    while (j < base.length && (toMine[j] < 0 || toTheirs[j] < 0)) j++;
    const aEnd = j < base.length ? toMine[j] : mine.length;
    const bEnd = j < base.length ? toTheirs[j] : theirs.length;
    const was = base.slice(o, j);
    const m = mine.slice(a, aEnd);
    const t = theirs.slice(b, bEnd);
    if (same(m, was)) out.push(...t);
    else if (same(t, was) || same(m, t)) out.push(...m);
    else return null;
    o = j;
    a = aEnd;
    b = bEnd;
  }
}

export interface CodeMerge {
  /**
   * The merged files, helpers first (alphabetical) and `game.js` last. A kept file is the student's own copy
   * (authors and locks as they are); a merged or taken file carries theirs, for the caller to attribute.
   */
  files: CodeFile[];
  /** Files both sides changed in the same lines: the student's file stayed, and the other change to it did not go in. */
  leftOut: string[];
}

const loadOrder = (x: CodeFile, y: CodeFile): number => (x.path === 'game.js' ? 1 : y.path === 'game.js' ? -1 : x.path.localeCompare(y.path));

/** Merges `theirs` (a change made from `base`) into `mine` (the code as it is now), file by file. */
export function mergeCode(base: readonly CodeFile[], mine: readonly CodeFile[], theirs: readonly CodeFile[]): CodeMerge {
  const find = (list: readonly CodeFile[], path: string) => list.find((f) => f.path === path);
  const paths = [...new Set([...theirs.map((f) => f.path), ...mine.map((f) => f.path)])];
  const files: CodeFile[] = [];
  const leftOut: string[] = [];
  for (const path of paths) {
    const was = find(base, path);
    const m = find(mine, path);
    const t = find(theirs, path);
    const wasSrc = was?.source ?? null;
    const mSrc = m?.source ?? null;
    const tSrc = t?.source ?? null;
    if (tSrc === wasSrc || tSrc === mSrc) {
      // Theirs left it alone (or made the same change): the student's copy stays.
      if (m) files.push(m);
      continue;
    }
    if (mSrc === wasSrc) {
      // Only theirs changed it (or added it, or removed it).
      if (t) files.push(t);
      continue;
    }
    // Both changed it: a line merge when both still have it.
    const merged = m && t ? mergeLines(linesOf(wasSrc ?? ''), linesOf(m.source), linesOf(t.source)) : null;
    if (m && t && merged) files.push({ ...t, source: merged.join('\n') });
    else {
      if (m) files.push(m);
      leftOut.push(path);
    }
  }
  return { files: files.sort(loadOrder), leftOut };
}
