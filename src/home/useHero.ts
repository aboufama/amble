/**
 * A stored character for Home's cards and sheets: its record and its picture posed at `idle`, t 0.3
 * (`renderPose`, made once per drawing version).
 */
import { useEffect, useState } from 'react';
import { useServices } from '../app/services';
import type { ArtId, ArtRecord } from '../model/types';
import { renderPose, type PoseImage } from './seedThumbs';

export interface HeroView {
  record: ArtRecord | null;
  pose: PoseImage | null;
  /** The sticker's object URL (UI cards), when the drawing has been brought to life. */
  sticker: string | null;
  loaded: boolean;
}

const NONE: HeroView = { record: null, pose: null, sticker: null, loaded: true };

/** Poses a record that has an export; null when it has none yet. */
export async function poseOf(store: ReturnType<typeof useServices>['store'], record: ArtRecord): Promise<PoseImage | null> {
  if (!record.export) return null;
  const flat = await store.blobs.get(record.export.flat);
  if (!flat) return null;
  return renderPose(`${record.id}:${record.version}`, flat, record.rigData, record.export.anchor);
}

export function useHero(artId: ArtId | null): HeroView {
  const { store } = useServices();
  const [view, setView] = useState<HeroView>(artId ? { record: null, pose: null, sticker: null, loaded: false } : NONE);
  useEffect(() => {
    if (!artId) {
      setView(NONE);
      return;
    }
    let live = true;
    setView({ record: null, pose: null, sticker: null, loaded: false });
    void (async () => {
      const record = await store.art.get(artId).catch(() => null);
      if (!live) return;
      if (!record) {
        setView(NONE);
        return;
      }
      const sticker = record.export ? await store.blobs.url(record.export.sticker).catch(() => null) : null;
      if (!live) return;
      setView({ record, pose: null, sticker, loaded: true });
      const pose = await poseOf(store, record).catch(() => null);
      if (live) setView({ record, pose, sticker, loaded: true });
    })();
    return () => {
      live = false;
    };
  }, [artId, store]);
  return view;
}
