/**
 * The starter worlds' heroes walking under their signs (§2.4). Their drawings are the starters' own small
 * files (`public/starters/<id>/art/<hero>/`): each hero stands on the trail as soon as its `art.json` is
 * read, drawn from its flat picture (no worker, nothing to open), and starts to walk once its strip is
 * baked in idle time; the strip cache makes later visits walk at once. A starter without a drawn hero
 * simply has no walker.
 */
import { useEffect, useRef, useState } from 'react';
import { useServices } from '../../app/services';
import { parseRig } from '../../cores/rigData';
import type { RigData } from '../../cores/rig';
import { stripFor } from '../../home/strips';
import type { ArtId, SeedId, StarterInfo } from '../../model/types';
import { readStarterArt, starterFile } from '../../starters/heroFiles';
import type { StarterArtJson } from '../../starters/types';
import { whenIdle, type WalkerArt } from './useStrips';

interface Hero {
  info: StarterInfo;
  dir: string;
  json: StarterArtJson;
  flat: string;
  rig: RigData;
}

/** The folder of a starter's hero drawing, next to its sign (which carries the app's base path). */
export function heroDir(info: StarterInfo): string | null {
  const at = info.sign.lastIndexOf('/');
  return at < 0 ? null : `${info.sign.slice(0, at + 1)}art/${info.heroKey}/`;
}

async function readHero(info: StarterInfo): Promise<Hero | null> {
  const dir = heroDir(info);
  if (!dir) return null;
  const json = await readStarterArt(dir);
  if (!json) return null;
  const file = json.export ? json.files[json.export.flat] : undefined;
  if (!json.export || !json.rigData || !file) return null;
  return { info, dir, json, flat: dir + file, rig: parseRig(json.rigData) };
}

export function useStarterWalkers(infos: readonly StarterInfo[]): Map<SeedId, WalkerArt> {
  const { store } = useServices();
  const [walkers, setWalkers] = useState<Map<SeedId, WalkerArt>>(() => new Map());
  const key = infos.map((i) => i.id).join(',');
  const current = useRef(infos);
  current.current = infos;

  useEffect(() => {
    let live = true;
    let cancelIdle: (() => void) | null = null;
    const heroes: Hero[] = [];
    const bake = async () => {
      for (const h of heroes) {
        if (!live) return;
        const strip = await stripFor(store, { artHash: h.json.export.hash, flat: () => starterFile(h.flat), rig: h.rig }, 'walk');
        if (!live) return;
        if (!strip) continue;
        setWalkers((m) => {
          const had = m.get(h.info.id);
          return had ? new Map(m).set(h.info.id, { ...had, strip }) : m;
        });
      }
    };
    void (async () => {
      const read = await Promise.all(current.current.map((info) => readHero(info).catch(() => null)));
      if (!live) return;
      const stand = new Map<SeedId, WalkerArt>();
      for (const h of read) {
        if (!h) continue;
        heroes.push(h);
        const exp = h.json.export;
        stand.set(h.info.id, { id: `starter:${h.info.id}` as ArtId, name: h.json.name, strip: null, still: h.flat, stillAt: { w: exp.w, h: exp.h, footX: exp.anchor[0], footY: exp.anchor[1] } });
      }
      setWalkers((m) => {
        const next = new Map(m);
        for (const [id, art] of stand) next.set(id, { ...art, strip: m.get(id)?.strip ?? null });
        return next;
      });
      cancelIdle = whenIdle(() => void bake().catch(() => undefined), 2500);
    })();
    return () => {
      live = false;
      cancelIdle?.();
    };
  }, [key, store]);

  return walkers;
}
