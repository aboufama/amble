/**
 * Leaving Bones (§2.11): Done returns to where the student came from, ◂ Drawing to the drawing. When
 * the page before this one in the tab's history is that place, going back keeps the history tidy
 * (Back then does what the student expects); otherwise the place is opened fresh.
 */
import { navigate, parseHash } from '../app/router';
import type { Route } from '../app/routes';

interface NavigationEntryLike {
  url: string | null;
  index: number;
}

interface NavigationLike {
  currentEntry: NavigationEntryLike | null;
  entries(): NavigationEntryLike[];
}

/** The route of the previous entry in this tab's history, when it was this app (Chrome's Navigation API). */
export function previousRoute(win: Window = window): Route | null {
  const nav = (win as unknown as { navigation?: NavigationLike }).navigation;
  const current = nav?.currentEntry;
  if (!nav || !current || current.index < 1) return null;
  const prev = nav.entries()[current.index - 1];
  if (!prev?.url) return null;
  try {
    const url = new URL(prev.url);
    if (url.origin !== win.location.origin || url.pathname !== win.location.pathname) return null;
    const route = parseHash(url.hash);
    return route.name === 'notFound' ? null : route;
  } catch {
    return null;
  }
}

/** Where Done may go back to from these bones: the world, the drawing, or the Trail and home pages. */
export function isOrigin(prev: Route, from: { worldId: string | null; castKey: string | null; artId: string | null }): boolean {
  switch (prev.name) {
    case 'world':
      return prev.id === from.worldId;
    case 'draw':
      return prev.worldId === from.worldId && prev.key === from.castKey;
    case 'drawFree':
      return prev.artId === from.artId;
    case 'trail':
    case 'home':
    case 'first':
    case 'new':
      return from.worldId === null;
    default:
      return false;
  }
}

function same(a: Route, b: Route): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Goes to `route`: back through the history when that is where the student just was. */
export function goBackTo(route: Route): void {
  const prev = previousRoute();
  if (prev && same(prev, route)) history.back();
  else navigate(route);
}

/** Done: back to where the student came from, else the world (or the Trail for a free drawing). */
export function leaveBones(from: { worldId: string | null; castKey: string | null; artId: string | null }): void {
  const prev = previousRoute();
  if (prev && isOrigin(prev, from)) {
    history.back();
    return;
  }
  navigate(from.worldId ? { name: 'world', id: from.worldId } : { name: 'trail', view: 'trail' }, { replace: true });
}
