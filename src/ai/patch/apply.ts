/**
 * Applies a patch's file operations to a game's files and returns a candidate file set; nothing is
 * written to the project here. A file whose edits don't apply is left as it was and reported, so
 * the caller can ask the model to send that one file whole ("resend with replace"); the other
 * files' changes still apply.
 */
import { ENTRY_FILE, isSafeGamePath, type GameFile } from '../gameFiles';
import { applyEdits, type EditFailureReason } from './edits';
import type { Edit, FileOp } from './types';

export interface ApplyFailure {
  path: string;
  reason: EditFailureReason | 'malformed' | 'missing-file' | 'bad-path' | 'delete-entry';
  /** 0-based index of the failing edit, for edit failures. */
  edit?: number;
  /** For the model: what went wrong, to put in the resend request. */
  message: string;
}

export interface ApplyResult {
  files: GameFile[];
  created: string[];
  changed: string[];
  deleted: string[];
  failures: ApplyFailure[];
  warnings: string[];
  /** Edits that matched only after ignoring indentation or blank lines. */
  fuzzyEdits: number;
}

export function applyPatch(files: readonly GameFile[], ops: readonly FileOp[], options: { entry?: string } = {}): ApplyResult {
  const entry = options.entry ?? ENTRY_FILE;
  const current = new Map(files.map((f) => [f.path, f.content]));
  const created = new Set<string>();
  const changed = new Set<string>();
  const deleted = new Set<string>();
  const failed = new Set<string>();
  const failures: ApplyFailure[] = [];
  const warnings: string[] = [];
  let fuzzyEdits = 0;

  for (const op of ops) {
    if (failed.has(op.path)) continue;
    if (!isSafeGamePath(op.path)) {
      failures.push({ path: op.path, reason: 'bad-path', message: `"${op.path}" is not a valid file name: use letters, digits, - and _, ending in .js.` });
      failed.add(op.path);
      continue;
    }
    const exists = current.has(op.path);
    switch (op.action) {
      case 'create':
      case 'replace':
        if (op.action === 'create' && exists) warnings.push(`${op.path} already existed; replaced it.`);
        if (op.action === 'replace' && !exists) warnings.push(`${op.path} didn't exist; created it.`);
        if (exists) changed.add(op.path);
        else created.add(op.path);
        deleted.delete(op.path);
        current.set(op.path, op.content);
        break;
      case 'delete':
        if (op.path === entry) {
          failures.push({ path: op.path, reason: 'delete-entry', message: `${entry} can't be deleted: every game needs it.` });
          failed.add(op.path);
        } else if (exists) {
          current.delete(op.path);
          deleted.add(op.path);
          created.delete(op.path);
          changed.delete(op.path);
        } else warnings.push(`${op.path} was already gone.`);
        break;
      case 'edit': {
        if (op.malformed.length) {
          failures.push({ path: op.path, reason: 'malformed', message: `The edits for ${op.path} couldn't be read (${op.malformed[0]}).` });
          failed.add(op.path);
          break;
        }
        const content = current.get(op.path);
        if (content === undefined) {
          failures.push({ path: op.path, reason: 'missing-file', message: `${op.path} doesn't exist, so it can't be edited. Send it whole with create.` });
          failed.add(op.path);
          break;
        }
        const r = applyEdits(content, op.edits);
        if (!r.ok) {
          failures.push({ path: op.path, reason: r.failure.reason, edit: r.failure.index, message: `${op.path}: ${r.failure.message}` });
          failed.add(op.path);
          break;
        }
        fuzzyEdits += r.fuzzy;
        if (r.content !== content) {
          current.set(op.path, r.content);
          if (!created.has(op.path)) changed.add(op.path);
        }
        break;
      }
    }
  }

  // A file that failed keeps its original content, even if an earlier op in this patch changed it.
  for (const path of failed) {
    const original = files.find((f) => f.path === path);
    if (original) current.set(path, original.content);
    else current.delete(path);
    created.delete(path);
    changed.delete(path);
    deleted.delete(path);
  }

  // Entry last: it loads after the helper files.
  const order = [...current.keys()].sort((a, b) => (a === entry ? 1 : b === entry ? -1 : a.localeCompare(b)));
  return {
    files: order.map((path) => ({ path, content: current.get(path) as string })),
    created: [...created],
    changed: [...changed],
    deleted: [...deleted],
    failures,
    warnings,
    fuzzyEdits,
  };
}

/** Structured replies (strict JSON) as file operations: whole files, per-file edits, deletions. */
export function opsFromReply(reply: {
  files?: ReadonlyArray<{ path: string; content: string }>;
  edits?: ReadonlyArray<{ path: string; ops?: readonly Edit[]; edits?: readonly Edit[] }>;
  deleted?: readonly string[];
}): FileOp[] {
  return [
    ...(reply.files ?? []).map((f): FileOp => ({ action: 'create', path: f.path, content: f.content.endsWith('\n') ? f.content : `${f.content}\n` })),
    ...(reply.edits ?? []).map((e): FileOp => ({ action: 'edit', path: e.path, edits: [...(e.ops ?? e.edits ?? [])], malformed: [] })),
    ...(reply.deleted ?? []).map((path): FileOp => ({ action: 'delete', path })),
  ];
}
