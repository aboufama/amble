/**
 * The `library` slice (M6 owns): the Trail's index of worlds and characters, where saving stands
 * ('blocked' in files-only mode, 'full' after a quota error), a found old-Amble project, and two
 * additions for the Trail's chips: `space` (usage against the quota, "Space is getting low") and
 * `updated` (the first launch after an update, "Amble was updated · What's new").
 */
import type { LegacyImport } from '../legacy/reader';
import type { ArtRecord, ArtRecordLite, WorldMeta } from '../model/types';
import type { Store } from '../store/api';
import { spaceInfo, type SpaceInfo } from '../store/quota';
import { getState, setState } from './store';

export interface LibrarySlice {
  worlds: WorldMeta[];
  characters: ArtRecordLite[];
  loaded: boolean;
  storage: 'ok' | 'blocked' | 'full';
  legacy: LegacyImport | null;
  /** An addition: storage use, and whether it passed the warning line. Null until measured. */
  space: SpaceInfo | null;
  /** An addition: true on the first launch after Amble was updated. */
  updated: boolean;
}

export function initialLibrary(): LibrarySlice {
  return { worlds: [], characters: [], loaded: false, storage: 'ok', legacy: null, space: null, updated: false };
}

export function toLite(a: ArtRecord): ArtRecordLite {
  return { id: a.id, name: a.name, kind: a.kind, rig: a.rig, shelf: a.shelf, updatedAt: a.updatedAt, sticker: a.export?.sticker ?? null };
}

let refreshing: Promise<void> | null = null;
let again = false;

/**
 * Re-reads the worlds' index and the shelf characters from the store. Calls that arrive while one is
 * running coalesce into one more read, so a burst of commits costs two reads, not twenty.
 */
export function refreshLibrary(store: Store): Promise<void> {
  if (refreshing) {
    again = true;
    return refreshing;
  }
  refreshing = (async () => {
    do {
      again = false;
      try {
        const [worlds, art] = await Promise.all([store.worlds.list(), store.art.list({ shelf: true })]);
        const characters = art.sort((a, b) => b.updatedAt - a.updatedAt).map(toLite);
        setState((s) => {
          s.library.worlds = worlds;
          s.library.characters = characters;
          s.library.loaded = true;
          if (store.mode === 'memory') s.library.storage = 'blocked';
        });
      } catch (err) {
        console.warn('The Trail could not be read:', err);
        setState((s) => {
          s.library.loaded = true;
        });
      }
    } while (again);
  })().finally(() => {
    refreshing = null;
  });
  return refreshing;
}

export function setStorageState(storage: LibrarySlice['storage']): void {
  if (getState().library.storage === storage) return;
  setState((s) => {
    s.library.storage = storage;
  });
}

export function setLegacy(legacy: LegacyImport | null): void {
  setState((s) => {
    s.library.legacy = legacy;
  });
}

export function setSpace(e: { usage: number; quota: number; persisted: boolean }): SpaceInfo {
  const info = spaceInfo(e);
  setState((s) => {
    s.library.space = info;
  });
  return info;
}

export function setUpdated(updated: boolean): void {
  setState((s) => {
    s.library.updated = updated;
  });
}
