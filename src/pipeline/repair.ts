/**
 * What a repair request carries (§5.8 `fix`): at most 5 errors as `file:line:col phase: message (×n)`,
 * ±15 numbered lines around each, the kit signatures of the calls on those lines, and the last warnings.
 */
import type { Issue, SourceFile } from '../cores/ai';
import { kitDocs, signatureOf } from './kit';
import type { FixError, UserMessageInput } from './userMessage';

export const MAX_ERRORS = 5;
const AROUND = 15;

export function errorsFromIssues(issues: readonly Issue[]): FixError[] {
  return issues.slice(0, MAX_ERRORS).map((i) => ({ file: i.file, line: i.line, column: i.column, phase: 'validate', message: i.message, count: 1 }));
}

/** Numbered windows of ±15 lines around the errors, merged where they overlap. */
export function excerpts(files: readonly SourceFile[], errors: readonly FixError[]): string {
  const out: string[] = [];
  const byFile = new Map<string, number[]>();
  for (const e of errors) if (e.line > 0) byFile.set(e.file, [...(byFile.get(e.file) ?? []), e.line]);
  for (const [path, lines] of byFile) {
    const file = files.find((f) => f.path === path);
    if (!file) continue;
    const all = file.content.replace(/\n$/, '').split('\n');
    const marks = new Set(lines);
    const windows: Array<[number, number]> = [];
    for (const l of [...marks].sort((a, b) => a - b)) {
      const from = Math.max(1, l - AROUND);
      const to = Math.min(all.length, l + AROUND);
      const last = windows[windows.length - 1];
      if (last && from <= last[1] + 1) last[1] = Math.max(last[1], to);
      else windows.push([from, to]);
    }
    for (const [from, to] of windows) {
      const width = String(to).length;
      out.push(`${path} lines ${from}-${to}:`);
      for (let n = from; n <= to; n++) out.push(`${marks.has(n) ? '>' : ' '}${String(n).padStart(width + 1)} | ${all[n - 1] ?? ''}`);
    }
  }
  return out.join('\n');
}

/** Kit calls on and next to the error lines (±2), with their signatures. Helpers reach the kit through a scene. */
export function signaturesOn(files: readonly SourceFile[], errors: readonly FixError[]): string[] {
  const docs = kitDocs();
  const out = new Set<string>();
  for (const e of errors) {
    const file = files.find((f) => f.path === e.file);
    if (!file || e.line < 1) continue;
    const all = file.content.split('\n');
    const text = all.slice(Math.max(0, e.line - 3), e.line + 2).join('\n');
    for (const m of text.matchAll(/\b(\w+)\.(\w+)\.(\w+)\s*\(/g)) {
      if (!docs.namespaces[m[2]]) continue;
      const sig = signatureOf(`this.${m[2]}.${m[3]}`, docs);
      if (sig) out.add(sig);
    }
    for (const m of text.matchAll(/\bthis\.(\w+)\s*\(/g)) {
      const sig = signatureOf(`this.${m[1]}`, docs);
      if (sig) out.add(sig);
    }
    for (const m of text.matchAll(/\.(\w+)\s*\(/g)) {
      if (docs.actor.some((a) => a.name === m[1])) {
        const sig = signatureOf(m[1], docs);
        if (sig) out.add(sig);
      }
    }
  }
  return [...out].slice(0, 8);
}

export function fixPart(files: readonly SourceFile[], errors: readonly FixError[], warnings: readonly string[]): NonNullable<UserMessageInput['fix']> {
  const top = errors.slice(0, MAX_ERRORS);
  return { errors: top, excerpts: excerpts(files, top), signatures: signaturesOn(files, top), warnings: warnings.slice(-5) };
}
