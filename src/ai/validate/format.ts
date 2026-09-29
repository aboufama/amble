/** Validator issues as text: for a repair prompt (model) and for the problem list (student). */
import type { Issue } from './types';

/** `game.js:12:5 error [unknown-api] ...` */
export function formatIssue(i: Issue): string {
  const where = i.line > 0 ? `${i.file}:${i.line}${i.column > 0 ? `:${i.column}` : ''}` : i.file;
  return `${where} ${i.severity} [${i.rule}] ${i.message}`;
}

/** Issues for a repair prompt, errors first, at most `max` lines. */
export function formatIssuesForModel(issues: readonly Issue[], max = 20): string {
  const sorted = [...issues].sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'error' ? -1 : 1));
  const lines = sorted.slice(0, max).map(formatIssue);
  if (issues.length > max) lines.push(`(${issues.length - max} more)`);
  return lines.join('\n');
}

/** Numbered lines around `line` (±`radius`), marking the line itself, for a repair prompt or a code view. */
export function codeFrame(content: string, line: number, radius = 15): string {
  const lines = content.split('\n');
  const from = Math.max(1, line - radius);
  const to = Math.min(lines.length, line + radius);
  const width = String(to).length;
  const out: string[] = [];
  for (let n = from; n <= to; n++) out.push(`${n === line ? '>' : ' '} ${String(n).padStart(width)} | ${lines[n - 1]}`);
  return out.join('\n');
}
