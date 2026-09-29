/**
 * Storage (§4.3, §4.4, §8.4; M6 owns). One IndexedDB database, `amble`, with atomic commits; blobs are
 * content-addressed and shared. When IndexedDB is blocked, the same interface runs in memory
 * (`mode: 'memory'`, files-only mode).
 */
import type {
  AiLogEntry,
  ArtId,
  ArtRecord,
  BlobRef,
  CastKey,
  DeskDraft,
  SettingsKey,
  SettingsMap,
  StepId,
  StepSnapshot,
  World,
  WorldId,
  WorldMeta,
} from '../model/types';

export interface Store {
  /** 'memory' = files-only mode (storage blocked). */
  readonly mode: 'idb' | 'memory';
  worlds: {
    /** The Trail's index (small, read first), most recently opened first; includes put-away worlds. */
    list(): Promise<WorldMeta[]>;
    get(id: WorldId): Promise<World | null>;
    /** To Lost and found (kept 30 days). */
    putAway(id: WorldId): Promise<void>;
    restore(id: WorldId): Promise<void>;
    /** Deletes the world, its meta, its steps and its file handle (blobs are left to the GC). */
    purge(id: WorldId): Promise<void>;
  };
  art: {
    get(id: ArtId): Promise<ArtRecord | null>;
    list(q?: { shelf?: boolean }): Promise<ArtRecord[]>;
    remove(id: ArtId): Promise<void>;
  };
  blobs: {
    /** Stores a blob (put-if-absent) and returns its content address. */
    put(b: Blob): Promise<BlobRef>;
    get(r: BlobRef): Promise<Blob | null>;
    /** An object URL for the blob, cached per ref for this page. */
    url(r: BlobRef): Promise<string>;
  };
  steps: {
    get(id: StepId): Promise<StepSnapshot | null>;
    forWorld(id: WorldId): Promise<StepId[]>;
    /**
     * An addition to the spec's interface: deletes these snapshots in one transaction (footsteps pruning;
     * the summaries stay in `World.steps`, and blobs are left to the GC). Unknown ids are skipped.
     */
    remove(ids: StepId[]): Promise<void>;
  };
  drafts: {
    get(artId: ArtId): Promise<DeskDraft | null>;
    put(d: DeskDraft): Promise<void>;
    clear(artId: ArtId): Promise<void>;
    /** An addition to the spec's interface: every draft's where and when (no pixels), newest first. */
    list(): Promise<DraftInfo[]>;
  };
  /** Device only: stroke logs (handwriting dynamics). Never exported, never sent. */
  strokes: {
    append(artId: ArtId, chunk: Uint8Array): Promise<void>;
    read(artId: ArtId): Promise<Uint8Array[]>;
    clear(artId: ArtId): Promise<void>;
  };
  cache: {
    get<T>(key: string): Promise<T | null>;
    put(key: string, value: unknown): Promise<void>;
  };
  settings: {
    get<K extends SettingsKey>(k: K): Promise<SettingsMap[K] | null>;
    put<K extends SettingsKey>(k: K, v: SettingsMap[K]): Promise<void>;
    /** An addition to the spec's interface: forget a setting (Leave this class, Delete everything). */
    remove(k: SettingsKey): Promise<void>;
  };
  handles: {
    get(worldId: WorldId): Promise<FileSystemFileHandle | null>;
    put(worldId: WorldId, h: FileSystemFileHandle): Promise<void>;
    /** An addition: forget a world's kept file (a read-only copy, or Save as). */
    remove(worldId: WorldId): Promise<void>;
    /** An addition: every kept file, to find a world that is already open from the same file. */
    all(): Promise<Array<{ worldId: WorldId; handle: FileSystemFileHandle }>>;
  };
  /** "What Amble sends": the last 50 AI requests, newest first. */
  ailog: {
    add(e: AiLogEntry): Promise<void>;
    list(): Promise<AiLogEntry[]>;
    clear(): Promise<void>;
  };
  /** The only way to write worlds, art records and steps: one IndexedDB transaction; meta is derived from each world. */
  commit(c: Commit): Promise<void>;
  estimate(): Promise<{ usage: number; quota: number; persisted: boolean }>;
  onChange(fn: (e: StoreChange) => void): () => void;
}

export interface Commit {
  /** New blobs (hashed before the transaction opens; existing refs are skipped). */
  blobs?: Blob[];
  worlds?: World[];
  art?: ArtRecord[];
  steps?: StepSnapshot[];
  clearDrafts?: ArtId[];
  /**
   * The Trail sign's snapshot per world (a ref to a blob already stored, or in `blobs`). An addition to the
   * spec's Commit: a snapshot is taken when the student leaves a world, and `WorldMeta.snapshot` keeps it.
   */
  snapshots?: Record<WorldId, BlobRef>;
}

export interface StoreChange {
  worlds?: WorldId[];
  art?: ArtId[];
}

/** A draft without its pixels: enough to find work that was never committed (a crash, a closed lid). */
export interface DraftInfo {
  artId: ArtId;
  worldId: WorldId | null;
  castKey: CastKey | null;
  at: number;
}

/**
 * Whether writes are landing. 'full' after a QuotaExceededError, 'error' after any other failed write,
 * 'ok' again after the next write that lands.
 */
export type StoreHealth = 'ok' | 'full' | 'error';

export interface GcReport {
  /** Blobs still referenced (or too new to judge). */
  kept: number;
  removed: number;
  /** Bytes freed. */
  bytes: number;
}

/**
 * Upkeep both stores provide beyond the spec's `Store` (§4.3, §2.15): the daily garbage collection, the
 * write health that turns into `library.storage`, sizes for the world budget and "Delete everything".
 */
export interface StoreUpkeep {
  /** Marks every BlobRef reachable from metas, worlds, art, steps, drafts and the cache; deletes the rest older than `graceMs`. */
  collectGarbage(o?: { now?: number; graceMs?: number }): Promise<GcReport>;
  /** Total bytes of these blobs (missing ones count 0). */
  blobBytes(refs: Iterable<BlobRef>): Promise<number>;
  /** Deletes everything this store keeps on this device. */
  wipe(): Promise<void>;
  health(): StoreHealth;
  onHealth(fn: (h: StoreHealth, err: unknown) => void): () => void;
}

export function upkeepOf(store: Store): (Store & StoreUpkeep) | null {
  const s = store as Partial<StoreUpkeep>;
  return typeof s.collectGarbage === 'function' && typeof s.onHealth === 'function' ? (store as Store & StoreUpkeep) : null;
}
