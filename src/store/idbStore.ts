/**
 * The IndexedDB `Store` (§4.3). `commit` writes blobs, art records, steps, worlds and their metas in one
 * readwrite transaction: if any write fails, nothing is written. Blobs are hashed before it opens.
 * Every write reports to the store's health, which becomes `library.storage` ('full' on a quota error).
 */
import type { ArtId, ArtRecord, BlobRef, DeskDraft, StepSnapshot, World, WorldId, WorldMeta } from '../model/types';
import type { Commit, GcReport, Store, StoreChange, StoreHealth, StoreUpkeep } from './api';
import { idbAiLog } from './ailog';
import { idbArt } from './art';
import { BlobUrls, hashBlobs, idbBlobs, putBlobsInTx, type BlobRecord } from './blobs';
import { idbDrafts } from './drafts';
import { GC_GRACE_MS, markArt, markDeep, markDraft, markMeta, markSet, markStep, markWorld } from './gc';
import { idbHandles } from './handles';
import { abortQuietly, Connection, done, req, STORE_NAMES, type IdbCtx, type StoreName } from './idb';
import { deriveMeta } from './meta';
import { healthOf } from './quota';
import { idbCache, idbSettings } from './settings';
import { idbSteps } from './steps';
import { idbStrokes } from './strokes';
import { idbWorlds } from './worlds';

/** Walks every record of a store with a cursor (one record in memory at a time). */
function eachRecord(tx: IDBTransaction, name: StoreName, fn: (value: unknown, key: IDBValidKey) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const cursor = tx.objectStore(name).openCursor();
    cursor.onsuccess = () => {
      const c = cursor.result;
      if (!c) return resolve();
      fn(c.value, c.key);
      c.continue();
    };
    cursor.onerror = () => reject(cursor.error ?? new Error(`Could not read ${name}.`));
  });
}

export class IdbStore implements Store, StoreUpkeep {
  readonly mode = 'idb' as const;
  private readonly listeners = new Set<(e: StoreChange) => void>();
  private readonly healthListeners = new Set<(h: StoreHealth, err: unknown) => void>();
  private readonly urls = new BlobUrls();
  private readonly conn: Connection;
  private readonly ctx: IdbCtx;
  private state: StoreHealth = 'ok';

  readonly worlds: Store['worlds'];
  readonly art: Store['art'];
  readonly blobs: Store['blobs'];
  readonly steps: Store['steps'];
  readonly drafts: Store['drafts'];
  readonly strokes: Store['strokes'];
  readonly cache: Store['cache'];
  readonly settings: Store['settings'];
  readonly handles: Store['handles'];
  readonly ailog: Store['ailog'];

  /** `reopen` opens a fresh connection when the browser closed this one (default: fail). */
  constructor(
    db: IDBDatabase,
    reopen: () => Promise<IDBDatabase> = () => Promise.reject(new DOMException('The database was closed.', 'InvalidStateError')),
    health: StoreHealth = 'ok',
  ) {
    this.state = health;
    this.conn = new Connection(db, reopen);
    this.ctx = { conn: this.conn, emit: (e) => this.emit(e), wrote: (err) => this.wrote(err) };
    this.worlds = idbWorlds(this.ctx);
    this.art = idbArt(this.ctx);
    this.blobs = idbBlobs(this.conn, this.urls, (err) => this.wrote(err));
    this.steps = idbSteps(this.ctx);
    this.drafts = idbDrafts(this.ctx);
    this.strokes = idbStrokes(this.ctx);
    this.cache = idbCache(this.ctx);
    this.settings = idbSettings(this.ctx);
    this.handles = idbHandles(this.ctx);
    this.ailog = idbAiLog(this.ctx);
  }

  private emit(e: StoreChange): void {
    for (const fn of this.listeners) {
      try {
        fn(e);
      } catch (err) {
        console.error(err);
      }
    }
  }

  private wrote(err?: unknown): void {
    const next = err === undefined ? 'ok' : healthOf(err);
    if (next === this.state && next === 'ok') return;
    this.state = next;
    for (const fn of this.healthListeners) {
      try {
        fn(next, err);
      } catch (e) {
        console.error(e);
      }
    }
  }

  async commit(c: Commit): Promise<void> {
    const blobs = await hashBlobs(c.blobs ?? []);
    const names = new Set<StoreName>();
    if (blobs.length) names.add('blobs');
    if (c.art?.length) names.add('art');
    if (c.steps?.length) names.add('steps');
    if (c.worlds?.length || (c.snapshots && Object.keys(c.snapshots).length)) {
      names.add('worlds');
      names.add('meta');
    }
    if (c.clearDrafts?.length) names.add('drafts');
    if (!names.size) return;

    try {
      // Strict: the student's work is on disk before the save says so (a lid closed next is fine).
      const tx = await this.conn.tx([...names], 'readwrite', 'strict');
      const finished = done(tx);
      try {
        this.writeCommit(tx, c, blobs, Date.now());
      } catch (err) {
        // A write that throws (a record without its key, a value that can't be stored) must not let the
        // earlier writes commit: abort, so nothing is written.
        abortQuietly(tx);
        await finished.catch(() => undefined);
        throw err;
      }
      await finished;
      this.wrote();
    } catch (err) {
      this.wrote(err);
      throw err;
    }
    const worlds = [...new Set([...(c.worlds ?? []).map((w) => w.id), ...Object.keys(c.snapshots ?? {})])];
    const artIds = [...new Set((c.art ?? []).map((a) => a.id))];
    if (worlds.length || artIds.length) this.emit({ ...(worlds.length ? { worlds } : {}), ...(artIds.length ? { art: artIds } : {}) });
  }

  private writeCommit(tx: IDBTransaction, c: Commit, blobs: Array<{ ref: BlobRef; blob: Blob }>, now: number): void {
    putBlobsInTx(tx, blobs, now);
    const art = new Map((c.art ?? []).map((a) => [a.id, a]));
    for (const a of art.values()) tx.objectStore('art').put(a);
    for (const s of c.steps ?? []) tx.objectStore('steps').put(s);
    const written = new Set<WorldId>();
    for (const w of c.worlds ?? []) {
      written.add(w.id);
      tx.objectStore('worlds').put(w);
      const meta = tx.objectStore('meta');
      const prev = meta.get(w.id);
      prev.onsuccess = () => {
        meta.put(deriveMeta(w, (prev.result as WorldMeta | undefined) ?? null, { snapshot: c.snapshots?.[w.id], art: (id: ArtId) => art.get(id) }));
      };
    }
    for (const [id, ref] of Object.entries(c.snapshots ?? {})) {
      if (written.has(id)) continue;
      const meta = tx.objectStore('meta');
      const prev = meta.get(id);
      prev.onsuccess = () => {
        const m = prev.result as WorldMeta | undefined;
        if (m) meta.put({ ...m, snapshot: ref });
      };
    }
    for (const id of c.clearDrafts ?? []) tx.objectStore('drafts').delete(id);
  }

  async collectGarbage(o: { now?: number; graceMs?: number } = {}): Promise<GcReport> {
    const now = o.now ?? Date.now();
    const grace = o.graceMs ?? GC_GRACE_MS;
    const { refs, mark } = markSet();
    // One transaction for mark and sweep: no commit can land a new reference between the two.
    const tx = await this.conn.tx(['meta', 'worlds', 'art', 'steps', 'drafts', 'cache', 'blobs'], 'readwrite');
    const finished = done(tx);
    let kept = 0;
    let removed = 0;
    let bytes = 0;
    try {
      await eachRecord(tx, 'meta', (v) => markMeta(v as WorldMeta, mark));
      await eachRecord(tx, 'worlds', (v) => markWorld(v as World, mark));
      await eachRecord(tx, 'art', (v) => markArt(v as ArtRecord, mark));
      await eachRecord(tx, 'steps', (v) => markStep(v as StepSnapshot, mark));
      await eachRecord(tx, 'drafts', (v) => markDraft(v as DeskDraft, mark));
      await eachRecord(tx, 'cache', (v) => markDeep(v, mark));
      await new Promise<void>((resolve, reject) => {
        const cursor = tx.objectStore('blobs').openCursor();
        cursor.onsuccess = () => {
          const c = cursor.result;
          if (!c) return resolve();
          const rec = c.value as BlobRecord;
          if (refs.has(c.key as BlobRef) || !(rec.at <= now - grace)) kept++;
          else {
            removed++;
            bytes += rec.size ?? 0;
            c.delete();
          }
          c.continue();
        };
        cursor.onerror = () => reject(cursor.error ?? new Error('Could not read the blobs.'));
      });
    } catch (err) {
      abortQuietly(tx);
      await finished.catch(() => undefined);
      throw err;
    }
    await finished;
    return { kept, removed, bytes };
  }

  async blobBytes(refs: Iterable<BlobRef>): Promise<number> {
    const tx = await this.conn.tx('blobs');
    const store = tx.objectStore('blobs');
    const sizes = await Promise.all([...new Set(refs)].map(async (r) => ((await req(store.get(r))) as BlobRecord | undefined)?.size ?? 0));
    return sizes.reduce((a, b) => a + b, 0);
  }

  async wipe(): Promise<void> {
    const tx = await this.conn.tx([...STORE_NAMES], 'readwrite');
    for (const name of STORE_NAMES) tx.objectStore(name).clear();
    await done(tx);
    this.urls.revokeAll();
    this.wrote();
    this.emit({ worlds: [], art: [] });
  }

  health(): StoreHealth {
    return this.state;
  }

  onHealth(fn: (h: StoreHealth, err: unknown) => void): () => void {
    this.healthListeners.add(fn);
    return () => this.healthListeners.delete(fn);
  }

  async estimate(): Promise<{ usage: number; quota: number; persisted: boolean }> {
    const storage = typeof navigator === 'undefined' ? undefined : navigator.storage;
    const est = (await storage?.estimate?.().catch(() => undefined)) ?? {};
    const persisted = (await storage?.persisted?.().catch(() => false)) ?? false;
    return { usage: est.usage ?? 0, quota: est.quota ?? 0, persisted };
  }

  onChange(fn: (e: StoreChange) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Closes the connection (tests, and "Delete everything"). */
  close(): void {
    this.urls.revokeAll();
    this.conn.close();
  }
}
