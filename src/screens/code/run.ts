/**
 * Run it (§2.12): validate every file → load the world in a fresh realm from the warm spare → a footstep
 * "You changed boss.js". If static checks fail, the world keeps playing its last version and the student
 * learns where the first problem is. Lines the student changed are credited to them.
 *
 * Words the student types go on screen too, so they get the same local check as the words an AI change
 * would show (§5.13): new text the game would show is read by the output filter at the student's level, on
 * the Chromebook, with nothing sent anywhere. Flagged text keeps the change from running.
 */
import { isSupersededLoad } from '../../app/player/host';
import { checkOutputText, kitManifest, sourceFilesOf, validateGame } from '../../cores/ai';
import type { HistoryApi } from '../../history/api';
import { codeStepText } from '../../history/summary';
import type { CodeFile, Level, LineRange, World } from '../../model/types';
import { lintSources, type CodeIssue } from './cm/lint';

export interface FileEdit {
  source: string;
  locked: LineRange[];
}

export type RunCheck =
  | { kind: 'blocked'; errors: CodeIssue[] }
  /** The change would show words that aren't OK for school: the first one's place. */
  | { kind: 'words'; file: string; line: number }
  | { kind: 'ok'; code: CodeFile[]; changed: string[] };

/** The text a game shows (titles, names, asks, dialogue...), as the validator finds it. */
function shownText(code: readonly CodeFile[]) {
  return validateGame(sourceFilesOf(code), { manifest: kitManifest(), fix: false }).strings;
}

/**
 * The first piece of new text in `next` (text `prev` doesn't show) that the local output filter flags at this
 * level, or null. Text that was already there (a starter's, or an AI change's that passed its own check)
 * isn't read again.
 */
export function unkindWords(prev: readonly CodeFile[], next: readonly CodeFile[], level: Level): { file: string; line: number } | null {
  const before = new Set(shownText(prev).map((s) => s.text));
  const fresh = shownText(next).filter((s) => !before.has(s.text));
  const first = checkOutputText(fresh, level).flagged[0];
  return first ? { file: fresh[first.index].file, line: fresh[first.index].line } : null;
}

/** Applies the editor's text to the world's files and checks them the way the game will run. */
export function checkRun(world: World, edits: Readonly<Record<string, FileEdit>>, attribute: HistoryApi['attribute'], level: Level): RunCheck {
  const next = world.code.map((f) => (edits[f.path] ? { ...f, source: edits[f.path].source, locked: edits[f.path].locked } : f));
  const errors = lintSources(sourceFilesOf(next)).issues.filter((i) => i.severity === 'error');
  if (errors.length) return { kind: 'blocked', errors };
  const changed = next.filter((f) => world.code.find((w) => w.path === f.path)?.source !== f.source).map((f) => f.path);
  const words = changed.length ? unkindWords(world.code, next, level) : null;
  if (words) return { kind: 'words', ...words };
  return { kind: 'ok', code: attribute(world.code, next, 'student'), changed };
}

export interface RunDeps {
  history: Pick<HistoryApi, 'attribute' | 'record'>;
  /** Plays a world from the start of a fresh realm (rejects when the player can't start it). */
  play(world: World): Promise<unknown>;
  /** Puts the recorded world where the rest of the app reads it. */
  setWorld(world: World): void;
  /** The student's content level in this world (the class's, lowered by an assignment). */
  level: Level;
}

export type RunOutcome =
  | { kind: 'blocked'; errors: CodeIssue[] }
  | { kind: 'words'; file: string; line: number }
  | { kind: 'ran'; world: World; changed: string[] }
  | { kind: 'replayed'; world: World }
  | { kind: 'failed'; world: World }
  /** Another load (a newer version of the world) took the player first: nothing was recorded. */
  | { kind: 'superseded' };

export async function runIt(world: World, edits: Readonly<Record<string, FileEdit>>, deps: RunDeps): Promise<RunOutcome> {
  const check = checkRun(world, edits, deps.history.attribute, deps.level);
  if (check.kind === 'blocked' || check.kind === 'words') return check;
  if (!check.changed.length) {
    try {
      await deps.play(world);
    } catch (err) {
      return isSupersededLoad(err) ? { kind: 'superseded' } : { kind: 'failed', world };
    }
    return { kind: 'replayed', world };
  }
  const candidate: World = { ...world, code: check.code };
  try {
    await deps.play(candidate);
  } catch (err) {
    if (isSupersededLoad(err)) return { kind: 'superseded' };
    await deps.play(world).catch(() => undefined);
    return { kind: 'failed', world };
  }
  const recorded = await deps.history.record(candidate, { kind: 'code', by: 'student', text: codeStepText(check.changed), files: check.changed });
  deps.setWorld(recorded);
  return { kind: 'ran', world: recorded, changed: check.changed };
}
