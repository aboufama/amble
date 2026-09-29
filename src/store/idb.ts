/**
 * The `amble` IndexedDB database (§4.3): schema, a connection that reopens itself, and small promise
 * helpers over raw IndexedDB. Every store name is new, so nothing collides with the old editor's
 * `keyval-store` database.
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
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB would not open.'));
    request.onblocked = () => {
      // Another tab holds an older version open; open() resolves once it closes (openStore times out).
    };
  });
}

/**
 * One live connection to the database. When the browser closes it under us (another tab upgrading the
 * schema, storage cleared by the user or by policy, a crashed backing store), the next transaction opens
 * a fresh connection instead of failing every save until the page reloads.
 */
export class Connection {
  private db: IDBDatabase | null;
  private reopening: Promise<IDBDatabase> | null = null;

  constructor(
    db: IDBDatabase,
    private readonly reopen: () => Promise<IDBDatabase>,
  ) {
    this.db = null;
    this.adopt(db);
  }

  private adopt(db: IDBDatabase): void {
    this.db = db;
    db.onversionchange = () => {
      db.close();
      if (this.db === db) this.db = null;
    };
    db.onclose = () => {
      if (this.db === db) this.db = null;
    };
  }

  private async current(): Promise<IDBDatabase> {
    if (this.db) return this.db;
    this.reopening ??= this.reopen().then(
      (db) => {
        this.reopening = null;
        this.adopt(db);
        return db;
      },
      (err: unknown) => {
        this.reopening = null;
        throw err;
      },
    );
    return this.reopening;
  }

  /** A transaction over `names`; reopens the connection once if it was closed. */
  async tx(names: StoreName | StoreName[], mode: IDBTransactionMode = 'readonly', durability: IDBTransactionDurability = 'default'): Promise<IDBTransaction> {
    const db = await this.current();
    try {
      return db.transaction(names, mode, { durability });
    } catch (err) {
      if (!(err instanceof DOMException) || err.name !== 'InvalidStateError') throw err;
      if (this.db === db) this.db = null;
      return (await this.current()).transaction(names, mode, { durability });
    }
  }

  close(): void {
    const db = this.db;
    this.db = null;
    if (db) {
      db.onversionchange = null;
      db.onclose = null;
      db.close();
    }
  }
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

/** Aborts a transaction that may already have finished. */
export function abortQuietly(tx: IDBTransaction): void {
  try {
    tx.abort();
  } catch {
    // Already committed or aborted.
  }
}

/** What each store section of the IndexedDB store works with. */
export interface IdbCtx {
  conn: Connection;
  /** Tells listeners which worlds and drawings changed. */
  emit(e: { worlds?: string[]; art?: string[] }): void;
  /** Reports a write: no argument when it landed, the error when it failed (the store's health). */
  wrote(err?: unknown): void;
}

export async function readOne<T>(ctx: IdbCtx, name: StoreName, key: IDBValidKey): Promise<T | null> {
  const tx = await ctx.conn.tx(name);
  const v = await req(tx.objectStore(name).get(key));
  return (v as T | undefined) ?? null;
}

export async function readAll<T>(ctx: IdbCtx, name: StoreName, query?: IDBKeyRange | IDBValidKey): Promise<T[]> {
  const tx = await ctx.conn.tx(name);
  return (await req(tx.objectStore(name).getAll(query))) as T[];
}

/** One write in its own transaction, reported to the store's health. */
export async function writeTx(ctx: IdbCtx, names: StoreName | StoreName[], fill: (tx: IDBTransaction) => void, durability: IDBTransactionDurability = 'default'): Promise<void> {
  try {
    const tx = await ctx.conn.tx(names, 'readwrite', durability);
    const finished = done(tx);
    try {
      fill(tx);
    } catch (err) {
      abortQuietly(tx);
      await finished.catch(() => undefined);
      throw err;
    }
    await finished;
    ctx.wrote();
  } catch (err) {
    ctx.wrote(err);
    throw err;
  }
}

/** Keys `${prefix}:...` of an out-of-line store (stroke log chunks). */
export function prefixRange(prefix: string): IDBKeyRange {
  return IDBKeyRange.bound(`${prefix}:`, `${prefix}:￿`);
}

/** Stroke chunk key: zero-padded so keys sort in append order. */
export function strokeKey(artId: string, n: number): string {
  return `${artId}:${String(n).padStart(6, '0')}`;
}

/** The chunk number of a stroke key (`a_x:000012` → 12). */
export function strokeIndex(key: string): number {
  return Number(key.slice(key.lastIndexOf(':') + 1));
}
