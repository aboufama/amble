/**
 * Stroke logs (§4.1, §7.6): handwriting dynamics (timing and pressure), which NH RSA 189:65 treats as
 * biometric data. They live only in this device-only store: never in files, never in requests. Chunks
 * are keyed `<artId>:<n>` (zero-padded) so they read back in the order they were written.
 */
import type { ArtId } from '../model/types';
import type { Store } from './api';
import { prefixRange, readAll, strokeIndex, strokeKey, writeTx, type IdbCtx } from './idb';

export function idbStrokes(ctx: IdbCtx): Store['strokes'] {
  // The next chunk number per drawing, learned from the store on the first append of a page.
  const next = new Map<ArtId, number>();
  return {
    append: (artId, chunk) =>
      writeTx(
        ctx,
        'strokes',
        (tx) => {
          const store = tx.objectStore('strokes');
          const known = next.get(artId);
          if (known !== undefined) {
            store.put(chunk, strokeKey(artId, known));
            next.set(artId, known + 1);
            return;
          }
          const last = store.openKeyCursor(prefixRange(artId), 'prev');
          last.onsuccess = () => {
            const n = last.result ? strokeIndex(String(last.result.key)) + 1 : 0;
            store.put(chunk, strokeKey(artId, n));
            next.set(artId, n + 1);
          };
        },
        'relaxed',
      ).catch((err: unknown) => {
        // The count may be off after a failed write: learn it again next time.
        next.delete(artId);
        throw err;
      }),
    read: (artId) => readAll<Uint8Array>(ctx, 'strokes', prefixRange(artId)),
    clear: (artId) =>
      writeTx(ctx, 'strokes', (tx) => {
        next.delete(artId);
        tx.objectStore('strokes').delete(prefixRange(artId));
      }),
  };
}
