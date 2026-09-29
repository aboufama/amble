/**
 * Drawings (§4.3): small `ArtRecord` JSON, pixels in blobs. Records are written only by `commit` (with
 * their blobs, in one transaction); `remove` forgets one record (its blobs are left to the GC).
 */
import type { ArtRecord } from '../model/types';
import type { Store } from './api';
import { readAll, readOne, writeTx, type IdbCtx } from './idb';

export function idbArt(ctx: IdbCtx): Store['art'] {
  return {
    get: (id) => readOne<ArtRecord>(ctx, 'art', id),
    list: async (q) => {
      const all = await readAll<ArtRecord>(ctx, 'art');
      return q?.shelf === undefined ? all : all.filter((a) => a.shelf === q.shelf);
    },
    remove: (id) => writeTx(ctx, 'art', (tx) => tx.objectStore('art').delete(id)).then(() => ctx.emit({ art: [id] })),
  };
}
