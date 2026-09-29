/**
 * "What Amble sends" (§2.15, §4.3): the last 50 AI requests exactly as sent, newest first. Local only,
 * clearable, never in files.
 */
import { KEEP } from '../model/limits';
import type { AiLogEntry } from '../model/types';
import type { Store } from './api';
import { readAll, writeTx, type IdbCtx } from './idb';

export function idbAiLog(ctx: IdbCtx): Store['ailog'] {
  return {
    add: (e) =>
      writeTx(
        ctx,
        'ailog',
        (tx) => {
          const store = tx.objectStore('ailog');
          store.add(e);
          const count = store.count();
          count.onsuccess = () => {
            let extra = count.result - KEEP.aiLogEntries;
            if (extra <= 0) return;
            const cursor = store.openCursor();
            cursor.onsuccess = () => {
              const c = cursor.result;
              if (!c || extra <= 0) return;
              c.delete();
              extra--;
              c.continue();
            };
          };
        },
        'relaxed',
      ),
    list: async () => (await readAll<AiLogEntry>(ctx, 'ailog')).reverse(),
    clear: () => writeTx(ctx, 'ailog', (tx) => tx.objectStore('ailog').clear()),
  };
}
