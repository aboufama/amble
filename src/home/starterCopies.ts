/**
 * Starter worlds open as the student's own copy (§2.1 `#/starter/<id>`), kept only once the student
 * changes something: a copy nobody changed is discarded when they leave it. "Changed" means any footstep
 * after the start, or dials, twists or drawings of their own.
 */
import type { Route } from '../app/routes';
import { getServices } from '../app/services';
import type { World, WorldId, WorldMeta } from '../model/types';
import { refreshLibrary } from '../state/library';
import { subscribe } from '../state/store';

/** An untouched starter copy: nothing but the start step, and no dials, twists or student drawings. */
export function isUntouchedStarterCopy(w: World): boolean {
  if (w.origin.kind !== 'starter' || !w.origin.withArt) return false;
  if (w.steps.length > 1) return false;
  if (Object.keys(w.dials).length || w.twists.length) return false;
  return !Object.values(w.cast).some((slot) => slot.madeBy === 'student');
}

/** Whether a route is inside a world (the world, its Desk, Bones, code or Hand in). */
export function routeWorldId(route: Route): WorldId | null {
  switch (route.name) {
    case 'world':
      return route.id;
    case 'draw':
    case 'bones':
    case 'code':
    case 'handin':
      return route.worldId;
    default:
      return null;
  }
}

const watched = new Set<WorldId>();
let unsubscribe: (() => void) | null = null;

async function discardIfUntouched(id: WorldId): Promise<void> {
  const { store } = getServices();
  const world = await store.worlds.get(id);
  if (world && isUntouchedStarterCopy(world)) {
    await store.worlds.purge(id);
    await refreshLibrary(store);
  }
}

/** Watches a fresh starter copy: when the student leaves it unchanged, it goes away. */
export function watchStarterCopy(id: WorldId): void {
  watched.add(id);
  unsubscribe ??= subscribe((state, prev) => {
    if (state.app.route === prev.app.route) return;
    const here = routeWorldId(state.app.route);
    for (const w of [...watched]) {
      if (w === here) continue;
      watched.delete(w);
      void discardIfUntouched(w).catch(() => undefined);
    }
    if (!watched.size && unsubscribe) {
      unsubscribe();
      unsubscribe = null;
    }
  });
}

/**
 * Starter copies left untouched by an earlier visit (a closed tab never "left" them): discarded when the
 * Trail loads. Returns true when something was removed.
 */
export async function sweepStarterCopies(metas: readonly WorldMeta[]): Promise<boolean> {
  const { store } = getServices();
  let removed = false;
  for (const m of metas) {
    if (m.origin !== 'starter' || m.putAwayAt !== null || watched.has(m.id)) continue;
    const world = await store.worlds.get(m.id);
    if (world && isUntouchedStarterCopy(world)) {
      await store.worlds.purge(m.id);
      removed = true;
    }
  }
  return removed;
}
