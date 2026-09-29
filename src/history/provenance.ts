/**
 * Provenance (§2.9, §4.2 `CodeFile.authors`): who wrote each line of the world's code, as run-length
 * `[author, lines]` pairs. A change keeps the author of every unchanged line and credits inserted or
 * changed lines to whoever made the change (a Myers line diff decides which lines are which). Teacher
 * locks travel with their lines, so inserting code above a locked block keeps the same code locked.
 */
import type { Author, AuthorRun, CodeFile, LineRange } from '../model/types';
import { diffLines, type DiffRun } from './myers';

/** A file's lines ('' has none, so an empty file has no author runs). */
export function linesOf(source: string): string[] {
  return source === '' ? [] : source.split('\n');
}

/** One author per line; lines the runs don't cover (a damaged file) count as the starter's. */
export function expandAuthors(runs: readonly AuthorRun[], lineCount: number): Author[] {
  const out: Author[] = [];
  for (const [who, n] of runs) {
    for (let i = 0; i < n && out.length < lineCount; i++) out.push(who);
  }
  while (out.length < lineCount) out.push('starter');
  return out;
}

export function compressAuthors(list: readonly Author[]): AuthorRun[] {
  const runs: AuthorRun[] = [];
  for (const who of list) {
    const last = runs[runs.length - 1];
    if (last && last[0] === who) last[1]++;
    else runs.push([who, 1]);
  }
  return runs;
}

/** Maps each old line index to its new index (unchanged lines only; -1 for changed or deleted lines). */
export function lineMap(runs: readonly DiffRun[], oldCount: number): Int32Array {
  const map = new Int32Array(oldCount).fill(-1);
  for (const r of runs) {
    if (r.op !== '=') continue;
    for (let i = 0; i < r.n; i++) map[r.a + i] = r.b + i;
  }
  return map;
}

/** The authors of `next`'s lines: unchanged lines keep theirs, the rest are `by`'s. */
export function attributeLines(prevLines: readonly string[], prevAuthors: readonly Author[], nextLines: readonly string[], by: Author): Author[] {
  const out: Author[] = new Array(nextLines.length).fill(by);
  for (const r of diffLines(prevLines, nextLines)) {
    if (r.op !== '=') continue;
    for (let i = 0; i < r.n; i++) out[r.b + i] = prevAuthors[r.a + i] ?? 'starter';
  }
  return out;
}

/** Sorts, clamps and merges line ranges (1-based, inclusive). */
export function normalizeRanges(ranges: readonly LineRange[], lineCount: number): LineRange[] {
  const clean = ranges
    .map(([a, b]) => [Math.max(1, Math.min(a, b)), Math.min(lineCount, Math.max(a, b))] as LineRange)
    .filter(([a, b]) => a <= b)
    .sort((x, y) => x[0] - y[0]);
  const out: LineRange[] = [];
  for (const r of clean) {
    const last = out[out.length - 1];
    if (last && r[0] <= last[1] + 1) last[1] = Math.max(last[1], r[1]);
    else out.push([r[0], r[1]]);
  }
  return out;
}

/** Moves locked ranges to where their lines are after an edit (lines that changed drop out). */
export function mapLockedRanges(prevLines: readonly string[], nextLines: readonly string[], locked: readonly LineRange[]): LineRange[] {
  if (!locked.length) return [];
  const map = lineMap(diffLines(prevLines, nextLines), prevLines.length);
  const moved: LineRange[] = [];
  for (const [from, to] of normalizeRanges(locked, prevLines.length)) {
    for (let line = from; line <= to; line++) {
      const to1 = map[line - 1];
      if (to1 >= 0) moved.push([to1 + 1, to1 + 1]);
    }
  }
  return normalizeRanges(moved, nextLines.length);
}

/**
 * `HistoryApi.attribute`: provenance runs for `next` after `by` changed `prev`. Files that did not change
 * keep their runs; new files are all `by`'s. Locked ranges follow their lines, except when a teacher is
 * the one editing (then `next.locked` is the teacher's new choice and is kept as given).
 */
export function attribute(prev: readonly CodeFile[], next: readonly CodeFile[], by: Author): CodeFile[] {
  return next.map((file) => {
    const before = prev.find((p) => p.path === file.path);
    const lines = linesOf(file.source);
    if (!before) return { ...file, authors: compressAuthors(new Array<Author>(lines.length).fill(by)), locked: normalizeRanges(file.locked, lines.length) };
    if (before.source === file.source) {
      return { ...file, authors: before.authors, locked: by === 'teacher' ? normalizeRanges(file.locked, lines.length) : before.locked };
    }
    const prevLines = linesOf(before.source);
    const authors = attributeLines(prevLines, expandAuthors(before.authors, prevLines.length), lines, by);
    const locked = by === 'teacher' ? normalizeRanges(file.locked, lines.length) : mapLockedRanges(prevLines, lines, before.locked);
    return { ...file, authors: compressAuthors(authors), locked };
  });
}

/** Whether a line (1-based) is inside any of the ranges. */
export function inRanges(line: number, ranges: readonly LineRange[]): boolean {
  return ranges.some(([a, b]) => line >= a && line <= b);
}
