/**
 * Applying a reply's file operations to the files the model saw (§5.6): the core's tolerant applier,
 * the app's stricter file names, and the build's special case. Nothing here touches the world: the result
 * is a candidate that still has to pass validation and the robot test.
 */
import { applyPatch, type ApplyFailure, type FileOp, type SourceFile } from '../cores/ai';
import { CODE_PATH_RE } from '../model/ids';
import type { CodeFile } from '../model/types';

export interface Applied {
  files: SourceFile[];
  failures: ApplyFailure[];
  changed: string[];
  created: string[];
  deleted: string[];
}

export function toSource(files: readonly CodeFile[]): SourceFile[] {
  return files.map((f) => ({ path: f.path, content: f.source }));
}

/** Helper files first (alphabetical), game.js last. */
export function ordered<T extends { path: string }>(files: readonly T[]): T[] {
  return [...files].sort((a, b) => (a.path === 'game.js' ? 1 : b.path === 'game.js' ? -1 : a.path.localeCompare(b.path)));
}

function topLevelNames(source: string): string[] {
  return [...source.matchAll(/^(?:class|function|const|let|var)\s+([A-Za-z_$][\w$]*)/gm)].map((m) => m[1]);
}

export function applyOps(base: readonly SourceFile[], ops: readonly FileOp[], o: { build?: boolean } = {}): Applied {
  const bad = ops.filter((op) => !CODE_PATH_RE.test(op.path));
  const good = ops.filter((op) => CODE_PATH_RE.test(op.path));
  const r = applyPatch(base, good);
  let files = r.files;
  // A build that writes a new game.js starts clean: starter helpers it no longer uses would only clash.
  if (o.build && good.some((op) => op.path === 'game.js' && (op.action === 'create' || op.action === 'replace'))) {
    const touched = new Set(good.map((op) => op.path));
    const game = files.find((f) => f.path === 'game.js')?.content ?? '';
    files = files.filter((f) => f.path === 'game.js' || touched.has(f.path) || topLevelNames(f.content).some((n) => new RegExp(`\\b${n}\\b`).test(game)));
  }
  const failures: ApplyFailure[] = [
    ...bad.map((op): ApplyFailure => ({ path: op.path, reason: 'bad-path', message: `"${op.path}" is not a valid file name: use lowercase letters, digits and dashes, ending in .js.` })),
    ...r.failures,
  ];
  return { files: ordered(files), failures, changed: r.changed, created: r.created, deleted: r.deleted };
}

/** The edits a reply made to one file, as text for a resend request (so the model can redo them whole). */
export function editsText(ops: readonly FileOp[], path: string, maxLines = 80): string {
  const lines: string[] = [];
  for (const op of ops) {
    if (op.path !== path || op.action !== 'edit') continue;
    for (const e of op.edits) lines.push('@@find', ...e.find.split('\n'), '@@replace', ...e.replace.split('\n'), '@@done');
  }
  return lines.length > maxLines ? `${lines.slice(0, maxLines).join('\n')}\n(and more)` : lines.join('\n');
}

/** Later operations on a path win (a continue's `replace` supersedes the cut-off block). */
export function mergeOps(first: readonly FileOp[], second: readonly FileOp[]): FileOp[] {
  const later = new Set(second.map((op) => op.path));
  return [...first.filter((op) => !later.has(op.path) || op.action === 'edit'), ...second];
}
