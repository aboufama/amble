import { sourceUrlFor, warnOnce } from './bridge';

/**
 * Runaway-loop protection. The compiler inserts `if (__ambleGuardYield()) yield;`
 * at the top of every loop inside generator functions, and `__ambleGuardThrow()`
 * inside loops of normal functions. A loop that hogs a frame is forced to pause
 * (or, where it can't pause, is stopped) instead of freezing the page.
 */
let frameStart = typeof performance !== 'undefined' ? performance.now() : 0;
let forcedYields = 0;

export function beginFrame(): void {
  frameStart = performance.now();
}

export function guardYield(): boolean {
  if (performance.now() - frameStart < 60) return false;
  forcedYields++;
  if (forcedYields === 30) {
    warnOnce('A loop kept running without pausing, so Amble paused it for you. Loops that run every frame should `yield`.');
  }
  return true;
}

export function guardThrow(): void {
  if (performance.now() - frameStart > 2500) {
    throw new Error('A loop ran for more than 2.5 seconds without pausing, so it was stopped.');
  }
}

/** Timers created by game code, so Stop can cancel them. */
const timeouts = new Set<number>();
const intervals = new Set<number>();
const frames = new Set<number>();

export const gameTimers = {
  setTimeout(fn: (...args: unknown[]) => void, ms?: number, ...args: unknown[]): number {
    const id = window.setTimeout(() => {
      timeouts.delete(id);
      fn(...args);
    }, ms);
    timeouts.add(id);
    return id;
  },
  clearTimeout(id: number): void {
    timeouts.delete(id);
    window.clearTimeout(id);
  },
  setInterval(fn: (...args: unknown[]) => void, ms?: number, ...args: unknown[]): number {
    const id = window.setInterval(fn, ms, ...args);
    intervals.add(id);
    return id;
  },
  clearInterval(id: number): void {
    intervals.delete(id);
    window.clearInterval(id);
  },
  requestAnimationFrame(fn: FrameRequestCallback): number {
    const id = window.requestAnimationFrame((t) => {
      frames.delete(id);
      fn(t);
    });
    frames.add(id);
    return id;
  },
  cancelAnimationFrame(id: number): void {
    frames.delete(id);
    window.cancelAnimationFrame(id);
  },
};

export function clearGameTimers(): void {
  timeouts.forEach((id) => window.clearTimeout(id));
  intervals.forEach((id) => window.clearInterval(id));
  frames.forEach((id) => window.cancelAnimationFrame(id));
  timeouts.clear();
  intervals.clear();
  frames.clear();
  forcedYields = 0;
}

/**
 * Evaluates one target's class declaration in a scope where `Sprite`/`Stage`
 * (or `Actor`/`World`) refer to that target's own base class.
 */
export function evaluateClass(
  code: string,
  className: string,
  targetName: string,
  scope: Record<string, unknown>,
): unknown {
  const names = Object.keys(scope);
  const body = `${code}\n;return ${className};\n//# sourceURL=${sourceUrlFor(targetName)}`;
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const factory = new Function(...names, body) as (...values: unknown[]) => unknown;
  return factory(...names.map((n) => scope[n]));
}

/** Names the compiled code may use that are provided by the sandbox. */
export function sandboxGlobals(): Record<string, unknown> {
  return {
    __ambleGuardYield: guardYield,
    __ambleGuardThrow: guardThrow,
    setTimeout: gameTimers.setTimeout,
    clearTimeout: gameTimers.clearTimeout,
    setInterval: gameTimers.setInterval,
    clearInterval: gameTimers.clearInterval,
    requestAnimationFrame: gameTimers.requestAnimationFrame,
    cancelAnimationFrame: gameTimers.cancelAnimationFrame,
    alert: (msg: unknown) => console.log(String(msg)),
  };
}
