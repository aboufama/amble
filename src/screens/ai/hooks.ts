/** Small helpers the AI cards share: the helper's richer interface, stickers, countdowns and names. */
import { useEffect, useState } from 'react';
import { useServices } from '../../app/services';
import type { GameManifest } from '../../cores/play';
import { t } from '../../i18n';
import type { ArtId, CastKey, StarterId, World } from '../../model/types';
import { asAmbleAi, type AmbleAi } from '../../pipeline/api';
import { humanKey } from '../../pipeline/keyNames';
import { nameInSentence } from './words';

export { nameInSentence };

/** The app's AI helper with what the cards need (level, host, district, retry). */
export function useAmbleAi(): AmbleAi | null {
  return asAmbleAi(useServices().ai);
}

/** The sticker of a drawing (an object URL), or null while it loads or when there is none. */
export function useArtSticker(artId: ArtId | null | undefined): string | null {
  const { store } = useServices();
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setUrl(null);
    if (!artId) return;
    void store.art
      .get(artId)
      .then((r) => (r?.export ? store.blobs.url(r.export.sticker) : null))
      .then((u) => {
        if (live) setUrl(u);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [artId, store]);
  return url;
}

/** Whole seconds left until `until` (a `Date.now()` time), ticking once a second; null without one. */
export function useCountdown(until: number | null): number | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (until === null) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [until]);
  return until === null ? null : Math.max(0, Math.ceil((until - now) / 1000));
}

/** A cast member's name from the running game's manifest, else its key in words. */
export function memberName(manifest: GameManifest | null, key: CastKey): string {
  return manifest?.art.find((a) => a.key === key)?.name || humanKey(key);
}

/** The hero: its key, name and drawing. */
export function heroOf(world: World | null, manifest: GameManifest | null): { key: CastKey; name: string; art: ArtId | null } {
  const need = manifest?.art.find((a) => a.role === 'hero');
  const key = need?.key ?? 'hero';
  return { key, name: need?.name || t('ai.heroFallback'), art: world?.cast[key]?.art ?? null };
}

/** The boss's name for the placeholders, or "the boss". */
export function bossName(manifest: GameManifest | null): string {
  const need = manifest?.art.find((a) => a.role === 'boss');
  return need?.name ? nameInSentence(need.name) : t('ai.bossFallback');
}

/** The starter a world began from, when it did. */
export function starterOf(world: World): StarterId | null {
  const o = world.origin;
  return o.kind === 'starter' || o.kind === 'plan' ? o.starter : o.kind === 'assignment' ? o.starter : null;
}
