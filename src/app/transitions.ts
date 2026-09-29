/**
 * Screen transitions (§2.2, §3.6): same-document View Transitions with named elements (world sign ↔ world
 * view, cast card ↔ Desk sheet, placeholder ↔ Desk sheet), 360 ms ease-amble. Without support, or under
 * reduced motion, screens crossfade in 150 ms (CSS on `.screen`).
 */

type StartViewTransition = (update: () => void | Promise<void>) => { finished: Promise<void>; ready: Promise<void> };

function reducedMotion(): boolean {
  return typeof document !== 'undefined' && document.documentElement.dataset.motion === 'reduced';
}

/** Whether a route change will morph with a View Transition. */
export function canTransition(): boolean {
  if (typeof document === 'undefined' || reducedMotion() || document.visibilityState !== 'visible') return false;
  return typeof (document as Document & { startViewTransition?: StartViewTransition }).startViewTransition === 'function';
}

/** Runs a DOM update inside a View Transition when possible; otherwise just runs it. */
export function withViewTransition(update: () => void): void {
  if (!canTransition()) {
    update();
    return;
  }
  const start = (document as Document & { startViewTransition: StartViewTransition }).startViewTransition.bind(document);
  try {
    start(update).finished.catch(() => undefined);
  } catch {
    update();
  }
}

/** Gives an element a View Transition name while it is on screen (null clears it). */
export function transitionName(el: HTMLElement | null, name: string | null): void {
  if (el) el.style.setProperty('view-transition-name', name ?? 'none');
}
