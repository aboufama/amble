/**
 * Screen transitions (§2.2, §3.6): same-document View Transitions with named elements (world sign ↔ world
 * view, cast card ↔ Desk sheet, placeholder ↔ Desk sheet). Without support, under reduced motion, or
 * while the page is busy, screens just change (and fade in over 150 ms: CSS on `.screen-host`).
 *
 * A tap must answer at once. A View Transition first takes a picture of the old screen, which needs a
 * frame: on a busy page (a game on software GL, a heavy chunk loading) that frame came up to 4 s late,
 * and the change waited with it. So: the router updates the address before any transition; a page that
 * ran a long frame in the last second skips the transition; and a transition whose picture is not taken
 * within `CAPTURE_BUDGET_MS` is skipped and the change runs straight away.
 */

type Transition = { finished: Promise<void>; ready: Promise<void>; skipTransition(): void };
type StartViewTransition = (update: () => void | Promise<void>) => Transition;

/**
 * How long a transition may hold the old picture while the new screen loads the partner of a named element
 * (a screen's first visit shows React's loading fallback before the screen itself). Short: rendering is
 * held for this long.
 */
const PARTNER_WAIT_MS = 300;

/** How long the browser may take to picture the old screen before the change runs without a transition. */
export const CAPTURE_BUDGET_MS = 120;

/** A long frame or task this recent means the page is busy: changes run without a transition. */
const BUSY_WINDOW_MS = 1000;

/** Names given with `transitionName` since the last transition: their partners are on the next screen. */
let partners: string[] = [];
/** The transition that set `data-morph` last (an older one finishing must not clear a newer one's names). */
let morphs = 0;

/** When the last long animation frame (or long task) ended, in `performance.now()` time. */
let lastLong = -Infinity;
let watching = false;

/** Starts noting long frames (> 50 ms), so a busy page can skip transitions. Safe to call more than once. */
export function watchLongFrames(): void {
  if (watching || typeof PerformanceObserver === 'undefined') return;
  watching = true;
  const types = PerformanceObserver.supportedEntryTypes ?? [];
  const type = types.includes('long-animation-frame') ? 'long-animation-frame' : types.includes('longtask') ? 'longtask' : null;
  if (!type) return;
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) lastLong = Math.max(lastLong, e.startTime + e.duration);
    }).observe({ type, buffered: true });
  } catch {
    // An observer that cannot start leaves transitions on; the capture budget still keeps taps quick.
  }
}

if (typeof document !== 'undefined') watchLongFrames();

/** Whether the page ran a long frame in the last second (a transition's picture would come late). */
export function pageBusy(now: number = performance.now()): boolean {
  return now - lastLong < BUSY_WINDOW_MS;
}

/** For tests: when the last long frame ended. */
export function noteLongFrame(end: number): void {
  lastLong = Math.max(lastLong, end);
}

function reducedMotion(): boolean {
  return typeof document !== 'undefined' && document.documentElement.dataset.motion === 'reduced';
}

/** Whether a route change will morph with a View Transition. */
export function canTransition(): boolean {
  if (typeof document === 'undefined' || reducedMotion() || document.visibilityState !== 'visible') return false;
  if (typeof (document as Document & { startViewTransition?: StartViewTransition }).startViewTransition !== 'function') return false;
  return !pageBusy();
}

/**
 * Resolves once the new screen has rendered past its loading state (its lazy chunk, a world read from
 * storage), or after `ms`. A pair only morphs when both halves are in the pictures the browser takes.
 */
function screenLoaded(ms: number): Promise<void> {
  const end = performance.now() + ms;
  return new Promise((resolve) => {
    const check = () => {
      if (!document.querySelector('.screen--loading') || performance.now() >= end) resolve();
      else setTimeout(check, 16);
    };
    check();
  });
}

/**
 * Runs a DOM update inside a View Transition when possible; otherwise just runs it, at once. The update
 * runs exactly once either way. While a transition morphs named elements, `data-morph` on the root lists
 * their names, so their partners on the new screen can take the same names only then
 * (`:root[data-morph~='world-view'] .world-view`): a named element is a stacking context, which changes
 * how a screen layers.
 */
export function withViewTransition(update: () => void): void {
  const names = partners;
  partners = [];
  if (!canTransition()) {
    update();
    return;
  }
  const start = (document as Document & { startViewTransition: StartViewTransition }).startViewTransition.bind(document);
  const root = document.documentElement;
  const token = names.length ? ++morphs : 0;
  const done = () => {
    if (token && token === morphs) delete root.dataset.morph;
  };
  let ran = false;
  const runOnce = () => {
    if (ran) return;
    ran = true;
    update();
  };
  try {
    if (names.length) root.dataset.morph = names.join(' ');
    const transition = start(() => {
      runOnce();
      return names.length ? screenLoaded(PARTNER_WAIT_MS) : undefined;
    });
    transition.finished.then(done, done);
    // The picture of the old screen is late (a busy frame): skip the animation and change now.
    setTimeout(() => {
      if (ran) return;
      transition.skipTransition();
      runOnce();
    }, CAPTURE_BUDGET_MS);
  } catch {
    done();
    runOnce();
  }
}

/** Gives an element a View Transition name while it is on screen (null clears it). */
export function transitionName(el: HTMLElement | null, name: string | null): void {
  if (el) el.style.setProperty('view-transition-name', name ?? 'none');
  if (el && name && !partners.includes(name)) partners.push(name);
}
