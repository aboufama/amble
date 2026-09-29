/**
 * Space on the device (§4.4, §4.8). A `QuotaExceededError` turns the store's health to 'full' (and
 * `library.storage` with it); passing 80 % of `navigator.storage.estimate().quota` shows the
 * "Space is getting low" chip; `navigator.storage.persist()` is asked once, on the first save, so the
 * browser keeps Amble's data when the disk runs low.
 */
import { LIMITS } from '../model/limits';
import type { World } from '../model/types';
import { upkeepOf, type Store, type StoreHealth } from './api';
import { markArt, markSet, markWorld } from './gc';
import { jsonBytes } from './meta';

/** Quota errors come as DOMException 'QuotaExceededError', or (older Chrome, some IDB paths) as code 22. */
export function isQuotaError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { name?: unknown; code?: unknown; message?: unknown; inner?: unknown };
  if (e.name === 'QuotaExceededError' || e.code === 22) return true;
  if (typeof e.message === 'string' && /quota|disk is full|no space/i.test(e.message)) return true;
  return false;
}

export function healthOf(err: unknown): StoreHealth {
  return isQuotaError(err) ? 'full' : 'error';
}

export interface SpaceInfo {
  usage: number;
  quota: number;
  persisted: boolean;
  /** Past the warning line (80 % of the quota). */
  low: boolean;
}

export function spaceInfo(e: { usage: number; quota: number; persisted: boolean }): SpaceInfo {
  return { ...e, low: e.quota > 0 && e.usage / e.quota >= LIMITS.storageWarnRatio };
}

type StorageManagerLike = Pick<StorageManager, 'persist' | 'persisted'>;

let asked: Promise<boolean> | null = null;

/**
 * Asks the browser to keep Amble's data (once per page; later calls return the first answer). Chrome
 * answers without a prompt, from how the site is used (installed, bookmarked, visited often).
 */
export function requestPersist(storage: StorageManagerLike | undefined = typeof navigator === 'undefined' ? undefined : navigator.storage): Promise<boolean> {
  if (asked) return asked;
  asked = (async () => {
    if (!storage?.persist) return false;
    try {
      if (await storage.persisted?.()) return true;
      return await storage.persist();
    } catch {
      return false;
    }
  })();
  return asked;
}

/** For tests: forget the answer. */
export function resetPersistRequest(): void {
  asked = null;
}

/** "38 MB", "1.2 GB" (Settings → Storage, the big-file dialogs). */
export function formatBytes(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  if (mb >= 1000) return `${(mb / 1024).toFixed(1).replace(/\.0$/, '')} GB`;
  if (mb >= 10) return `${Math.round(mb)} MB`;
  if (mb >= 1) return `${mb.toFixed(1).replace(/\.0$/, '')} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** Whole megabytes, as the file dialogs say them ("This world is 42 MB"). */
export function megabytes(bytes: number): number {
  return Math.max(1, Math.round(bytes / (1024 * 1024)));
}

export interface WorldSize {
  /** The world's JSON, its drawings' pixels and its recorded sounds (footsteps not counted). */
  bytes: number;
  /** Past 40 MB: say it is big. */
  warn: boolean;
  /** Past 60 MB: no new drawings ("This world is very big. Save it to Drive and start a new one."). */
  refuse: boolean;
}

/** How big a world is against its budget (§4.8), for the Desk before a new drawing and for Tidy up. */
export async function measureWorld(store: Store, world: World): Promise<WorldSize> {
  const { refs, mark } = markSet();
  markWorld(world, mark);
  for (const id of new Set(Object.values(world.cast).flatMap((s) => (s.art ? [s.art] : [])))) {
    const art = await store.art.get(id).catch(() => null);
    if (art) markArt(art, mark);
  }
  const upkeep = upkeepOf(store);
  const bytes = jsonBytes(world) + (upkeep ? await upkeep.blobBytes(refs) : 0);
  return { bytes, warn: bytes >= LIMITS.worldBlobsWarnBytes, refuse: bytes >= LIMITS.worldBlobsRefuseBytes };
}
