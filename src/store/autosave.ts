/**
 * Autosave (§4.4): world edits are debounced 800 ms, then written at idle (at most 2 s later) in one
 * commit. Hiding the tab, `pagehide` and `freeze` write everything pending at once (a lid closing, a tab
 * discarded, a cart's profile wiped at logout). A failed write never throws work away: the state turns to
 * 'full' or 'error', the work stays queued, and it is tried again with the next change or after a short
 * wait, whichever comes first. The first write that lands asks the browser to keep Amble's data.
 */
import type { SaveState, World, WorldId } from '../model/types';
import type { Commit, Store } from './api';
import { isQuotaError, requestPersist } from './quota';

type EventHost = Pick<EventTarget, 'addEventListener' | 'removeEventListener'>;

export interface AutosaveOptions {
  debounceMs?: number;
  /** Longest wait for an idle moment after the debounce. */
  maxWaitMs?: number;
  /** Save state changes: 'saving' shows only when a save takes over 1 s. */
  onState?(state: SaveState): void;
  onError?(err: unknown): void;
  /**
   * For tests: one target for the page events (default: `visibilitychange` and `freeze` on the document,
   * `pagehide` on the window).
   */
  target?: EventHost & { document?: Pick<Document, 'visibilityState'> };
  /** Waits before trying a failed write again: 5 s, then 15 s, then every 30 s. */
  retryMs?: number[];
  /** Called after the first write that lands (default: `navigator.storage.persist()`, once). */
  onFirstSave?(): void;
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
const RETRY_MS = [5000, 15000, 30000];

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

function isEmpty(c: Omit<Commit, 'worlds'>): boolean {
  return !c.blobs?.length && !c.art?.length && !c.steps?.length && !c.clearDrafts?.length && !Object.keys(c.snapshots ?? {}).length;
}

/** Merges queued extras; for the same record, the later one wins. */
export function mergeExtra(a: Omit<Commit, 'worlds'>, b: Omit<Commit, 'worlds'>): Omit<Commit, 'worlds'> {
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

/** Where the page events come from: a test's target, or the real document and window. */
function pageEvents(o: AutosaveOptions): { on(fn: () => void, hideOnly: () => void): () => void } {
  if (o.target) {
    const t = o.target;
    return {
      on(fn, hideOnly) {
        t.addEventListener('visibilitychange', hideOnly);
        t.addEventListener('pagehide', fn);
        t.addEventListener('freeze', fn);
        return () => {
          t.removeEventListener('visibilitychange', hideOnly);
          t.removeEventListener('pagehide', fn);
          t.removeEventListener('freeze', fn);
        };
      },
    };
  }
  const doc = typeof document === 'undefined' ? null : document;
  const win = typeof window === 'undefined' ? null : window;
  return {
    on(fn, hideOnly) {
      doc?.addEventListener('visibilitychange', hideOnly);
      doc?.addEventListener('freeze', fn);
      win?.addEventListener('pagehide', fn);
      return () => {
        doc?.removeEventListener('visibilitychange', hideOnly);
        doc?.removeEventListener('freeze', fn);
        win?.removeEventListener('pagehide', fn);
      };
    },
  };
}

export function createAutosave(store: Store, o: AutosaveOptions = {}): Autosave {
  const debounceMs = o.debounceMs ?? 800;
  const maxWaitMs = o.maxWaitMs ?? 2000;
  const retries = o.retryMs ?? RETRY_MS;
  const visibility = (): DocumentVisibilityState | undefined =>
    o.target ? o.target.document?.visibilityState : typeof document === 'undefined' ? undefined : document.visibilityState;
  let worlds = new Map<WorldId, World>();
  let extra: Omit<Commit, 'worlds'> = {};
  let timer: ReturnType<typeof setTimeout> | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let failures = 0;
  let cancelIdle: (() => void) | null = null;
  let running: Promise<void> = Promise.resolve();
  let savedOnce = false;
  let disposed = false;

  const setState = (s: SaveState) => o.onState?.(s);

  const clearTimers = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = null;
    cancelIdle?.();
    cancelIdle = null;
  };

  const write = (): Promise<void> => {
    clearTimers();
    if (!worlds.size && isEmpty(extra)) return running;
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
        failures = 0;
        setState('saved');
        if (!savedOnce) {
          savedOnce = true;
          (o.onFirstSave ?? (() => void requestPersist()))();
        }
      } catch (err) {
        // Keep the work: put it back unless something newer is already queued.
        for (const w of commit.worlds ?? []) if (!worlds.has(w.id)) worlds.set(w.id, w);
        extra = mergeExtra(commit, extra);
        setState(isQuotaError(err) ? 'full' : 'error');
        o.onError?.(err);
        if (!disposed && !timer && !retryTimer) {
          retryTimer = setTimeout(() => {
            retryTimer = null;
            void write();
          }, retries[Math.min(failures, retries.length - 1)]);
        }
        failures++;
      } finally {
        clearTimeout(slow);
      }
    });
    return running;
  };

  const onHide = () => {
    const v = visibility();
    if (v === undefined || v === 'hidden') void write();
  };
  const onLeave = () => void write();
  const stop = pageEvents(o).on(onLeave, onHide);

  return {
    schedule(world, more = {}) {
      worlds.set(world.id, world);
      extra = mergeExtra(extra, more);
      clearTimers();
      timer = setTimeout(() => {
        timer = null;
        cancelIdle = idle(() => void write(), maxWaitMs);
      }, debounceMs);
    },
    flush: write,
    pending: () => worlds.size > 0 || !isEmpty(extra) || timer !== null || cancelIdle !== null || retryTimer !== null,
    dispose() {
      disposed = true;
      stop();
      clearTimers();
    },
  };
}
