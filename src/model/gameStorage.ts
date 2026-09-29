/**
 * A game's saved localStorage (`World.gameStorage`, §4.2) within its budget (§4.8: 64 KB of a world's
 * 200 KB). Game code writes whatever it likes, and a file can hold anything, so both the live path (the
 * player's `storage` message) and the file reader keep only what fits: entries in order, until the next
 * one would pass the budget. Pure.
 */
import { KEEP } from './limits';

export function keepGameStorage(data: Readonly<Record<string, string>>, budget: number = KEEP.gameStorageBytes): Record<string, string> {
  const kept: Record<string, string> = {};
  let bytes = 0;
  for (const [k, v] of Object.entries(data)) {
    if (typeof v !== 'string') continue;
    bytes += k.length + v.length;
    if (bytes > budget) break;
    kept[k] = v;
  }
  return kept;
}
