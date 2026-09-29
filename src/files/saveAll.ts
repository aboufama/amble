/**
 * Save all my worlds (§2.15, §4.6): one zip holding every world's `.amble` (put-away ones too), for the
 * end of a term or a cart that is about to be wiped. The `.amble` files are zips already, so they are
 * stored, not compressed again. A world that fails to pack is skipped, never the whole zip.
 */
import { zipSync, type Zippable } from 'fflate';
import type { Store } from '../store/api';
import { collectWorld, packAmble } from './amble';
import { uniqueName, worldFileName } from './names';

export interface SaveAllResult {
  zip: Blob;
  count: number;
  skipped: number;
}

export async function packAllWorlds(store: Store, now = Date.now()): Promise<SaveAllResult> {
  const files: Zippable = {};
  const taken = new Set<string>();
  let count = 0;
  let skipped = 0;
  for (const meta of await store.worlds.list()) {
    try {
      const world = await store.worlds.get(meta.id);
      if (!world) throw new Error('missing');
      const blob = await packAmble(await collectWorld(store, world, 'world', now));
      files[uniqueName(worldFileName(world.title, world.credits.madeBy || undefined), taken)] = [new Uint8Array(await blob.arrayBuffer()), { level: 0 }];
      count++;
    } catch (err) {
      console.warn(`World ${meta.id} was not packed:`, err);
      skipped++;
    }
  }
  const zipped = zipSync(files, { mtime: new Date(Math.max(now, Date.UTC(1981, 0, 1))) });
  return { zip: new Blob([zipped], { type: 'application/zip' }), count, skipped };
}
