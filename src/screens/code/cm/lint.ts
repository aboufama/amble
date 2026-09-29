/**
 * Diagnostics in Look inside (§2.12, §5.7): the game validator runs over every file 300 ms after typing
 * stops; its kid-readable messages become gutter icons and squiggles, with **Fix** when the validator has
 * an auto-fix. A Fix applies only the fixed lines near the problem (or the whole file's fix when its
 * change lives elsewhere, like a new entry in `static art`), as an ordinary undoable edit.
 */
import type { Diagnostic } from '@codemirror/lint';
import type { Text } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { kitManifest, validateGame, type Issue, type SourceFile } from '../../../cores/ai';
import { lineChanges, nearLine } from './lineEdits';

export interface CodeIssue {
  file: string;
  line: number;
  column: number;
  severity: 'error' | 'warning';
  rule: string;
  /** Plain words for a student (no "Line 12:" prefix: the editor shows where). */
  message: string;
  /** The file with the validator's auto-fixes, when one exists for this problem. */
  fixed: string | null;
  /** From the running game rather than the validator. */
  runtime?: boolean;
}

export interface LintReport {
  issues: CodeIssue[];
  errors: number;
}

/** "Line 12: the computer can't read…" → "The computer can't read…". */
export function kidText(issue: Pick<Issue, 'kid' | 'message'>): string {
  const text = (issue.kid || issue.message).replace(/^Line \d+:\s*/, '').trim();
  return text ? text[0].toUpperCase() + text.slice(1) : text;
}

/** Validates the whole game (every file together, as it will run) and lists the problems per file. */
export function lintSources(files: readonly SourceFile[]): LintReport {
  if (!files.length) return { issues: [], errors: 0 };
  const manifest = kitManifest();
  const plain = validateGame([...files], { manifest, fix: false });
  const fixed = validateGame([...files], { manifest, fix: true });
  const fixedBy = (issue: Issue): string | null => {
    if (!fixed.fixes.some((f) => f.rule === issue.rule && f.file === issue.file)) return null;
    const after = fixed.files.find((f) => f.path === issue.file)?.content;
    const before = files.find((f) => f.path === issue.file)?.content;
    return after !== undefined && after !== before ? after : null;
  };
  const issues: CodeIssue[] = [...plain.errors, ...plain.warnings].map((issue) => ({
    file: issue.file,
    line: issue.line,
    column: issue.column,
    severity: issue.severity,
    rule: issue.rule,
    message: kidText(issue),
    fixed: fixedBy(issue),
  }));
  issues.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'error' ? -1 : 1) || a.file.localeCompare(b.file) || a.line - b.line);
  return { issues, errors: plain.errors.length };
}

function messageDom(text: string): HTMLElement {
  const dom = document.createElement('span');
  dom.className = 'cm-kid-message';
  // "names" in the validator's words read as code.
  for (const part of text.split(/("[^"\n]{1,60}")/)) {
    if (/^"[^"]+"$/.test(part)) {
      const code = document.createElement('code');
      code.textContent = part.slice(1, -1);
      dom.append(code);
    } else dom.append(part);
  }
  return dom;
}

/** One problem as a CodeMirror diagnostic on the right line (squiggle under the word it's about). */
export function toDiagnostic(doc: Text, issue: CodeIssue, fixLabel: string, onFixed: () => void): Diagnostic {
  const lineNo = Math.min(Math.max(1, issue.line || 1), doc.lines);
  const line = doc.line(lineNo);
  let from = issue.column > 0 ? Math.min(line.to, line.from + issue.column - 1) : line.from;
  let to = from;
  while (to < line.to && /[A-Za-z0-9_$]/.test(doc.sliceString(to, to + 1))) to++;
  if (to === from) {
    from = line.from + (line.text.length - line.text.trimStart().length);
    to = line.to;
  }
  const fixed = issue.fixed;
  return {
    from,
    to,
    severity: issue.severity,
    source: issue.runtime ? undefined : 'Amble',
    message: issue.message,
    renderMessage: () => messageDom(issue.message),
    actions: fixed
      ? [
          {
            name: fixLabel,
            apply(view: EditorView) {
              const doc = view.state.doc;
              view.dispatch({ changes: lineChanges(doc, fixed, nearLine(doc, fixed, lineNo - 1)), userEvent: 'input.fix' });
              onFixed();
            },
          },
        ]
      : undefined,
  };
}
