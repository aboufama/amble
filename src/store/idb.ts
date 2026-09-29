/**
 * The `amble` IndexedDB database (§4.3): schema and small promise helpers over raw IndexedDB.
 * Every store name is new, so nothing collides with the old editor's `keyval-store` database.
 */

export const DB_NAME = 'amble';
export const DB_VERSION = 1;

export const STORE_NAMES = ['meta', 'worlds', 'art', 'blobs', 'steps', 'drafts', 'strokes', 'cache', 'settings', 'handles', 'ailog'] as const;
export type StoreName = (typeof STORE_NAMES)[number];

/** Opens (and on first use creates) the database. */
export function openAmbleDb(factory: IDBFactory = indexedDB, name: string = DB_NAME): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let request: IDBOpenDBRequest;
    try {
      request = factory.open(name, DB_VERSION);
    } catch (err) {
      reject(err);
      return;
    }
    request.onupgradeneeded = () => {
      const db = request.result;
      const has = (n: string) => db.objectStoreNames.contains(n);
      if (!has('meta')) db.createObjectStore('meta', { keyPath: 'id' });
      if (!has('worlds')) db.createObjectStore('worlds', { keyPath: 'id' });
      if (!has('art')) db.createObjectStore('art', { keyPath: 'id' });
      if (!has('blobs')) db.createObjectStore('blobs');
      if (!has('steps')) db.createObjectStore('steps', { keyPath: 'id' }).createIndex('byWorld', 'worldId');
      if (!has('drafts')) db.createObjectStore('drafts', { keyPath: 'artId' });
      if (!has('strokes')) db.createObjectStore('strokes');
      if (!has('cache')) db.createObjectStore('cache');
      if (!has('settings')) db.createObjectStore('settings');
      if (!has('handles')) db.createObjectStore('handles');
      if (!has('ailog')) db.createObjectStore('ailog', { autoIncrement: true });
    };
    request.onsuccess = () => {
      const db = request.result;
      // Another tab upgrading the schema: close so it can proceed; this tab reloads its data on next open.
      db.onversionchange = () => db.close();
      resolve(db);
    };
    request.onerror = () => reject(request.error ?? new Error('IndexedDB would not open.'));
    request.onblocked = () => {
      // Waits for other tabs to close their connection; open() resolves or fails later.
    };
  });
}

/** The result of one request. */
export function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error ?? new Error('IndexedDB request failed.'));
  });
}

/** Resolves when the transaction commits; rejects when it errors or aborts (nothing was written). */
export function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed.'));
    tx.onabort = () => reject(tx.error ?? new DOMException('The save was cancelled.', 'AbortError'));
  });
}

/** Keys `${prefix}:...` of an out-of-line store (stroke log chunks). */
export function prefixRange(prefix: string): IDBKeyRange {
  return IDBKeyRange.bound(`${prefix}:`, `${prefix}:￿`);
}

/** Stroke chunk key: zero-padded so keys sort in append order. */
export function strokeKey(artId: string, n: number): string {
  return `${artId}:${String(n).padStart(6, '0')}`;
}
