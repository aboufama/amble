/**
 * Screen transitions (§2.2, §3.6): same-document View Transitions with named elements (world sign ↔ world
 * view, cast card ↔ Desk sheet, placeholder ↔ Desk sheet), 360 ms ease-amble. Without support, or under
 * reduced motion, screens crossfade in 150 ms (CSS on `.screen`).
 */

type StartViewTransition = (update: () => void | Promise<void>) => { finished: Promise<void>; ready: Promise<void> };

/**
 * How long a transition may hold the old picture while the new screen loads the partner of a named element
 * (a screen's first visit shows React's loading fallback for at least 300 ms before the screen itself).
 */
const PARTNER_WAIT_MS = 800;
/**
 * The browser drops a transition whose update takes too long (4 s in Chrome, counted with the old picture's
 * capture, which is slow on a busy machine), so the wait for a partner ends within this much of the start.
 */
const UPDATE_BUDGET_MS = 2500;

/** Whether `transitionName` named an element since the last transition (its partner is on the next screen). */
let partners = false;

function reducedMotion(): boolean {
  return typeof document !== 'undefined' && document.documentElement.dataset.motion === 'reduced';
}

/** Whether a route change will morph with a View Transition. */
export function canTransition(): boolean {
  if (typeof document === 'undefined' || reducedMotion() || document.visibilityState !== 'visible') return false;
  return typeof (document as Document & { startViewTransition?: StartViewTransition }).startViewTransition === 'function';
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

/** Runs a DOM update inside a View Transition when possible; otherwise just runs it. */
export function withViewTransition(update: () => void): void {
  const waitForPartners = partners;
  partners = false;
  if (!canTransition()) {
    update();
    return;
  }
  const start = (document as Document & { startViewTransition: StartViewTransition }).startViewTransition.bind(document);
  const startedAt = performance.now();
  try {
    start(() => {
      update();
      const wait = waitForPartners ? Math.min(PARTNER_WAIT_MS, UPDATE_BUDGET_MS - (performance.now() - startedAt)) : 0;
      return wait > 0 ? screenLoaded(wait) : undefined;
    }).finished.catch(() => undefined);
  } catch {
    update();
  }
}

/** Gives an element a View Transition name while it is on screen (null clears it). */
export function transitionName(el: HTMLElement | null, name: string | null): void {
  if (el) el.style.setProperty('view-transition-name', name ?? 'none');
  if (el && name) partners = true;
}
