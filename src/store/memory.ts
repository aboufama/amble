/**
 * The in-memory `Store`: files-only mode when IndexedDB is blocked (§4.3), and a fast store for tests.
 * Same behaviour as the IndexedDB store; records are cloned in and out, like IndexedDB does.
 */
import { blobRefOf } from '../model/ids';
import { KEEP } from '../model/limits';
import type { AiLogEntry, ArtId, ArtRecord, BlobRef, DeskDraft, SettingsKey, SettingsMap, StepId, StepSnapshot, World, WorldId, WorldMeta } from '../model/types';
import type { Commit, Store, StoreChange } from './api';
import { deriveMeta, sortMetas } from './meta';

function clone<T>(v: T): T {
  try {
    return structuredClone(v);
  } catch {
    return v;
  }
}

export class MemoryStore implements Store {
  readonly mode = 'memory' as const;
  private readonly metaMap = new Map<WorldId, WorldMeta>();
  private readonly worldMap = new Map<WorldId, World>();
  private readonly artMap = new Map<ArtId, ArtRecord>();
  private readonly blobMap = new Map<BlobRef, Blob>();
  private readonly stepMap = new Map<StepId, StepSnapshot>();
  private readonly draftMap = new Map<ArtId, DeskDraft>();
  private readonly strokeMap = new Map<ArtId, Uint8Array[]>();
  private readonly cacheMap = new Map<string, unknown>();
  private readonly settingsMap = new Map<SettingsKey, unknown>();
  private readonly handleMap = new Map<WorldId, FileSystemFileHandle>();
  private log: AiLogEntry[] = [];
  private readonly urls = new Map<BlobRef, string>();
  private readonly listeners = new Set<(e: StoreChange) => void>();

  /** Reported to Settings → Storage (the whole store lives in this tab). */
  constructor(private readonly quota = 0) {}

  private emit(e: StoreChange): void {
    for (const fn of this.listeners) fn(e);
  }

  private setPutAway(id: WorldId, at: number | null): Promise<void> {
    const meta = this.metaMap.get(id);
    if (meta) this.metaMap.set(id, { ...meta, putAwayAt: at });
    this.emit({ worlds: [id] });
    return Promise.resolve();
  }

  worlds: Store['worlds'] = {
    list: async () => sortMetas([...this.metaMap.values()].map(clone)),
    get: async (id) => clone(this.worldMap.get(id) ?? null),
    putAway: (id) => this.setPutAway(id, Date.now()),
    restore: (id) => this.setPutAway(id, null),
    purge: async (id) => {
      this.worldMap.delete(id);
      this.metaMap.delete(id);
      this.handleMap.delete(id);
      for (const [sid, s] of this.stepMap) if (s.worldId === id) this.stepMap.delete(sid);
      this.emit({ worlds: [id] });
    },
  };

  art: Store['art'] = {
    get: async (id) => clone(this.artMap.get(id) ?? null),
    list: async (q) => [...this.artMap.values()].filter((a) => q?.shelf === undefined || a.shelf === q.shelf).map(clone),
    remove: async (id) => {
      this.artMap.delete(id);
      this.emit({ art: [id] });
    },
  };

  blobs: Store['blobs'] = {
    put: async (b) => {
      const ref = await blobRefOf(b);
      if (!this.blobMap.has(ref)) this.blobMap.set(ref, b);
      return ref;
    },
    get: async (r) => this.blobMap.get(r) ?? null,
    url: async (r) => {
      const known = this.urls.get(r);
      if (known) return known;
      const blob = this.blobMap.get(r);
      if (!blob) throw new Error(`Missing picture ${r}`);
      const url = URL.createObjectURL(blob);
      this.urls.set(r, url);
      return url;
    },
  };

  steps: Store['steps'] = {
    get: async (id) => clone(this.stepMap.get(id) ?? null),
    forWorld: async (id) => [...this.stepMap.values()].filter((s) => s.worldId === id).map((s) => s.id),
  };

  drafts: Store['drafts'] = {
    get: async (artId) => this.draftMap.get(artId) ?? null,
    put: async (d) => {
      this.draftMap.set(d.artId, d);
    },
    clear: async (artId) => {
      this.draftMap.delete(artId);
    },
  };

  strokes: Store['strokes'] = {
    append: async (artId, chunk) => {
      const list = this.strokeMap.get(artId) ?? [];
      list.push(chunk.slice());
      this.strokeMap.set(artId, list);
    },
    read: async (artId) => (this.strokeMap.get(artId) ?? []).map((c) => c.slice()),
    clear: async (artId) => {
      this.strokeMap.delete(artId);
    },
  };

  cache: Store['cache'] = {
    get: async <T>(key: string) => clone((this.cacheMap.get(key) as T | undefined) ?? null),
    put: async (key, value) => {
      this.cacheMap.set(key, clone(value));
    },
  };

  settings: Store['settings'] = {
    get: async <K extends SettingsKey>(k: K) => clone((this.settingsMap.get(k) as SettingsMap[K] | undefined) ?? null),
    put: async (k, v) => {
      this.settingsMap.set(k, clone(v));
    },
    remove: async (k) => {
      this.settingsMap.delete(k);
    },
  };

  handles: Store['handles'] = {
    get: async (worldId) => this.handleMap.get(worldId) ?? null,
    put: async (worldId, h) => {
      this.handleMap.set(worldId, h);
    },
  };

  ailog: Store['ailog'] = {
    add: async (e) => {
      this.log = [...this.log, clone(e)].slice(-KEEP.aiLogEntries);
    },
    list: async () => [...this.log].reverse().map(clone),
    clear: async () => {
      this.log = [];
    },
  };

  async commit(c: Commit): Promise<void> {
    // Everything is prepared first, then applied in one go (nothing awaits in between).
    const blobs = await Promise.all((c.blobs ?? []).map(async (blob) => [await blobRefOf(blob), blob] as const));
    const art = new Map((c.art ?? []).map((a) => [a.id, clone(a)]));
    const worlds = (c.worlds ?? []).map(clone);
    const metas = worlds.map((w) => deriveMeta(w, this.metaMap.get(w.id) ?? null, { snapshot: c.snapshots?.[w.id], art: (id) => art.get(id) ?? this.artMap.get(id) }));
    for (const [ref, blob] of blobs) if (!this.blobMap.has(ref)) this.blobMap.set(ref, blob);
    for (const a of art.values()) this.artMap.set(a.id, a);
    for (const s of c.steps ?? []) this.stepMap.set(s.id, clone(s));
    worlds.forEach((w, i) => {
      this.worldMap.set(w.id, w);
      this.metaMap.set(w.id, metas[i]);
    });
    const written = new Set(worlds.map((w) => w.id));
    for (const [id, ref] of Object.entries(c.snapshots ?? {})) {
      const m = this.metaMap.get(id);
      if (m && !written.has(id)) this.metaMap.set(id, { ...m, snapshot: ref });
    }
    for (const id of c.clearDrafts ?? []) this.draftMap.delete(id);
    const changed = [...new Set([...written, ...Object.keys(c.snapshots ?? {})])];
    if (changed.length || art.size) this.emit({ ...(changed.length ? { worlds: changed } : {}), ...(art.size ? { art: [...art.keys()] } : {}) });
  }

  async estimate(): Promise<{ usage: number; quota: number; persisted: boolean }> {
    let usage = 0;
    for (const b of this.blobMap.values()) usage += b.size;
    return { usage, quota: this.quota, persisted: false };
  }

  onChange(fn: (e: StoreChange) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}
