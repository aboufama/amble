/**
 * The `library` slice (M6 owns; FOUNDATION-STUB with a working refresh): the Trail's index of worlds and
 * characters, the storage state and a found old-Amble project.
 */
import type { Store } from '../store/api';
import type { LegacyImport } from '../legacy/reader';
import type { ArtRecordLite, WorldMeta } from '../model/types';
import { setState } from './store';

export interface LibrarySlice {
  worlds: WorldMeta[];
  characters: ArtRecordLite[];
  loaded: boolean;
  storage: 'ok' | 'blocked' | 'full';
  legacy: LegacyImport | null;
}

export function initialLibrary(): LibrarySlice {
  return { worlds: [], characters: [], loaded: false, storage: 'ok', legacy: null };
}

/** Re-reads the worlds' index and the shelf characters from the store. */
export async function refreshLibrary(store: Store): Promise<void> {
  const [worlds, art] = await Promise.all([store.worlds.list(), store.art.list({ shelf: true })]);
  const characters: ArtRecordLite[] = art.map((a) => ({
    id: a.id,
    name: a.name,
    kind: a.kind,
    rig: a.rig,
    shelf: a.shelf,
    updatedAt: a.updatedAt,
    sticker: a.export?.sticker ?? null,
  }));
  setState((s) => {
    s.library.worlds = worlds;
    s.library.characters = characters;
    s.library.loaded = true;
    s.library.storage = store.mode === 'memory' ? 'blocked' : s.library.storage;
  });
}

export function setStorageState(storage: LibrarySlice['storage']): void {
  setState((s) => {
    s.library.storage = storage;
  });
}

export function setLegacy(legacy: LegacyImport | null): void {
  setState((s) => {
    s.library.legacy = legacy;
  });
}
