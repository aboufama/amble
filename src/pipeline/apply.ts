/**
 * Applying a reply's file operations to the files the model saw (§5.6): the core's tolerant applier,
 * the app's stricter file names, and the build's special case. Nothing here touches the world: the result
 * is a candidate that still has to pass validation and the robot test.
 */
import { parse, type Node } from 'acorn';
import { ancestor } from 'acorn-walk';
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

/**
 * The names a file reads as variables: `volley(...)` and `FLOOR`, never a property, key or method name
 * (`this.volley(...)`, `volley() {}` in a class). A file that does not parse counts every word it contains.
 */
function namesUsed(source: string): (name: string) => boolean {
  let ast: Node;
  try {
    ast = parse(source, { ecmaVersion: 'latest', sourceType: 'script' });
  } catch {
    return (name) => new RegExp(`(?<![\\w$])${name.replace(/\$/g, '\\$')}(?![\\w$])`).test(source);
  }
  const used = new Set<string>();
  ancestor(ast, {
    Identifier(n, _s, anc) {
      const p = anc[anc.length - 2] as (Node & { property?: Node; key?: Node; computed?: boolean; shorthand?: boolean }) | undefined;
      if (p && p.type === 'MemberExpression' && p.property === n && !p.computed) return;
      if (p && (p.type === 'Property' || p.type === 'MethodDefinition' || p.type === 'PropertyDefinition') && p.key === n && !p.computed && !p.shorthand) return;
      used.add((n as Node & { name: string }).name);
    },
  });
  return (name) => used.has(name);
}

export function applyOps(base: readonly SourceFile[], ops: readonly FileOp[], o: { build?: boolean } = {}): Applied {
  const bad = ops.filter((op) => !CODE_PATH_RE.test(op.path));
  const good = ops.filter((op) => CODE_PATH_RE.test(op.path));
  const r = applyPatch(base, good);
  let files = r.files;
  // A build that writes a new game.js starts clean: starter helpers it no longer uses would only clash. A helper
  // stays only for a name the reply's files use and none of them declares: a starter's `const FLOOR` kept beside
  // the reply's own `const FLOOR` stops the whole game from loading.
  if (o.build && good.some((op) => op.path === 'game.js' && (op.action === 'create' || op.action === 'replace'))) {
    const touched = new Set(good.map((op) => op.path));
    const written = files.filter((f) => touched.has(f.path));
    const declared = new Set(written.flatMap((f) => topLevelNames(f.content)));
    const uses = written.map((f) => namesUsed(f.content));
    files = files.filter((f) => touched.has(f.path) || topLevelNames(f.content).some((n) => !declared.has(n) && uses.some((u) => u(n))));
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
