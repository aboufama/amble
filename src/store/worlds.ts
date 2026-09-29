/**
 * Worlds and the Trail's index in IndexedDB (§4.3): `meta` is read first to paint the Trail, `worlds`
 * holds each world's JSON. Put away and restore touch only the meta; purge removes the world, its meta,
 * its footsteps and its kept file handle in one transaction (blobs are left to the GC).
 */
import type { World, WorldId, WorldMeta } from '../model/types';
import type { Store } from './api';
import { readAll, readOne, writeTx, type IdbCtx } from './idb';
import { sortMetas } from './meta';

function setPutAway(ctx: IdbCtx, id: WorldId, at: number | null): Promise<void> {
  return writeTx(ctx, 'meta', (tx) => {
    const store = tx.objectStore('meta');
    const get = store.get(id);
    get.onsuccess = () => {
      const meta = get.result as WorldMeta | undefined;
      if (meta) store.put({ ...meta, putAwayAt: at });
    };
  }).then(() => ctx.emit({ worlds: [id] }));
}

export function idbWorlds(ctx: IdbCtx): Store['worlds'] {
  return {
    list: async () => sortMetas(await readAll<WorldMeta>(ctx, 'meta')),
    get: (id) => readOne<World>(ctx, 'worlds', id),
    putAway: (id) => setPutAway(ctx, id, Date.now()),
    restore: (id) => setPutAway(ctx, id, null),
    purge: (id) =>
      writeTx(ctx, ['worlds', 'meta', 'steps', 'handles'], (tx) => {
        tx.objectStore('worlds').delete(id);
        tx.objectStore('meta').delete(id);
        tx.objectStore('handles').delete(id);
        const steps = tx.objectStore('steps');
        const keys = steps.index('byWorld').getAllKeys(id);
        keys.onsuccess = () => {
          for (const k of keys.result) steps.delete(k);
        };
      }).then(() => ctx.emit({ worlds: [id] })),
  };
}
