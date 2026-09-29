/**
 * Where a cast member's unfinished drawing lives, and saves still landing after the Desk closed. Small on
 * purpose (no art core): Home reads them to know whether a starter copy holds the student's work.
 */
import { sha256Hex } from '../model/ids';
import type { ArtId, CastKey, WorldId } from '../model/types';

const BASE36 = '0123456789abcdefghijklmnopqrstuvwxyz';

/** The id of the drawing for cast member `key` of world `worldId` (stable, so unfinished work is found again). */
export async function artIdFor(worldId: WorldId, key: CastKey): Promise<ArtId> {
  const hex = await sha256Hex(new TextEncoder().encode(`desk:${worldId}/${key}`));
  let id = 'a_';
  for (let i = 0; i < 10; i++) id += BASE36[parseInt(hex.slice(i * 2, i * 2 + 2), 16) % 36];
  return id;
}

/** Saves still running when the Desk closed: the next Desk (and Home) wait for them. */
const pending = new Set<Promise<unknown>>();

export function savesSettled(): Promise<void> {
  return Promise.allSettled([...pending]).then(() => undefined);
}

export function trackSave<T>(p: Promise<T>): Promise<T> {
  pending.add(p);
  void p.finally(() => pending.delete(p)).catch(() => undefined);
  return p;
}
