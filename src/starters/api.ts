/**
 * The starter worlds and seeds (§9, §8.4; M8): the catalog the Trail, New world, the AI ladder and the
 * legacy import use, made by `createStarterCatalog()`.
 */
import type { ArtScript } from '../cores/art';
import type { ArtId, ArtRecord, CastKey, Level, SeedId, StarterId, StarterInfo, World } from '../model/types';
import { getState } from '../state/store';
import { infoOf, metaOf, STARTERS } from './catalog';
import { matchIdea } from './match';
import { openStarter, type OpenDeps } from './open';

export interface StarterCatalog {
  /** The five starters, in Trail order. */
  list(): StarterInfo[];
  info(id: SeedId): StarterInfo;
  /** A new world copy. withArt: the starter's own drawings; otherwise a seed (only `hero`, if given, is drawn). */
  open(id: SeedId, o: { withArt: boolean; hero?: ArtId }): Promise<{ world: World; art: ArtRecord[]; blobs: Blob[] }>;
  /** For "Watch it drawn". */
  script(id: StarterId, key: CastKey): Promise<ArtScript | null>;
  /** The ladder's local keyword match (§5.9). */
  matchIdea(idea: string): StarterId;
}

export interface CatalogOptions {
  /** Prefix of the app's own URLs (default '': relative to the page, which works under any sub-path). */
  base?: string;
  fetchFile?: OpenDeps['fetchFile'];
  level?: () => Level;
  now?: () => number;
}

async function fetchSameOrigin(path: string): Promise<Blob> {
  const res = await fetch(path, { credentials: 'omit' });
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return res.blob();
}

export function createStarterCatalog(o: CatalogOptions = {}): StarterCatalog {
  const base = o.base ?? '';
  const deps: OpenDeps = {
    fetchFile: o.fetchFile ?? ((path) => fetchSameOrigin(base + path)),
    level: o.level ?? (() => getState().config.level),
    now: o.now ?? (() => Date.now()),
  };
  return {
    list: () => STARTERS.filter((s) => s.id !== 'parade').map((s) => infoOf(s, base)),
    info: (id) => infoOf(metaOf(id), base),
    open: (id, opts) => openStarter(id, opts, deps),
    async script(id, key) {
      const load = metaOf(id).scripts[key];
      return load ? load() : null;
    },
    matchIdea,
  };
}
