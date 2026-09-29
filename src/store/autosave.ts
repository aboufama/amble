/**
 * Autosave (§4.4): world edits are debounced 800 ms, then written at idle (at most 2 s later) in one
 * commit. Hiding the tab, `pagehide` and `freeze` write everything pending at once. A failed write never
 * throws work away: the state turns to 'full' or 'error' and the next change tries again.
 */
import type { SaveState, World, WorldId } from '../model/types';
import type { Commit, Store } from './api';

export interface AutosaveOptions {
  debounceMs?: number;
  /** Longest wait for an idle moment after the debounce. */
  maxWaitMs?: number;
  /** Save state changes: 'saving' shows only when a save takes over 1 s. */
  onState?(state: SaveState): void;
  onError?(err: unknown): void;
  /** For tests: the window whose page events trigger a flush (default: the global one). */
  target?: Pick<Window, 'addEventListener' | 'removeEventListener'> & { document?: Pick<Document, 'visibilityState'> };
}

export interface Autosave {
  /** Queues a world (and anything to write with it); the latest version of each world wins. */
  schedule(world: World, extra?: Omit<Commit, 'worlds'>): void;
  /** Writes everything pending now. */
  flush(): Promise<void>;
  pending(): boolean;
  dispose(): void;
}

const SLOW_SAVE_MS = 1000;

type Idle = (cb: () => void, timeout: number) => () => void;

const idle: Idle = (cb, timeout) => {
  const ric = (globalThis as { requestIdleCallback?: (cb: () => void, o: { timeout: number }) => number }).requestIdleCallback;
  if (ric) {
    const id = ric(cb, { timeout });
    return () => (globalThis as { cancelIdleCallback?: (id: number) => void }).cancelIdleCallback?.(id);
  }
  const id = setTimeout(cb, 0);
  return () => clearTimeout(id);
};

function merge(a: Omit<Commit, 'worlds'>, b: Omit<Commit, 'worlds'>): Omit<Commit, 'worlds'> {
  const art = new Map([...(a.art ?? []), ...(b.art ?? [])].map((x) => [x.id, x]));
  const steps = new Map([...(a.steps ?? []), ...(b.steps ?? [])].map((x) => [x.id, x]));
  return {
    blobs: [...(a.blobs ?? []), ...(b.blobs ?? [])],
    art: [...art.values()],
    steps: [...steps.values()],
    clearDrafts: [...new Set([...(a.clearDrafts ?? []), ...(b.clearDrafts ?? [])])],
    snapshots: { ...a.snapshots, ...b.snapshots },
  };
}

function isQuota(err: unknown): boolean {
  return err instanceof DOMException ? err.name === 'QuotaExceededError' : err instanceof Error && err.name === 'QuotaExceededError';
}

export function createAutosave(store: Store, o: AutosaveOptions = {}): Autosave {
  const debounceMs = o.debounceMs ?? 800;
  const maxWaitMs = o.maxWaitMs ?? 2000;
  const target = o.target ?? (typeof window === 'undefined' ? null : window);
  let worlds = new Map<WorldId, World>();
  let extra: Omit<Commit, 'worlds'> = {};
  let timer: ReturnType<typeof setTimeout> | null = null;
  let cancelIdle: (() => void) | null = null;
  let running: Promise<void> = Promise.resolve();

  const setState = (s: SaveState) => o.onState?.(s);

  const write = (): Promise<void> => {
    if (timer) clearTimeout(timer);
    timer = null;
    cancelIdle?.();
    cancelIdle = null;
    if (!worlds.size && !Object.keys(extra).length) return running;
    const commit: Commit = { ...extra, worlds: [...worlds.values()] };
    worlds = new Map();
    extra = {};
    running = running.then(async () => {
      if (store.mode === 'memory') {
        await store.commit(commit);
        setState('files-only');
        return;
      }
      const slow = setTimeout(() => setState('saving'), SLOW_SAVE_MS);
      try {
        await store.commit(commit);
        setState('saved');
      } catch (err) {
        // Keep the work: put it back unless something newer is already queued.
        for (const w of commit.worlds ?? []) if (!worlds.has(w.id)) worlds.set(w.id, w);
        extra = merge(commit, extra);
        setState(isQuota(err) ? 'full' : 'error');
        o.onError?.(err);
      } finally {
        clearTimeout(slow);
      }
    });
    return running;
  };

  const onHide = () => {
    if (target?.document?.visibilityState === undefined || target.document.visibilityState === 'hidden') void write();
  };
  const onPageHide = () => void write();
  target?.addEventListener('visibilitychange', onHide);
  target?.addEventListener('pagehide', onPageHide);
  target?.addEventListener('freeze', onPageHide);

  return {
    schedule(world, more = {}) {
      worlds.set(world.id, world);
      extra = merge(extra, more);
      if (timer) clearTimeout(timer);
      cancelIdle?.();
      cancelIdle = null;
      timer = setTimeout(() => {
        timer = null;
        cancelIdle = idle(() => void write(), maxWaitMs);
      }, debounceMs);
    },
    flush: write,
    pending: () => worlds.size > 0 || timer !== null || cancelIdle !== null,
    dispose() {
      target?.removeEventListener('visibilitychange', onHide);
      target?.removeEventListener('pagehide', onPageHide);
      target?.removeEventListener('freeze', onPageHide);
      if (timer) clearTimeout(timer);
      cancelIdle?.();
    },
  };
}
