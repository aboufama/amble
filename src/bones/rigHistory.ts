/**
 * The Bones view's undo stack (§7.11): every edit pushes the previous bones, Undo and Redo walk the
 * stack. Pure and immutable, so React can hold it and tests can reason about it.
 *
 * Bursts coalesce into one step: arrow-key nudges on one star, or one slider drag, that come within
 * `COALESCE_MS` of each other and share a `coalesce` key replace the newest step instead of adding one.
 */

/** At least 100 steps (§7.6's promise for drawings holds for bones too). */
export const HISTORY_LIMIT = 100;
/** A burst of nudges or slider moves closer together than this is one step. */
export const COALESCE_MS = 1200;

export interface UndoStack<T> {
  readonly past: readonly T[];
  readonly present: T;
  readonly future: readonly T[];
  /** The burst the newest step belongs to, and when it last grew. */
  readonly burst: { key: string; at: number } | null;
}

export interface CommitOptions {
  /** Steps with the same key within `COALESCE_MS` merge into one. */
  coalesce?: string;
  /** Replaces the newest step: a follow-up of the same action (Magic bones, then the AI helper's hints). */
  replace?: boolean;
  /** The time of this edit (tests pass it). */
  now?: number;
}

export function createStack<T>(present: T): UndoStack<T> {
  return { past: [], present, future: [], burst: null };
}

/**
 * Makes `next` the present. The old present goes onto the past (unless the edit continues the newest
 * burst), and the future is dropped. Committing the same value changes nothing.
 */
export function commit<T>(s: UndoStack<T>, next: T, o: CommitOptions = {}): UndoStack<T> {
  if (Object.is(next, s.present)) return s;
  const now = o.now ?? Date.now();
  const burstGoesOn = !!o.coalesce && !!s.burst && s.burst.key === o.coalesce && now - s.burst.at < COALESCE_MS;
  const continues = (!!o.replace || burstGoesOn) && s.past.length > 0;
  const burst = o.coalesce ? { key: o.coalesce, at: now } : null;
  if (continues) return { past: s.past, present: next, future: [], burst };
  const past = [...s.past, s.present];
  if (past.length > HISTORY_LIMIT) past.splice(0, past.length - HISTORY_LIMIT);
  return { past, present: next, future: [], burst };
}

export function canUndo<T>(s: UndoStack<T>): boolean {
  return s.past.length > 0;
}

export function canRedo<T>(s: UndoStack<T>): boolean {
  return s.future.length > 0;
}

export function undo<T>(s: UndoStack<T>): UndoStack<T> {
  if (!s.past.length) return s;
  const past = s.past.slice(0, -1);
  return { past, present: s.past[s.past.length - 1], future: [s.present, ...s.future], burst: null };
}

export function redo<T>(s: UndoStack<T>): UndoStack<T> {
  if (!s.future.length) return s;
  const [next, ...future] = s.future;
  return { past: [...s.past, s.present], present: next, future, burst: null };
}

/** Ends a burst, so the next nudge or slider move starts a new step (a joint was dropped, focus moved). */
export function settle<T>(s: UndoStack<T>): UndoStack<T> {
  return s.burst ? { ...s, burst: null } : s;
}
