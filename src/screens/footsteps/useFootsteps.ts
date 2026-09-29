/**
 * Data for the Footsteps panel: the world (the session's copy when it is the open world, else the
 * store's, kept fresh), a clock for "6 min" labels, and drawing stickers for draw steps (as they were at
 * that step, from its snapshot).
 */
import { useEffect, useState } from 'react';
import { useServices } from '../../app/services';
import type { StepId, StepSummary, World, WorldId } from '../../model/types';
import { useStore } from '../../state/store';
import type { Store } from '../../store/api';

export interface FootstepsWorld {
  world: World | null;
  loading: boolean;
}

export function useFootstepsWorld(worldId: WorldId): FootstepsWorld {
  const { store } = useServices();
  const sessionWorld = useStore((s) => (s.session.world?.id === worldId ? s.session.world : null));
  const inSession = sessionWorld !== null;
  const [stored, setStored] = useState<{ id: WorldId; world: World | null } | null>(null);
  useEffect(() => {
    if (inSession) return;
    let live = true;
    const load = () =>
      void store.worlds
        .get(worldId)
        .then((world) => live && setStored({ id: worldId, world }))
        .catch(() => live && setStored({ id: worldId, world: null }));
    load();
    const off = store.onChange((e) => {
      if (e.worlds?.includes(worldId)) load();
    });
    return () => {
      live = false;
      off();
    };
  }, [inSession, worldId, store]);
  if (sessionWorld) return { world: sessionWorld, loading: false };
  const mine = stored?.id === worldId ? stored : null;
  return { world: mine?.world ?? null, loading: mine === null };
}

/** "now" for time labels, ticking every 30 s while mounted. */
export function useNow(everyMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(id);
  }, [everyMs]);
  return now;
}

const DRAW_KINDS = new Set(['draw', 'redraw', 'bones']);
const stickerCache = new Map<StepId, Promise<string | null>>();

async function loadSticker(store: Store, step: StepSummary): Promise<string | null> {
  if (!step.cast) return null;
  const snap = await store.steps.get(step.id);
  const artId = snap?.cast[step.cast]?.art;
  const ref = artId ? snap?.art[artId]?.export?.sticker : null;
  if (!ref) return null;
  return store.blobs.url(ref).catch(() => null);
}

/** The sticker of the drawing a draw step made, as it was then (null while loading or when there is none). */
export function useStepSticker(step: StepSummary, enabled: boolean): string | null {
  const { store } = useServices();
  const [url, setUrl] = useState<string | null>(null);
  const wanted = enabled && DRAW_KINDS.has(step.kind) && !!step.cast;
  useEffect(() => {
    if (!wanted) return;
    let live = true;
    let promise = stickerCache.get(step.id);
    if (!promise) {
      promise = loadSticker(store, step).catch(() => null);
      stickerCache.set(step.id, promise);
    }
    void promise.then((u) => live && setUrl(u));
    return () => {
      live = false;
    };
  }, [wanted, step, store]);
  return wanted ? url : null;
}
