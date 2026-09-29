/**
 * Content-addressed blobs (§4.1, §4.3): the `blobs` store holds `{ blob, size, type, at }` under
 * `sha256:<hex>`, written once (put-if-absent) and shared by every world, drawing and footstep that
 * uses the same bytes. `at` is when the bytes were first stored: the GC never removes a blob younger
 * than a day, so a blob put ahead of its commit is safe.
 */
import { blobRefOf } from '../model/ids';
import type { BlobRef } from '../model/types';
import { Connection, done, req } from './idb';

export interface BlobRecord {
  blob: Blob;
  size: number;
  type: string;
  at: number;
}

export function blobRecord(blob: Blob, at: number): BlobRecord {
  return { blob, size: blob.size, type: blob.type, at };
}

/** Hashes blobs before a transaction opens (hashing is async; a transaction must not wait on it). */
export async function hashBlobs(blobs: Blob[]): Promise<Array<{ ref: BlobRef; blob: Blob }>> {
  const out = await Promise.all(blobs.map(async (blob) => ({ ref: await blobRefOf(blob), blob })));
  const seen = new Set<BlobRef>();
  return out.filter(({ ref }) => (seen.has(ref) ? false : (seen.add(ref), true)));
}

/** Queues put-if-absent writes of hashed blobs into an open readwrite transaction. */
export function putBlobsInTx(tx: IDBTransaction, blobs: Array<{ ref: BlobRef; blob: Blob }>, now: number): void {
  if (!blobs.length) return;
  const store = tx.objectStore('blobs');
  for (const { ref, blob } of blobs) {
    const has = store.getKey(ref);
    has.onsuccess = () => {
      if (has.result === undefined) store.put(blobRecord(blob, now), ref);
    };
  }
}

/** Object URLs per ref for this page. Blobs never change, so a URL stays right for the page's life. */
export class BlobUrls {
  private readonly urls = new Map<BlobRef, string>();

  async url(ref: BlobRef, get: (r: BlobRef) => Promise<Blob | null>): Promise<string> {
    const known = this.urls.get(ref);
    if (known) return known;
    const blob = await get(ref);
    if (!blob) throw new Error(`Missing picture ${ref}`);
    const again = this.urls.get(ref);
    if (again) return again;
    const url = URL.createObjectURL(blob);
    this.urls.set(ref, url);
    return url;
  }

  revokeAll(): void {
    for (const url of this.urls.values()) URL.revokeObjectURL(url);
    this.urls.clear();
  }
}

export function idbBlobs(conn: Connection, urls: BlobUrls, wrote: (err?: unknown) => void) {
  const get = async (ref: BlobRef): Promise<Blob | null> => {
    const tx = await conn.tx('blobs');
    const rec = (await req(tx.objectStore('blobs').get(ref))) as BlobRecord | undefined;
    return rec?.blob ?? null;
  };
  return {
    async put(blob: Blob): Promise<BlobRef> {
      const [{ ref }] = await hashBlobs([blob]);
      try {
        const tx = await conn.tx('blobs', 'readwrite');
        putBlobsInTx(tx, [{ ref, blob }], Date.now());
        await done(tx);
        wrote();
      } catch (err) {
        wrote(err);
        throw err;
      }
      return ref;
    },
    get,
    url: (ref: BlobRef) => urls.url(ref, get),
  };
}
