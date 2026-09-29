/**
 * A starter's own small drawing files, read from Amble's own address (`public/starters/<id>/art/<key>/`):
 * the Trail's starter walkers stand on them. Same origin, no credentials.
 */
import type { StarterArtJson } from './types';

export async function readStarterArt(dir: string): Promise<StarterArtJson | null> {
  const res = await fetch(`${dir}art.json`, { credentials: 'omit' }).catch(() => null);
  return res?.ok ? ((await res.json()) as StarterArtJson) : null;
}

export async function starterFile(url: string): Promise<Blob | null> {
  const res = await fetch(url, { credentials: 'omit' }).catch(() => null);
  return res?.ok ? res.blob() : null;
}
