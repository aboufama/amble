/**
 * The Trail's characters: each one stands on the trail as soon as its drawing is read (its flat picture,
 * feet where its walk will put them), and starts to walk once its strip is made, one at a time after the
 * landscape has painted (idle time, in the rig worker), or read from `Store.cache` on later visits.
 * Drawings without bones stand still.
 */
import { useEffect, useState } from 'react';
import { useServices } from '../../app/services';
import { stripFor, type Strip, type StripClip } from '../../home/strips';
import type { ArtId, ArtRecord } from '../../model/types';

/** Where a still picture's feet are: its size and the feet inside it (picture px). */
export interface StillAt {
  w: number;
  h: number;
  footX: number;
  footY: number;
}

export interface WalkerArt {
  id: ArtId;
  name: string;
  strip: Strip | null;
  /** The drawing's picture: shown standing until its strip is made, and for drawings without bones. */
  still: string | null;
  stillAt: StillAt | null;
}

/** Runs `fn` when the page is idle (at the latest after `timeout` ms); returns a cancel. */
export function whenIdle(fn: () => void, timeout = 1200): () => void {
  if (typeof requestIdleCallback === 'function') {
    const id = requestIdleCallback(fn, { timeout });
    return () => cancelIdleCallback(id);
  }
  const id = setTimeout(fn, 300);
  return () => clearTimeout(id);
}

/** Loads the characters for `clip`: their pictures at once, their strips as they are made. */
export function useStrips(ids: readonly ArtId[], clip: StripClip): Map<ArtId, WalkerArt> {
  const { store } = useServices();
  const [arts, setArts] = useState<Map<ArtId, WalkerArt>>(() => new Map());
  const key = ids.join(',');

  useEffect(() => {
    let live = true;
    let cancelIdle: (() => void) | null = null;
    const wanted = key ? key.split(',') : [];
    const records: ArtRecord[] = [];
    const bake = async () => {
      for (const record of records) {
        if (!live) return;
        if (!record.rigData || !record.export) continue;
        const strip = await stripFor(store, { artHash: record.export.hash, flat: record.export.flat, rig: record.rigData }, clip);
        if (!live) return;
        if (!strip) continue;
        setArts((m) => {
          const had = m.get(record.id);
          return had ? new Map(m).set(record.id, { ...had, strip }) : m;
        });
      }
    };
    void (async () => {
      for (const id of wanted) {
        const record: ArtRecord | null = await store.art.get(id).catch(() => null);
        if (!live) return;
        const exp = record?.export;
        if (!record || !exp) continue;
        records.push(record);
        const still = await store.blobs.url(exp.flat).catch(() => null);
        if (!live) return;
        const stillAt: StillAt = { w: exp.w, h: exp.h, footX: exp.anchor[0], footY: exp.anchor[1] };
        setArts((m) => new Map(m).set(id, { id, name: record.name, strip: m.get(id)?.strip ?? null, still, stillAt }));
      }
      if (live) cancelIdle = whenIdle(() => void bake());
    })();
    return () => {
      live = false;
      cancelIdle?.();
    };
  }, [key, clip, store]);

  return arts;
}
