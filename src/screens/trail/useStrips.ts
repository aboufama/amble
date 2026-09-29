/**
 * Walk (or idle) strips for the Trail's characters, made one at a time after the landscape has painted
 * (idle time, in the rig worker), then read from `Store.cache` on later visits. Drawings without bones
 * stand still as their sticker.
 */
import { useEffect, useState } from 'react';
import { useServices } from '../../app/services';
import { stripFor, type Strip, type StripClip } from '../../home/strips';
import type { ArtId, ArtRecord } from '../../model/types';

export interface WalkerArt {
  id: ArtId;
  name: string;
  strip: Strip | null;
  /** The sticker (or the flat) for drawings without bones, and while the strip is made. */
  still: string | null;
}

function idle(fn: () => void): () => void {
  if (typeof requestIdleCallback === 'function') {
    const id = requestIdleCallback(fn, { timeout: 1200 });
    return () => cancelIdleCallback(id);
  }
  const id = setTimeout(fn, 300);
  return () => clearTimeout(id);
}

/** Loads the characters' strips for `clip`; the map fills in as they arrive. */
export function useStrips(ids: readonly ArtId[], clip: StripClip): Map<ArtId, WalkerArt> {
  const { store } = useServices();
  const [arts, setArts] = useState<Map<ArtId, WalkerArt>>(() => new Map());
  const key = ids.join(',');

  useEffect(() => {
    let live = true;
    let cancelIdle: (() => void) | null = null;
    const wanted = key ? key.split(',') : [];
    const run = async () => {
      for (const id of wanted) {
        if (!live) return;
        const record: ArtRecord | null = await store.art.get(id).catch(() => null);
        if (!live || !record?.export) continue;
        const still = await store.blobs.url(record.export.sticker).catch(() => null);
        if (!live) return;
        setArts((m) => new Map(m).set(id, { id, name: record.name, strip: m.get(id)?.strip ?? null, still }));
        if (!record.rigData) continue;
        const strip = await stripFor(store, { artHash: record.export.hash, flat: record.export.flat, rig: record.rigData }, clip);
        if (!live) return;
        setArts((m) => new Map(m).set(id, { id, name: record.name, strip, still }));
      }
    };
    cancelIdle = idle(() => void run());
    return () => {
      live = false;
      cancelIdle?.();
    };
  }, [key, clip, store]);

  return arts;
}
