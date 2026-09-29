/**
 * Kept file handles (§4.3, §4.6): the `.amble` file a world was saved to or opened from, so Save to Drive
 * and Ctrl+S overwrite the same file (asking for permission again when the browser needs it).
 */
import type { WorldId } from '../model/types';
import type { Store } from './api';
import { readOne, req, writeTx, type IdbCtx } from './idb';

export function idbHandles(ctx: IdbCtx): Store['handles'] {
  return {
    get: (worldId) => readOne<FileSystemFileHandle>(ctx, 'handles', worldId),
    put: (worldId, h) => writeTx(ctx, 'handles', (tx) => tx.objectStore('handles').put(h, worldId)),
    remove: (worldId) => writeTx(ctx, 'handles', (tx) => tx.objectStore('handles').delete(worldId)),
    all: async () => {
      const tx = await ctx.conn.tx('handles');
      const store = tx.objectStore('handles');
      const [keys, values] = await Promise.all([req(store.getAllKeys()), req(store.getAll())]);
      return keys.map((k, i) => ({ worldId: String(k) as WorldId, handle: values[i] as FileSystemFileHandle }));
    },
  };
}
