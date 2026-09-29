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

/** Names given with `transitionName` since the last transition: their partners are on the next screen. */
let partners: string[] = [];
/** The transition that set `data-morph` last (an older one finishing must not clear a newer one's names). */
let morphs = 0;

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

/**
 * Runs a DOM update inside a View Transition when possible; otherwise just runs it. While a transition
 * morphs named elements, `data-morph` on the root lists their names, so their partners on the new screen
 * can take the same names only then (`:root[data-morph~='world-view'] .world-view`): a named element is a
 * stacking context, which changes how a screen layers.
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
  try {
    if (names.length) root.dataset.morph = names.join(' ');
    // The wait stays far inside the time the browser gives an update (4 s in Chrome, from this callback).
    start(() => {
      update();
      return names.length ? screenLoaded(PARTNER_WAIT_MS) : undefined;
    }).finished.then(done, done);
  } catch {
    done();
    update();
  }
}

/** Gives an element a View Transition name while it is on screen (null clears it). */
export function transitionName(el: HTMLElement | null, name: string | null): void {
  if (el) el.style.setProperty('view-transition-name', name ?? 'none');
  if (el && name && !partners.includes(name)) partners.push(name);
}
