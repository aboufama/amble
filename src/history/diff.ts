/**
 * What changed in a step (§2.9 "See the change", §4.2 `StepDiff`): a unified diff per changed file with
 * ±3 lines of context, the drawings that changed (before and after stickers) and the dials that moved.
 * Pure: the caller loads the two snapshots.
 */
import type { ArtId, BlobRef, CastKey, CodeFile, StepDiff, StepSnapshot, TwistId } from '../model/types';
import { diffLines, type DiffRun } from './myers';
import { linesOf } from './provenance';

export const CONTEXT_LINES = 3;

export interface DiffLine {
  kind: ' ' | '+' | '-';
  text: string;
  /** 1-based line in the old file (null for added lines). */
  a: number | null;
  /** 1-based line in the new file (null for removed lines). */
  b: number | null;
}

export interface Hunk {
  aStart: number;
  aLen: number;
  bStart: number;
  bLen: number;
  lines: DiffLine[];
}

/** Every line of both files in order, tagged (the input to hunking). */
function allLines(a: readonly string[], b: readonly string[], runs: readonly DiffRun[]): DiffLine[] {
  const out: DiffLine[] = [];
  for (const r of runs) {
    for (let i = 0; i < r.n; i++) {
      if (r.op === '=') out.push({ kind: ' ', text: b[r.b + i], a: r.a + i + 1, b: r.b + i + 1 });
      else if (r.op === '-') out.push({ kind: '-', text: a[r.a + i], a: r.a + i + 1, b: null });
      else out.push({ kind: '+', text: b[r.b + i], a: null, b: r.b + i + 1 });
    }
  }
  return out;
}

/** The hunks of a change (changes closer than 2 × context share one hunk). */
export function diffHunks(before: string, after: string, context = CONTEXT_LINES): Hunk[] {
  const a = linesOf(before);
  const b = linesOf(after);
  const lines = allLines(a, b, diffLines(a, b));
  const changed: number[] = [];
  lines.forEach((l, i) => l.kind !== ' ' && changed.push(i));
  if (!changed.length) return [];
  const hunks: Hunk[] = [];
  let i = 0;
  while (i < changed.length) {
    const start = Math.max(0, changed[i] - context);
    let end = Math.min(lines.length - 1, changed[i] + context);
    let j = i + 1;
    while (j < changed.length && changed[j] - context <= end + 1) {
      end = Math.min(lines.length - 1, changed[j] + context);
      j++;
    }
    const slice = lines.slice(start, end + 1);
    const firstA = slice.find((l) => l.a !== null)?.a ?? null;
    const firstB = slice.find((l) => l.b !== null)?.b ?? null;
    const aLen = slice.filter((l) => l.kind !== '+').length;
    const bLen = slice.filter((l) => l.kind !== '-').length;
    // Unified diff convention: an empty side starts at the line before (0 for a new file).
    const aStart = firstA ?? (aLen === 0 ? prevLine(lines, start, 'a') : 1);
    const bStart = firstB ?? (bLen === 0 ? prevLine(lines, start, 'b') : 1);
    hunks.push({ aStart, aLen, bStart, bLen, lines: slice });
    i = j;
  }
  return hunks;
}

function prevLine(lines: readonly DiffLine[], index: number, side: 'a' | 'b'): number {
  for (let k = index - 1; k >= 0; k--) {
    const n = lines[k][side];
    if (n !== null) return n;
  }
  return 0;
}

/** `@@ -a,n +b,m @@` then the lines with their ' ', '-' or '+' prefix. '' when nothing changed. */
export function formatHunks(hunks: readonly Hunk[]): string {
  const out: string[] = [];
  for (const h of hunks) {
    out.push(`@@ -${h.aStart},${h.aLen} +${h.bStart},${h.bLen} @@`);
    for (const l of h.lines) out.push(`${l.kind}${l.text}`);
  }
  return out.join('\n');
}

/** The unified diff of two versions of a file ('' when they are the same). */
export function unifiedDiff(before: string, after: string, context = CONTEXT_LINES): string {
  return formatHunks(diffHunks(before, after, context));
}

const HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

/** Reads a unified diff back into hunks, for display. Unknown lines are skipped. */
export function parseUnified(text: string): Hunk[] {
  const hunks: Hunk[] = [];
  let cur: Hunk | null = null;
  let a = 0;
  let b = 0;
  for (const raw of text.split('\n')) {
    const m = HEADER.exec(raw);
    if (m) {
      cur = { aStart: Number(m[1]), aLen: Number(m[2] ?? 1), bStart: Number(m[3]), bLen: Number(m[4] ?? 1), lines: [] };
      hunks.push(cur);
      a = cur.aLen === 0 ? cur.aStart + 1 : cur.aStart;
      b = cur.bLen === 0 ? cur.bStart + 1 : cur.bStart;
      continue;
    }
    if (!cur || raw === '') continue;
    const kind = raw[0];
    const body = raw.slice(1);
    if (kind === '+') cur.lines.push({ kind: '+', text: body, a: null, b: b++ });
    else if (kind === '-') cur.lines.push({ kind: '-', text: body, a: a++, b: null });
    else if (kind === ' ') cur.lines.push({ kind: ' ', text: body, a: a++, b: b++ });
  }
  return hunks;
}

/** A piece of a changed line; `changed` marks the words that differ from its partner line. */
export interface Segment {
  text: string;
  changed: boolean;
}

function segmentsOf(tokens: readonly string[], changed: readonly boolean[]): Segment[] {
  const out: Segment[] = [];
  tokens.forEach((text, i) => {
    const last = out[out.length - 1];
    if (last && last.changed === changed[i]) last.text += text;
    else out.push({ text, changed: changed[i] });
  });
  return out;
}

/**
 * The words that changed between a removed line and the added line that replaced it, so "2100" → "1800"
 * stands out. Lines that are mostly different come back unmarked (a highlight would say nothing).
 */
export function wordDiff(a: string, b: string): { a: Segment[]; b: Segment[] } | null {
  const tokenize = (s: string) => s.match(/\s+|[A-Za-z0-9_$]+|[^\sA-Za-z0-9_$]/g) ?? [];
  const ta = tokenize(a);
  const tb = tokenize(b);
  const changedA = new Array<boolean>(ta.length).fill(true);
  const changedB = new Array<boolean>(tb.length).fill(true);
  let same = 0;
  for (const r of diffLines(ta, tb, 400)) {
    if (r.op !== '=') continue;
    for (let i = 0; i < r.n; i++) {
      changedA[r.a + i] = false;
      changedB[r.b + i] = false;
      if (ta[r.a + i].trim()) same += ta[r.a + i].length;
    }
  }
  const total = Math.max(a.trim().length, b.trim().length);
  if (!total || same / total < 0.4) return null;
  return { a: segmentsOf(ta, changedA), b: segmentsOf(tb, changedB) };
}

/** Pairs each removed line with the added line that took its place (in order, inside one change). */
export function pairChangedLines(lines: readonly DiffLine[]): Map<number, number> {
  const pairs = new Map<number, number>();
  let i = 0;
  while (i < lines.length) {
    if (lines[i].kind !== '-') {
      i++;
      continue;
    }
    const dels: number[] = [];
    while (i < lines.length && lines[i].kind === '-') dels.push(i++);
    const adds: number[] = [];
    while (i < lines.length && lines[i].kind === '+') adds.push(i++);
    for (let k = 0; k < Math.min(dels.length, adds.length); k++) {
      pairs.set(dels[k], adds[k]);
      pairs.set(adds[k], dels[k]);
    }
  }
  return pairs;
}

export function countHunkChanges(hunks: readonly Hunk[]): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const h of hunks) {
    for (const l of h.lines) {
      if (l.kind === '+') added++;
      else if (l.kind === '-') removed++;
    }
  }
  return { added, removed };
}

/** Per changed file: its unified diff (a file that appeared or went away diffs against nothing). */
export function codeDiff(before: readonly CodeFile[], after: readonly CodeFile[]): StepDiff['files'] {
  const paths = [...new Set([...after.map((f) => f.path), ...before.map((f) => f.path)])];
  const order = (p: string) => (p === 'game.js' ? 1 : 0);
  paths.sort((x, y) => order(x) - order(y) || x.localeCompare(y));
  const out: StepDiff['files'] = [];
  for (const path of paths) {
    const a = before.find((f) => f.path === path)?.source ?? '';
    const b = after.find((f) => f.path === path)?.source ?? '';
    if (a === b) continue;
    out.push({ path, hunks: unifiedDiff(a, b) });
  }
  return out;
}

/** How many lines a change inserted or changed across files (the footstep's `lines`). */
export function linesWritten(before: readonly CodeFile[], after: readonly CodeFile[]): number {
  let n = 0;
  for (const file of after) {
    const prev = before.find((f) => f.path === file.path);
    if (prev?.source === file.source) continue;
    for (const r of diffLines(linesOf(prev?.source ?? ''), linesOf(file.source))) if (r.op === '+') n += r.n;
  }
  return n;
}

function stickerOf(snap: StepSnapshot | null, key: CastKey): { art: ArtId | null; sticker: BlobRef | null; hash: string | null } {
  const art = snap?.cast[key]?.art ?? null;
  const entry = art ? snap?.art[art] : undefined;
  return { art, sticker: entry?.export?.sticker ?? null, hash: entry?.export?.hash ?? null };
}

/** Cast members whose drawing changed: new, redrawn, or back to just bones. */
export function drawingDiff(before: StepSnapshot | null, after: StepSnapshot): StepDiff['drawings'] {
  const keys = [...new Set([...Object.keys(after.cast), ...Object.keys(before?.cast ?? {})])];
  const out: StepDiff['drawings'] = [];
  for (const key of keys) {
    const a = stickerOf(before, key);
    const b = stickerOf(after, key);
    const same = a.art === b.art && a.hash === b.hash && a.sticker === b.sticker;
    if (same || (a.sticker === null && b.sticker === null)) continue;
    out.push({ key, before: a.sticker, after: b.sticker });
  }
  return out;
}

/** Dials that moved; a dial without a student value is at the game's default (`defaults`). */
export function dialDiff(before: Record<string, number> | null, after: Record<string, number>, defaults: Record<string, number> = {}): StepDiff['dials'] {
  const keys = [...new Set([...Object.keys(after), ...Object.keys(before ?? {})])].sort();
  const out: StepDiff['dials'] = [];
  for (const key of keys) {
    const a = before?.[key] ?? defaults[key];
    const b = after[key] ?? defaults[key];
    if (a === undefined || b === undefined || a === b) continue;
    out.push({ key, before: a, after: b });
  }
  return out;
}

export function twistDiff(before: readonly TwistId[] | null, after: readonly TwistId[]): { on: TwistId[]; off: TwistId[] } {
  const was = new Set(before ?? []);
  const now = new Set(after);
  return { on: after.filter((t) => !was.has(t)), off: [...was].filter((t) => !now.has(t)) };
}

/**
 * `HistoryApi.diff` from two loaded snapshots. `before` is the step's parent; without it (the first step,
 * or a parent whose snapshot is gone) there is nothing to compare, so the diff is empty.
 */
export function stepDiff(before: StepSnapshot | null, after: StepSnapshot, defaults: Record<string, number> = {}): StepDiff {
  if (!before) return { files: [], drawings: [], dials: [] };
  return {
    files: codeDiff(before.code, after.code),
    drawings: drawingDiff(before, after),
    dials: dialDiff(before.dials, after.dials, defaults),
  };
}
