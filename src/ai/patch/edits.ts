/**
 * Applies find/replace edits to one file. Each `find` is looked for:
 *   1. exactly;
 *   2. line by line with indentation and trailing spaces ignored (the replacement is re-indented);
 *   3. line by line with blank lines ignored too.
 * A find that matches more than once is resolved by position (edits come in file order, so the
 * first match after the previous edit) only when it has at least two non-blank lines; a shorter
 * one is ambiguous. Anything unresolved is a failure the caller turns into a whole-file retry.
 */
import type { Edit } from './types';

export type EditFailureReason = 'not-found' | 'ambiguous' | 'empty-find';

export interface EditFailure {
  /** 0-based index of the edit that failed. */
  index: number;
  reason: EditFailureReason;
  message: string;
}

export type EditsResult = { ok: true; content: string; fuzzy: number } | { ok: false; failure: EditFailure };

interface Match {
  /** Character range in the content. */
  start: number;
  end: number;
  /** Replacement text, re-indented when the match was by lines. */
  text: string;
  fuzzy: boolean;
}

function indentOf(line: string): string {
  return /^[ \t]*/.exec(line)?.[0] ?? '';
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

/** The indentation step these lines use: a tab, or the common multiple of their leading spaces. */
function indentUnit(lines: readonly string[]): string {
  let tabs = 0;
  let spaced = 0;
  let step = 0;
  for (const l of lines) {
    const ind = indentOf(l);
    if (!l.trim() || !ind) continue;
    if (ind.startsWith('\t')) tabs++;
    else {
      spaced++;
      step = gcd(step, ind.length);
    }
  }
  return tabs > spaced ? '\t' : ' '.repeat(step || 2);
}

function levels(ind: string, unit: string): number {
  const tabs = (ind.match(/\t/g) ?? []).length;
  const spaces = ind.length - tabs;
  return unit === '\t' ? tabs + spaces / 4 : (spaces + tabs * unit.length) / unit.length;
}

/**
 * Moves lines from one indentation to another, keeping their relative indentation. When the
 * replacement indents with spaces and the file with tabs (or the other way), levels are converted.
 */
function reindent(lines: string[], from: string, to: string, fileUnit: string): string[] {
  if (from === to) return lines;
  const srcUnit = indentUnit([from + 'x', ...lines]);
  if ((srcUnit === '\t') === (fileUnit === '\t')) {
    const unit = fileUnit === '\t' ? '\t' : ' ';
    const delta = to.length - from.length;
    return lines.map((l) => {
      if (!l.trim()) return l;
      if (l.startsWith(from)) return to + l.slice(from.length);
      const ind = indentOf(l);
      return unit.repeat(Math.max(0, ind.length + delta)) + l.slice(ind.length);
    });
  }
  const base = levels(from, srcUnit);
  return lines.map((l) => {
    if (!l.trim()) return l;
    const rel = Math.round(levels(indentOf(l), srcUnit) - base);
    const indent = rel >= 0 ? to + fileUnit.repeat(rel) : to.slice(0, Math.max(0, to.length + rel * fileUnit.length));
    return indent + l.trimStart();
  });
}

/** Character offset of the start of each line, plus the end of the text. */
function lineStarts(content: string): number[] {
  const starts = [0];
  for (let i = 0; i < content.length; i++) if (content[i] === '\n') starts.push(i + 1);
  return starts;
}

function nonBlankCount(text: string): number {
  return text.split('\n').filter((l) => l.trim()).length;
}

/** Finds all exact occurrences. */
function exactMatches(content: string, find: string, replace: string): Match[] {
  const out: Match[] = [];
  for (let i = content.indexOf(find); i >= 0; i = content.indexOf(find, i + 1)) out.push({ start: i, end: i + find.length, text: replace, fuzzy: false });
  return out;
}

/** Line windows that match with each line trimmed; with `skipBlank`, blank lines are ignored on both sides. */
function lineMatches(content: string, find: string, replace: string, skipBlank: boolean): Match[] {
  const lines = content.split('\n');
  const starts = lineStarts(content);
  const findLines = find.split('\n');
  while (findLines.length && !findLines[0].trim()) findLines.shift();
  while (findLines.length && !findLines[findLines.length - 1].trim()) findLines.pop();
  const want = findLines.filter((l) => !skipBlank || l.trim()).map((l) => l.trim());
  if (!want.length || want.every((l) => !l)) return [];
  const out: Match[] = [];
  for (let first = 0; first < lines.length; first++) {
    if (lines[first].trim() !== want[0]) continue;
    let li = first;
    let wi = 0;
    let ok = true;
    while (wi < want.length) {
      if (li >= lines.length) {
        ok = false;
        break;
      }
      if (skipBlank && !lines[li].trim()) {
        li++;
        continue;
      }
      if (lines[li].trim() !== want[wi]) {
        ok = false;
        break;
      }
      li++;
      wi++;
    }
    if (!ok) continue;
    const last = li - 1;
    const findFirst = findLines[0] ?? '';
    const text = reindent(replace.split('\n'), indentOf(findFirst), indentOf(lines[first]), indentUnit(lines)).join('\n');
    // The window is whole lines, without the final newline.
    out.push({ start: starts[first], end: starts[last] + lines[last].length, text, fuzzy: true });
  }
  return out;
}

function pick(matches: Match[], cursor: number, find: string): Match | 'ambiguous' | null {
  if (matches.length === 0) return null;
  if (matches.length === 1) return matches[0];
  if (nonBlankCount(find) < 2) return 'ambiguous';
  return matches.find((m) => m.start >= cursor) ?? 'ambiguous';
}

/** An emptied line range also takes its line break with it, so a deletion leaves no blank line. */
function splice(content: string, m: Match): { content: string; end: number } {
  let { start, end } = m;
  const wholeLines = (start === 0 || content[start - 1] === '\n') && (end === content.length || content[end] === '\n');
  if (m.text === '' && wholeLines) {
    if (content[end] === '\n') end++;
    else if (start > 0) start--;
  }
  return { content: content.slice(0, start) + m.text + content.slice(end), end: start + m.text.length };
}

export function applyEdits(content: string, edits: readonly Edit[]): EditsResult {
  let text = content.replace(/\r\n/g, '\n');
  let cursor = 0;
  let fuzzy = 0;
  for (const [index, edit] of edits.entries()) {
    const find = edit.find.replace(/\r\n/g, '\n');
    const replace = edit.replace.replace(/\r\n/g, '\n');
    if (!find.trim()) return { ok: false, failure: { index, reason: 'empty-find', message: `Edit ${index + 1} has an empty @@find.` } };
    let chosen: Match | null = null;
    for (const matches of [() => exactMatches(text, find, replace), () => lineMatches(text, find, replace, false), () => lineMatches(text, find, replace, true)]) {
      const found = pick(matches(), cursor, find);
      if (found === 'ambiguous') {
        const n = matches().length;
        return { ok: false, failure: { index, reason: 'ambiguous', message: `Edit ${index + 1}: the @@find text appears ${n} times; include more lines so it matches once.` } };
      }
      if (found) {
        chosen = found;
        break;
      }
    }
    if (!chosen) {
      const firstLine = find.split('\n').find((l) => l.trim())?.trim() ?? '';
      return { ok: false, failure: { index, reason: 'not-found', message: `Edit ${index + 1}: the @@find text is not in the file (it starts "${firstLine.slice(0, 60)}").` } };
    }
    if (chosen.fuzzy) fuzzy++;
    const r = splice(text, chosen);
    text = r.content;
    cursor = r.end;
  }
  return { ok: true, content: text, fuzzy };
}
