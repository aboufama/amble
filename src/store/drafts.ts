/**
 * The Desk's crash insurance (§4.4): the dirty cels of an open drawing, written at pen-up, keyed by
 * `ArtId`, cleared by the commit that saves the drawing. A draft still here at boot is work that was
 * never committed (a crash, a closed lid): it is newer than its drawing's record.
 */
import type { DeskDraft } from '../model/types';
import type { DraftInfo, Store } from './api';
import { readOne, writeTx, type IdbCtx } from './idb';

export function draftInfo(d: DeskDraft): DraftInfo {
  return { artId: d.artId, worldId: d.worldId, castKey: d.castKey, at: d.at };
}

export function idbDrafts(ctx: IdbCtx): Store['drafts'] {
  return {
    get: (artId) => readOne<DeskDraft>(ctx, 'drafts', artId),
    // Relaxed durability: drafts are written at every pen-up and must never slow the pen down.
    put: (d) => writeTx(ctx, 'drafts', (tx) => tx.objectStore('drafts').put(d), 'relaxed'),
    clear: (artId) => writeTx(ctx, 'drafts', (tx) => tx.objectStore('drafts').delete(artId)),
    list: async () => {
      const tx = await ctx.conn.tx('drafts');
      const out: DraftInfo[] = [];
      // A cursor, so the cels of every draft are never all in memory at once.
      await new Promise<void>((resolve, reject) => {
        const cursor = tx.objectStore('drafts').openCursor();
        cursor.onsuccess = () => {
          const c = cursor.result;
          if (!c) return resolve();
          out.push(draftInfo(c.value as DeskDraft));
          c.continue();
        };
        cursor.onerror = () => reject(cursor.error ?? new Error('Could not read the drafts.'));
      });
      return out.sort((a, b) => b.at - a.at);
    },
  };
}
