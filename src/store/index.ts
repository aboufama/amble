/**
 * Opens the app's store: IndexedDB when the browser allows it, otherwise the in-memory store
 * (files-only mode, §4.3). A database that opens but refuses a first small write (some locked-down
 * profiles) counts as blocked too, so work is never silently written nowhere.
 */
import type { Store } from './api';
import { done, openAmbleDb } from './idb';
import { IdbStore } from './idbStore';
import { MemoryStore } from './memory';
import { isQuotaError } from './quota';

export type { Commit, DraftInfo, GcReport, Store, StoreChange, StoreHealth, StoreUpkeep } from './api';
export { upkeepOf } from './api';
export { createAutosave, type Autosave, type AutosaveOptions } from './autosave';
export { MemoryStore } from './memory';

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    p,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${what} took too long.`)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

/** A tiny write the store can always afford: proves writes land here. */
async function probe(db: IDBDatabase): Promise<void> {
  const tx = db.transaction('cache', 'readwrite');
  tx.objectStore('cache').put(Date.now(), 'probe:open');
  await done(tx);
}

/** The page's IndexedDB, or null where it is missing or reading it throws (blocked by policy). */
function pageFactory(): IDBFactory | null {
  try {
    return typeof indexedDB === 'undefined' ? null : indexedDB;
  } catch {
    return null;
  }
}

export async function openStore(o: { factory?: IDBFactory | null; timeoutMs?: number } = {}): Promise<Store> {
  const factory = o.factory === undefined ? pageFactory() : o.factory;
  if (!factory) {
    console.warn('Amble is keeping work in memory only: this browser has no IndexedDB here.');
    return new MemoryStore();
  }
  const timeout = o.timeoutMs ?? 5000;
  const open = () => withTimeout(openAmbleDb(factory), timeout, 'Opening IndexedDB');
  try {
    const db = await open();
    try {
      await withTimeout(probe(db), timeout, 'The first save');
    } catch (err) {
      // A full disk is not a blocked browser: keep IndexedDB (everything reads) and start as 'full'.
      if (isQuotaError(err)) return new IdbStore(db, open, 'full');
      db.close();
      throw err;
    }
    return new IdbStore(db, open);
  } catch (err) {
    console.warn('Amble is keeping work in memory only:', err);
    return new MemoryStore();
  }
}
