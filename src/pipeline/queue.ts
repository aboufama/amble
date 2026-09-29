/**
 * Class hygiene (§5.2): one AI job per world at a time, and a random 0-3 s wait before a build's first
 * send, so 25 Chromebooks pressing Build at the same moment reach the district's proxy spread out. Retries
 * after 429 and 5xx live in the core's transport; their waits surface here as the "queued" phase.
 */
import type { WorldId } from '../model/types';

export const BUILD_JITTER_MS = 3000;

/** A wait in [0, 3000) ms (the student is drawing anyway). */
export function buildJitter(random: () => number = Math.random): number {
  return Math.floor(Math.max(0, Math.min(0.999, random())) * BUILD_JITTER_MS);
}

/** Waits `ms`, or stops early when `signal` aborts (resolves false then). */
export function pause(ms: number, signal: AbortSignal): Promise<boolean> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve(false);
    const done = (ok: boolean) => {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      resolve(ok);
    };
    const onAbort = () => done(false);
    const timer = setTimeout(() => done(true), ms);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

/** One running job per world; a second one waits its turn (the Ask card disables it anyway). */
export class JobLocks {
  private readonly busy = new Set<WorldId>();

  isBusy(world: WorldId): boolean {
    return this.busy.has(world);
  }

  /** A release function, or null when the world already has a job. */
  acquire(world: WorldId): (() => void) | null {
    if (this.busy.has(world)) return null;
    this.busy.add(world);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.busy.delete(world);
    };
  }
}
