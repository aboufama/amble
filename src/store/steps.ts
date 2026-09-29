/**
 * Footsteps snapshots (§4.5): one `StepSnapshot` per step, indexed by world. Written only by `commit`;
 * they hold `BlobRef`s, so an unchanged drawing costs a few hundred bytes per step. `remove` deletes the
 * snapshots of folded steps (their blobs are left to the GC).
 */
import type { StepId, StepSnapshot } from '../model/types';
import type { Store } from './api';
import { readOne, req, writeTx, type IdbCtx } from './idb';

export function idbSteps(ctx: IdbCtx): Store['steps'] {
  return {
    get: (id) => readOne<StepSnapshot>(ctx, 'steps', id),
    forWorld: async (id) => {
      const tx = await ctx.conn.tx('steps');
      return (await req(tx.objectStore('steps').index('byWorld').getAllKeys(id))) as StepId[];
    },
    remove: async (ids) => {
      if (!ids.length) return;
      await writeTx(ctx, 'steps', (tx) => {
        const steps = tx.objectStore('steps');
        for (const id of new Set(ids)) steps.delete(id);
      });
    },
  };
}
