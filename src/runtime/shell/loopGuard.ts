/**
 * Loop guards for student code. The validator puts `Amble.__loop();` as the first statement of every loop
 * body in game files (line numbers unchanged). A loop that keeps one frame (or one event handler) busy for
 * more than 1.5 s throws "This loop never stops", which the error mapping points at the loop's line; the
 * editor's watchdog is the last resort for uninstrumented code.
 */

export const LOOP_LIMIT_MS = 1500;
/** A pause longer than this between guard calls starts a new burst of work (an event handler, a timer). */
const BURST_GAP_MS = 50;

let burstStart = 0;
let lastCall = -Infinity;
let tripped = false;

/** Called at the start of every game step and scene boot. */
export function loopFrameStart(): void {
  burstStart = performance.now();
  lastCall = burstStart;
  tripped = false;
}

export function loopGuard(): void {
  const t = performance.now();
  if (t - lastCall > BURST_GAP_MS) {
    burstStart = t;
    tripped = false;
  }
  lastCall = t;
  if (tripped || t - burstStart > LOOP_LIMIT_MS) {
    tripped = true;
    throw new Error('This loop never stops, so Amble stopped it.');
  }
}
