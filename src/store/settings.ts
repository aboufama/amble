/**
 * Settings and the cache (§4.3). Settings hold one value per `SettingsKey`; the manual AI key is stored
 * only when "Remember on this Chromebook" is on (M7 decides), never in a school build. The cache holds
 * derived data only (rig binds, walk strips, starter replays), so it is safe to lose. Neither ever goes
 * into a file.
 */
import type { SettingsKey, SettingsMap } from '../model/types';
import type { Store } from './api';
import { readOne, writeTx, type IdbCtx } from './idb';

export function idbSettings(ctx: IdbCtx): Store['settings'] {
  return {
    get: <K extends SettingsKey>(k: K) => readOne<SettingsMap[K]>(ctx, 'settings', k),
    put: (k, v) => writeTx(ctx, 'settings', (tx) => tx.objectStore('settings').put(v, k)),
    remove: (k) => writeTx(ctx, 'settings', (tx) => tx.objectStore('settings').delete(k)),
  };
}

export function idbCache(ctx: IdbCtx): Store['cache'] {
  return {
    get: <T>(key: string) => readOne<T>(ctx, 'cache', key),
    put: (key, value) => writeTx(ctx, 'cache', (tx) => tx.objectStore('cache').put(value, key), 'relaxed'),
  };
}
