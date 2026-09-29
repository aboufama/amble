/**
 * The IndexedDB `Store` (§4.3). `commit` writes blobs, art records, steps, worlds and their metas in one
 * readwrite transaction: if any write fails, nothing is written. Blobs are hashed before it opens.
 */
import { blobRefOf } from '../model/ids';
import { KEEP } from '../model/limits';
import type { AiLogEntry, ArtId, ArtRecord, BlobRef, DeskDraft, SettingsKey, SettingsMap, StepId, StepSnapshot, World, WorldId, WorldMeta } from '../model/types';
import type { Commit, Store, StoreChange } from './api';
import { done, prefixRange, req, strokeKey, type StoreName } from './idb';
import { deriveMeta, sortMetas } from './meta';

interface BlobRecord {
  blob: Blob;
  size: number;
  type: string;
  at: number;
}

export class IdbStore implements Store {
  readonly mode = 'idb' as const;
  private readonly listeners = new Set<(e: StoreChange) => void>();
  private readonly urls = new Map<BlobRef, string>();

  constructor(private readonly db: IDBDatabase) {}

  private tx(names: StoreName | StoreName[], mode: IDBTransactionMode = 'readonly'): IDBTransaction {
    return this.db.transaction(names, mode);
  }

  private async read<T>(name: StoreName, key: IDBValidKey): Promise<T | null> {
    const v = await req(this.tx(name).objectStore(name).get(key));
    return (v as T | undefined) ?? null;
  }

  private async write(name: StoreName, value: unknown, key?: IDBValidKey): Promise<void> {
    const tx = this.tx(name, 'readwrite');
    tx.objectStore(name).put(value, key);
    await done(tx);
  }

  private async remove(name: StoreName, key: IDBValidKey | IDBKeyRange): Promise<void> {
    const tx = this.tx(name, 'readwrite');
    tx.objectStore(name).delete(key);
    await done(tx);
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

  private async setPutAway(id: WorldId, at: number | null): Promise<void> {
    const tx = this.tx('meta', 'readwrite');
    const store = tx.objectStore('meta');
    const get = store.get(id);
    get.onsuccess = () => {
      const meta = get.result as WorldMeta | undefined;
      if (meta) store.put({ ...meta, putAwayAt: at });
    };
    await done(tx);
    this.emit({ worlds: [id] });
  }

  worlds: Store['worlds'] = {
    list: async () => sortMetas((await req(this.tx('meta').objectStore('meta').getAll())) as WorldMeta[]),
    get: (id) => this.read<World>('worlds', id),
    putAway: (id) => this.setPutAway(id, Date.now()),
    restore: (id) => this.setPutAway(id, null),
    purge: async (id) => {
      const tx = this.tx(['worlds', 'meta', 'steps', 'handles'], 'readwrite');
      tx.objectStore('worlds').delete(id);
      tx.objectStore('meta').delete(id);
      tx.objectStore('handles').delete(id);
      const steps = tx.objectStore('steps');
      const keys = steps.index('byWorld').getAllKeys(id);
      keys.onsuccess = () => {
        for (const k of keys.result) steps.delete(k);
      };
      await done(tx);
      this.emit({ worlds: [id] });
    },
  };

  art: Store['art'] = {
    get: (id) => this.read<ArtRecord>('art', id),
    list: async (q) => {
      const all = (await req(this.tx('art').objectStore('art').getAll())) as ArtRecord[];
      return q?.shelf === undefined ? all : all.filter((a) => a.shelf === q.shelf);
    },
    remove: async (id) => {
      await this.remove('art', id);
      this.emit({ art: [id] });
    },
  };

  blobs: Store['blobs'] = {
    put: async (b) => {
      const ref = await blobRefOf(b);
      const tx = this.tx('blobs', 'readwrite');
      const store = tx.objectStore('blobs');
      const has = store.getKey(ref);
      has.onsuccess = () => {
        if (has.result === undefined) store.put({ blob: b, size: b.size, type: b.type, at: Date.now() } satisfies BlobRecord, ref);
      };
      await done(tx);
      return ref;
    },
    get: async (r) => (await this.read<BlobRecord>('blobs', r))?.blob ?? null,
    url: async (r) => {
      const known = this.urls.get(r);
      if (known) return known;
      const blob = await this.blobs.get(r);
      if (!blob) throw new Error(`Missing picture ${r}`);
      const url = URL.createObjectURL(blob);
      this.urls.set(r, url);
      return url;
    },
  };

  steps: Store['steps'] = {
    get: (id) => this.read<StepSnapshot>('steps', id),
    forWorld: async (id) => (await req(this.tx('steps').objectStore('steps').index('byWorld').getAllKeys(id))) as StepId[],
  };

  drafts: Store['drafts'] = {
    get: (artId) => this.read<DeskDraft>('drafts', artId),
    put: (d) => this.write('drafts', d),
    clear: (artId) => this.remove('drafts', artId),
  };

  strokes: Store['strokes'] = {
    append: async (artId, chunk) => {
      const tx = this.tx('strokes', 'readwrite');
      const store = tx.objectStore('strokes');
      const count = store.count(prefixRange(artId));
      count.onsuccess = () => {
        store.put(chunk, strokeKey(artId, count.result));
      };
      await done(tx);
    },
    read: async (artId) => (await req(this.tx('strokes').objectStore('strokes').getAll(prefixRange(artId)))) as Uint8Array[],
    clear: (artId) => this.remove('strokes', prefixRange(artId)),
  };

  cache: Store['cache'] = {
    get: <T>(key: string) => this.read<T>('cache', key),
    put: (key, value) => this.write('cache', value, key),
  };

  settings: Store['settings'] = {
    get: <K extends SettingsKey>(k: K) => this.read<SettingsMap[K]>('settings', k),
    put: (k, v) => this.write('settings', v, k),
    remove: (k) => this.remove('settings', k),
  };

  handles: Store['handles'] = {
    get: (worldId) => this.read<FileSystemFileHandle>('handles', worldId),
    put: (worldId, h) => this.write('handles', h, worldId),
  };

  ailog: Store['ailog'] = {
    add: async (e) => {
      const tx = this.tx('ailog', 'readwrite');
      const store = tx.objectStore('ailog');
      store.add(e);
      const count = store.count();
      count.onsuccess = () => {
        let extra = count.result - KEEP.aiLogEntries;
        if (extra <= 0) return;
        const cursor = store.openCursor();
        cursor.onsuccess = () => {
          const c = cursor.result;
          if (!c || extra <= 0) return;
          c.delete();
          extra--;
          c.continue();
        };
      };
      await done(tx);
    },
    list: async () => ((await req(this.tx('ailog').objectStore('ailog').getAll())) as AiLogEntry[]).reverse(),
    clear: async () => {
      const tx = this.tx('ailog', 'readwrite');
      tx.objectStore('ailog').clear();
      await done(tx);
    },
  };

  async commit(c: Commit): Promise<void> {
    const blobs = await Promise.all((c.blobs ?? []).map(async (blob) => ({ ref: await blobRefOf(blob), blob })));
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

    const tx = this.tx([...names], 'readwrite');
    const now = Date.now();
    if (blobs.length) {
      const store = tx.objectStore('blobs');
      for (const { ref, blob } of blobs) {
        const has = store.getKey(ref);
        has.onsuccess = () => {
          if (has.result === undefined) store.put({ blob, size: blob.size, type: blob.type, at: now } satisfies BlobRecord, ref);
        };
      }
    }
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
    await done(tx);
    const worlds = [...new Set([...written, ...Object.keys(c.snapshots ?? {})])];
    if (worlds.length || art.size) this.emit({ ...(worlds.length ? { worlds } : {}), ...(art.size ? { art: [...art.keys()] } : {}) });
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
    for (const url of this.urls.values()) URL.revokeObjectURL(url);
    this.urls.clear();
    this.db.close();
  }
}
