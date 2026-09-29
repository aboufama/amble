/**
 * Make a copy gives the copy its own drawings (§2.3, §2.6): each drawing the world's cast plays is a new record
 * under a new id, so drawing it again (or moving its bones) in the copy never changes the original. The pictures
 * are shared, not copied: blobs are content-addressed and never change, so a copy costs a few small records.
 */
import { uid } from '../model/ids';
import type { ArtId, ArtRecord, CastKey, CastSlot } from '../model/types';
import type { Store } from '../store/api';

export interface CopiedDrawings {
  /** The copy's cast: its slots point at the new records (a slot whose drawing is gone plays as just bones). */
  cast: Record<CastKey, CastSlot>;
  /** The new records, to commit with the copy. */
  art: ArtRecord[];
  /** Old id → new id. */
  ids: Map<ArtId, ArtId>;
}

export async function copyDrawings(store: Pick<Store, 'art'>, cast: Readonly<Record<CastKey, CastSlot>>, now = Date.now()): Promise<CopiedDrawings> {
  const ids = new Map<ArtId, ArtId>();
  const art: ArtRecord[] = [];
  const gone = new Set<ArtId>();
  for (const slot of Object.values(cast)) {
    if (!slot.art || ids.has(slot.art) || gone.has(slot.art)) continue;
    // A drawing that can't be read makes the copy fail (and say so) rather than share it.
    const rec = await store.art.get(slot.art);
    if (!rec) {
      gone.add(slot.art);
      continue;
    }
    const id = uid('a_');
    ids.set(slot.art, id);
    // The copy's drawing walks the Trail only with the copy (the original stays on the shelf when it is there).
    art.push({ ...structuredClone(rec), id, shelf: false, createdAt: now, updatedAt: now });
  }
  const next: Record<CastKey, CastSlot> = {};
  for (const [key, slot] of Object.entries(cast)) {
    const id = slot.art ? ids.get(slot.art) : undefined;
    next[key] = id ? { ...slot, art: id } : slot.art && gone.has(slot.art) ? { ...slot, art: null } : { ...slot };
  }
  return { cast: next, art, ids };
}

/** "Watch it drawn" in the copy too: the stroke logs (on this device only) go with the new ids. */
export async function copyStrokeLogs(store: Pick<Store, 'strokes'>, ids: ReadonlyMap<ArtId, ArtId>): Promise<void> {
  for (const [from, to] of ids) {
    try {
      for (const chunk of await store.strokes.read(from)) await store.strokes.append(to, chunk);
    } catch {
      // The log is a nicety: the drawing itself is copied.
    }
  }
}
