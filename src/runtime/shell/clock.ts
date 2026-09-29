/**
 * Real time for the kit's real-time effects (hit-stop and slow-mo durations, flash windows). In a robot
 * test the game runs on a manual clock, so "real" time is the manual clock too: the test is repeatable and
 * does not depend on how fast the machine steps it.
 */

let manualNow: number | null = null;

export function now(): number {
  return manualNow ?? performance.now();
}

export function useManualClock(start = 0): void {
  manualNow = start;
}

export function advanceManualClock(ms: number): void {
  if (manualNow !== null) manualNow += ms;
}

export function isManualClock(): boolean {
  return manualNow !== null;
}
