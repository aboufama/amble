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
  };
  drafts: {
    get(artId: ArtId): Promise<DeskDraft | null>;
    put(d: DeskDraft): Promise<void>;
    clear(artId: ArtId): Promise<void>;
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
