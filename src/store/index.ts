/**
 * Opens the app's store: IndexedDB when the browser allows it, otherwise the in-memory store
 * (files-only mode, §4.3).
 */
import type { Store } from './api';
import { openAmbleDb } from './idb';
import { IdbStore } from './idbStore';
import { MemoryStore } from './memory';

export type { Commit, Store, StoreChange } from './api';
export { createAutosave, type Autosave, type AutosaveOptions } from './autosave';
export { MemoryStore } from './memory';

export async function openStore(o: { factory?: IDBFactory | null; timeoutMs?: number } = {}): Promise<Store> {
  const factory = o.factory === undefined ? (typeof indexedDB === 'undefined' ? null : indexedDB) : o.factory;
  if (!factory) return new MemoryStore();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const db = await Promise.race([
      openAmbleDb(factory),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('IndexedDB took too long to open.')), o.timeoutMs ?? 5000);
      }),
    ]);
    return new IdbStore(db);
  } catch (err) {
    console.warn('Amble is keeping work in memory only:', err);
    return new MemoryStore();
  } finally {
    clearTimeout(timer);
  }
}
