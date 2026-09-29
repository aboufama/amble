/**
 * Run it (§2.12): validate every file → load the world in a fresh realm from the warm spare → a footstep
 * "You changed boss.js". If static checks fail, the world keeps playing its last version and the student
 * learns where the first problem is. Lines the student changed are credited to them.
 */
import { sourceFilesOf } from '../../cores/ai';
import type { HistoryApi } from '../../history/api';
import { codeStepText } from '../../history/summary';
import type { CodeFile, LineRange, World } from '../../model/types';
import { lintSources, type CodeIssue } from './cm/lint';

export interface FileEdit {
  source: string;
  locked: LineRange[];
}

export type RunCheck = { kind: 'blocked'; errors: CodeIssue[] } | { kind: 'ok'; code: CodeFile[]; changed: string[] };

/** Applies the editor's text to the world's files and checks them the way the game will run. */
export function checkRun(world: World, edits: Readonly<Record<string, FileEdit>>, attribute: HistoryApi['attribute']): RunCheck {
  const next = world.code.map((f) => (edits[f.path] ? { ...f, source: edits[f.path].source, locked: edits[f.path].locked } : f));
  const errors = lintSources(sourceFilesOf(next)).issues.filter((i) => i.severity === 'error');
  if (errors.length) return { kind: 'blocked', errors };
  const changed = next.filter((f) => world.code.find((w) => w.path === f.path)?.source !== f.source).map((f) => f.path);
  return { kind: 'ok', code: attribute(world.code, next, 'student'), changed };
}

export interface RunDeps {
  history: Pick<HistoryApi, 'attribute' | 'record'>;
  /** Plays a world from the start of a fresh realm (rejects when the player can't start it). */
  play(world: World): Promise<unknown>;
  /** Puts the recorded world where the rest of the app reads it. */
  setWorld(world: World): void;
}

export type RunOutcome =
  | { kind: 'blocked'; errors: CodeIssue[] }
  | { kind: 'ran'; world: World; changed: string[] }
  | { kind: 'replayed'; world: World }
  | { kind: 'failed'; world: World };

export async function runIt(world: World, edits: Readonly<Record<string, FileEdit>>, deps: RunDeps): Promise<RunOutcome> {
  const check = checkRun(world, edits, deps.history.attribute);
  if (check.kind === 'blocked') return check;
  if (!check.changed.length) {
    await deps.play(world);
    return { kind: 'replayed', world };
  }
  const candidate: World = { ...world, code: check.code };
  try {
    await deps.play(candidate);
  } catch {
    await deps.play(world).catch(() => undefined);
    return { kind: 'failed', world };
  }
  const recorded = await deps.history.record(candidate, { kind: 'code', by: 'student', text: codeStepText(check.changed), files: check.changed });
  deps.setWorld(recorded);
  return { kind: 'ran', world: recorded, changed: check.changed };
}
