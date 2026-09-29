/**
 * The starter worlds' heroes walking under their signs (§2.4). Their drawings come with the starter
 * (not the student's store), so the first visit opens each starter once in idle time, finds its hero's
 * drawing and bakes its walk strip; after that a small cache entry per starter (and the strip cache) make
 * it free. A catalog without drawings simply has no walkers.
 */
import { useEffect, useRef, useState } from 'react';
import { BUILD } from '../../app/env';
import { useServices } from '../../app/services';
import { parseRig, type RigData } from '../../cores/rig';
import { stripFor } from '../../home/strips';
import { blobRefOf } from '../../model/ids';
import type { ArtId, SeedId, StarterInfo } from '../../model/types';
import type { WalkerArt } from './useStrips';

interface StarterWalkerEntry {
  id: ArtId;
  name: string;
  artHash: string;
  rig: RigData;
}

function cacheKey(id: SeedId): string {
  return `trail:starter:${id}:${BUILD.version}`;
}

export function useStarterWalkers(infos: readonly StarterInfo[]): Map<SeedId, WalkerArt> {
  const { store, starters } = useServices();
  const [walkers, setWalkers] = useState<Map<SeedId, WalkerArt>>(() => new Map());
  const key = infos.map((i) => i.id).join(',');
  const current = useRef(infos);
  current.current = infos;

  useEffect(() => {
    let live = true;
    const run = async () => {
      for (const info of current.current) {
        if (!live) return;
        let entry = await store.cache.get<StarterWalkerEntry | 'none'>(cacheKey(info.id)).catch(() => null);
        let flat: Blob | null = null;
        if (entry === null) {
          const opened = await starters.open(info.id, { withArt: true }).catch(() => null);
          const heroArt = opened?.world.cast[info.heroKey]?.art ?? null;
          const record = heroArt ? opened?.art.find((a) => a.id === heroArt) : undefined;
          if (opened && record?.export && record.rigData) {
            for (const b of opened.blobs) {
              if ((await blobRefOf(b)) === record.export.flat) {
                flat = b;
                break;
              }
            }
            entry = { id: record.id, name: record.name, artHash: record.export.hash, rig: record.rigData };
          } else entry = 'none';
          await store.cache.put(cacheKey(info.id), entry).catch(() => undefined);
        }
        if (!live || entry === 'none' || !entry) continue;
        let rig: RigData;
        try {
          rig = parseRig(entry.rig);
        } catch {
          continue;
        }
        const strip = await stripFor(store, { artHash: entry.artHash, flat, rig }, 'walk');
        if (!live || !strip) continue;
        const art: WalkerArt = { id: entry.id, name: entry.name, strip, still: null };
        setWalkers((m) => new Map(m).set(info.id, art));
      }
    };
    const start = () => void run().catch(() => undefined);
    const handle = typeof requestIdleCallback === 'function' ? requestIdleCallback(start, { timeout: 2500 }) : window.setTimeout(start, 800);
    return () => {
      live = false;
      if (typeof cancelIdleCallback === 'function') cancelIdleCallback(handle);
      else clearTimeout(handle);
    };
  }, [key, store, starters]);

  return walkers;
}
