/**
 * Starter worlds open as the student's own copy (§2.1 `#/starter/<id>`), kept only once the student
 * changes something: a copy nobody changed is discarded when they leave it. "Changed" means any footstep
 * after the start, dials, twists or drawings of their own, and the work that prints no footstep: a new
 * name, remapped keys, a drawing started at the Desk (or an example drawn over) but not brought to life
 * yet, and code typed in Look inside but not run.
 */
import type { Route } from '../app/routes';
import { getServices } from '../app/services';
import { artIdFor, savesSettled } from '../draw/artId';
import type { World, WorldId, WorldMeta } from '../model/types';
import { codeDraftKey } from '../screens/code/open';
import { refreshLibrary } from '../state/library';
import { getState, subscribe } from '../state/store';
import type { Store } from '../store/api';

/** An untouched starter copy: nothing but the start step, and no dials, twists or student drawings. */
export function isUntouchedStarterCopy(w: World): boolean {
  if (w.origin.kind !== 'starter' || !w.origin.withArt) return false;
  if (w.steps.length > 1) return false;
  if (Object.keys(w.dials).length || w.twists.length) return false;
  return !Object.values(w.cast).some((slot) => slot.madeBy === 'student');
}

function starterTitle(w: World): string | null {
  if (w.origin.kind !== 'starter') return null;
  try {
    return getServices().starters.info(w.origin.starter).title;
  } catch {
    return null;
  }
}

/**
 * Whether a starter copy can go: untouched, and nothing on the device holds work the student did in it
 * that prints no footstep. Anything it can't read counts as work (the copy stays).
 */
export async function canDiscardCopy(store: Store, w: World): Promise<boolean> {
  if (!isUntouchedStarterCopy(w)) return false;
  if (w.title !== starterTitle(w)) return false;
  if (Object.keys(w.controls).length || Object.keys(w.sounds).length) return false;
  const drafts = await store.drafts.list().catch(() => null);
  if (!drafts || drafts.some((d) => d.worldId === w.id)) return false;
  for (const [key, slot] of Object.entries(w.cast)) {
    for (const artId of new Set([slot.art, await artIdFor(w.id, key)])) {
      if (!artId) continue;
      const record = await store.art.get(artId).catch(() => undefined);
      if (record === undefined) return false;
      // Drawn at the Desk and saved, but not brought to life yet (an example keeps createdAt until then).
      if (record && (record.madeBy === 'student' || record.updatedAt > record.createdAt)) return false;
    }
  }
  const code = await store.cache.get(codeDraftKey(w.id)).catch(() => undefined);
  return code === null;
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
// Copies the student just left, still being kept or discarded (Home waits for them before choosing).
let leaving = 0;
const settledWaiters = new Set<() => void>();

function track(work: Promise<void>): void {
  leaving++;
  void work
    .catch(() => undefined)
    .finally(() => {
      leaving--;
      if (leaving) return;
      for (const done of settledWaiters) done();
      settledWaiters.clear();
    });
}

/** Whether a starter copy the student just left is still being kept or discarded. */
export function starterCopiesPending(): boolean {
  return leaving > 0;
}

/** Resolves once every starter copy the student just left has been kept or discarded. */
export function starterCopiesSettled(): Promise<void> {
  return leaving ? new Promise((resolve) => settledWaiters.add(resolve)) : Promise.resolve();
}

async function discardIfUntouched(id: WorldId): Promise<void> {
  const { store } = getServices();
  // The session's copy of the world just left holds changes the autosave may not have written yet (a
  // rename a moment ago), and a drawing saved as the Desk closed may still be landing.
  const open = getState().session.world;
  const world = open?.id === id ? open : await store.worlds.get(id);
  await savesSettled();
  if (world && (await canDiscardCopy(store, world))) {
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
      track(discardIfUntouched(w));
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
    if (world && (await canDiscardCopy(store, world))) {
      await store.worlds.purge(m.id);
      removed = true;
    }
  }
  return removed;
}
