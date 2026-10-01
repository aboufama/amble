import { reportError } from './bridge';

/** Anything that can own coroutines/timers; they stop when the owner is destroyed. */
export interface CoroutineOwner {
  readonly name: string;
  readonly destroyed: boolean;
}

export type CoroutineFn = () => Generator<unknown, unknown, unknown>;

export class Coroutine {
  done = false;
  constructor(
    readonly owner: CoroutineOwner | null,
    readonly label: string,
    private readonly gen: Generator<unknown, unknown, unknown>,
  ) {}

  stop(): void {
    if (this.done) return;
    this.done = true;
    try {
      this.gen.return(undefined);
    } catch {
      /* ignore errors from finally blocks */
    }
  }

  /** Advances the coroutine by one tick. */
  step(): void {
    if (this.done) return;
    if (this.owner?.destroyed) {
      this.stop();
      return;
    }
    try {
      const result = this.gen.next();
      if (result.done) this.done = true;
    } catch (err) {
      this.done = true;
      if (err !== STOP_GAME) reportError(err, { phase: 'run', target: this.owner?.name, script: this.label });
    }
  }
}

/** Thrown to unwind the current script when the game is stopped from inside a script. */
export const STOP_GAME = { reason: 'amble:stop-game' };

interface Timer {
  owner: CoroutineOwner | null;
  at: number;
  every: number | null;
  fn: () => void;
  label: string;
  cancelled: boolean;
}

export interface TimerHandle {
  cancel(): void;
}

/** Runs coroutines and timers on the game clock (fixed ticks), never on wall-clock time. */
export class Scheduler {
  private coroutines: Coroutine[] = [];
  private timers: Timer[] = [];

  /** Starts a coroutine and runs it immediately up to its first `yield` (like Unity's StartCoroutine). */
  start(owner: CoroutineOwner | null, label: string, gen: Generator<unknown, unknown, unknown>): Coroutine {
    const co = new Coroutine(owner, label, gen);
    co.step();
    if (!co.done) this.coroutines.push(co);
    return co;
  }

  after(owner: CoroutineOwner | null, now: number, seconds: number, fn: () => void, label: string): TimerHandle {
    return this.addTimer({ owner, at: now + Math.max(0, seconds), every: null, fn, label, cancelled: false });
  }

  every(owner: CoroutineOwner | null, now: number, seconds: number, fn: () => void, label: string): TimerHandle {
    const interval = Math.max(1 / 60, seconds);
    return this.addTimer({ owner, at: now + interval, every: interval, fn, label, cancelled: false });
  }

  private addTimer(timer: Timer): TimerHandle {
    this.timers.push(timer);
    return {
      cancel: () => {
        timer.cancelled = true;
      },
    };
  }

  /** Fires due timers. */
  runTimers(now: number): void {
    const due = this.timers.filter((t) => !t.cancelled && t.at <= now + 1e-9);
    for (const t of due) {
      if (t.owner?.destroyed) {
        t.cancelled = true;
        continue;
      }
      try {
        t.fn();
      } catch (err) {
        if (err !== STOP_GAME) reportError(err, { phase: 'run', target: t.owner?.name, script: t.label });
      }
      if (t.every !== null) t.at += t.every;
      else t.cancelled = true;
    }
    this.timers = this.timers.filter((t) => !t.cancelled && !t.owner?.destroyed);
  }

  /** Advances every live coroutine by one tick. */
  stepAll(): void {
    // Coroutines started during this pass run their first step immediately, so skip them here.
    const current = this.coroutines.slice();
    for (const co of current) co.step();
    this.coroutines = this.coroutines.filter((co) => !co.done);
  }

  stopOwnedBy(owner: CoroutineOwner): void {
    for (const co of this.coroutines) if (co.owner === owner) co.stop();
    for (const t of this.timers) if (t.owner === owner) t.cancelled = true;
  }

  clear(): void {
    for (const co of this.coroutines) co.stop();
    this.coroutines = [];
    this.timers = [];
  }

  get size(): number {
    return this.coroutines.length + this.timers.length;
  }
}

export function isGenerator(value: unknown): value is Generator<unknown, unknown, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Generator).next === 'function' &&
    typeof (value as Generator)[Symbol.iterator] === 'function'
  );
}
