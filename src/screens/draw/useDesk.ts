/**
 * React glue for the Desk's controller: its state as a store (`useDeskState`), its events
 * (`useDeskEvent`), and layer thumbnails kept fresh after each change without blocking drawing.
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { DeskController, DeskEvent, DeskState } from '../../draw/deskController';

const noop = (): void => undefined;

export function useDeskState(ctrl: DeskController | null): DeskState | null {
  const subscribe = useCallback((fn: () => void) => (ctrl ? ctrl.subscribe(fn) : noop), [ctrl]);
  const snapshot = useCallback(() => (ctrl ? ctrl.getSnapshot() : null), [ctrl]);
  return useSyncExternalStore(subscribe, snapshot);
}

export function useDeskEvent(ctrl: DeskController | null, fn: (e: DeskEvent) => void): void {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => ctrl?.onEvent((e) => ref.current(e)), [ctrl]);
}

type IdleWindow = Window & { requestIdleCallback?: (fn: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (id: number) => void };

function whenIdle(fn: () => void): () => void {
  const w = window as IdleWindow;
  if (w.requestIdleCallback) {
    const id = w.requestIdleCallback(fn, { timeout: 800 });
    return () => w.cancelIdleCallback?.(id);
  }
  const id = window.setTimeout(fn, 60);
  return () => clearTimeout(id);
}

/**
 * Thumbnails of the layers (ImageBitmaps, `size` px), redrawn at idle for the layers a change touched
 * (all of them after an undo), one at a time so a pen never waits.
 */
export function useLayerThumbs(ctrl: DeskController | null, ids: readonly string[], size = 44): ReadonlyMap<string, ImageBitmap> {
  const [thumbs, setThumbs] = useState<ReadonlyMap<string, ImageBitmap>>(() => new Map());
  const stale = useRef(new Set<string>());
  const known = useRef(new Set<string>());
  const [tick, setTick] = useState(0);

  // New layers need a thumbnail; removed ones drop theirs.
  const key = ids.join('|');
  useEffect(() => {
    let changed = false;
    for (const id of ids)
      if (!known.current.has(id)) {
        known.current.add(id);
        stale.current.add(id);
        changed = true;
      }
    for (const id of [...known.current])
      if (!ids.includes(id)) {
        known.current.delete(id);
        stale.current.delete(id);
      }
    if (changed) setTick((n) => n + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useDeskEvent(ctrl, (e) => {
    if (e.type !== 'penup') return;
    if (e.layer && e.op !== 'layer' && e.op !== 'frame') stale.current.add(e.layer);
    else for (const id of known.current) stale.current.add(id);
    setTick((n) => n + 1);
  });

  useEffect(() => {
    if (!ctrl) return;
    return ctrl.surface.on('history', () => {
      for (const id of known.current) stale.current.add(id);
      setTick((n) => n + 1);
    });
  }, [ctrl]);

  useEffect(() => {
    if (!ctrl || !stale.current.size) return;
    let cancelled = false;
    let cancelIdle = noop;
    // The layer being drawn now goes back on the list if this run is cancelled half way.
    let current: string | null = null;
    const timer = window.setTimeout(() => {
      const next = (): void => {
        current = null;
        if (cancelled) return;
        const id = stale.current.values().next().value;
        if (id === undefined) return;
        stale.current.delete(id);
        current = id;
        cancelIdle = whenIdle(() => {
          if (cancelled) return;
          if (!ctrl.getSnapshot().ready) return next();
          ctrl.surface.thumbnail(id, size).then(
            (bmp) => {
              if (cancelled) return bmp.close();
              setThumbs((m) => {
                const out = new Map(m);
                out.set(id, bmp);
                return out;
              });
              next();
            },
            () => next(),
          );
        });
      };
      next();
    }, 300);
    return () => {
      cancelled = true;
      if (current) stale.current.add(current);
      clearTimeout(timer);
      cancelIdle();
    };
  }, [ctrl, tick, size]);

  return thumbs;
}
