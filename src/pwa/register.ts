/**
 * The service worker (§4.3 offline, §6.1, risk 12): registered once after the first render in production
 * builds (`main.tsx` calls this). The worker precaches this build, so a flaky school network or no network
 * at all still opens Amble, its starters and the player. A new build installs in the background and takes
 * over on the next launch only, never mid-session.
 */

/** This build's id (set by vite/swPlugin.ts; 'dev' on the dev server and in tests). */
export const BUILD_ID: string = (import.meta.env.AMBLE_BUILD_ID as string | undefined) ?? 'dev';

export type SwState = 'none' | 'installing' | 'ready' | 'update-waiting' | 'failed';

let state: SwState = 'none';
const listeners = new Set<(s: SwState) => void>();

function set(next: SwState): void {
  state = next;
  for (const fn of listeners) fn(next);
}

export function serviceWorkerState(): SwState {
  return state;
}

export function onServiceWorkerState(fn: (s: SwState) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function track(reg: ServiceWorkerRegistration): void {
  const watch = (w: ServiceWorker | null) => {
    if (!w) return;
    w.addEventListener('statechange', () => {
      if (w.state === 'installed') set(navigator.serviceWorker.controller ? 'update-waiting' : 'ready');
      else if (w.state === 'activated' && !reg.waiting) set('ready');
      else if (w.state === 'redundant' && state === 'installing') set('failed');
    });
  };
  if (reg.waiting) set('update-waiting');
  else if (reg.active) set('ready');
  if (reg.installing) {
    set('installing');
    watch(reg.installing);
  }
  reg.addEventListener('updatefound', () => {
    set('installing');
    watch(reg.installing);
  });
}

/** Registers `sw.js` next to the page (it only exists in builds). Never throws. */
export function registerServiceWorker(): void {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  const url = new URL('sw.js', document.baseURI);
  // Only the app's own origin, and never inside a frame (a shared page, a preview).
  if (url.origin !== location.origin || window.self !== window.top) return;
  const go = () =>
    navigator.serviceWorker
      .register(url, { scope: './', updateViaCache: 'none' })
      .then(track)
      .catch((err: unknown) => {
        set('failed');
        console.warn('Offline support is off here:', err);
      });
  if (document.readyState === 'complete') void go();
  else window.addEventListener('load', () => void go(), { once: true });
}
