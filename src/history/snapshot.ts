/**
 * Step snapshots (§4.5): the world's code, cast, drawing versions, sounds, dials and twists at a step.
 * Drawings are held by `BlobRef` (content addresses), so an unchanged drawing costs a few hundred bytes
 * and every snapshot shares its pixels with the art record and the other snapshots.
 */
import type { ArtId, ArtRecord, CastKey, CastSlot, StepId, StepSnapshot, World } from '../model/types';

export type ArtEntry = StepSnapshot['art'][ArtId];

function clone<T>(v: T): T {
  return structuredClone(v);
}

/** What a snapshot keeps of a drawing: its version and the refs of its pixels and bones. */
export function artEntryOf(record: ArtRecord): ArtEntry {
  return {
    version: record.version,
    doc: record.doc,
    cels: [...record.cels],
    export: record.export ? clone(record.export) : null,
    rigData: record.rigData ? clone(record.rigData) : null,
  };
}

/** The drawings the world's cast uses. */
export function artIdsOf(cast: Record<CastKey, CastSlot>): ArtId[] {
  return [...new Set(Object.values(cast).flatMap((slot) => (slot.art ? [slot.art] : [])))];
}

/** Snapshots a world under a step id (reading each drawing's current record). */
export async function snapshotOf(world: World, id: StepId, getArt: (id: ArtId) => Promise<ArtRecord | null>): Promise<StepSnapshot> {
  const art: StepSnapshot['art'] = {};
  for (const artId of artIdsOf(world.cast)) {
    const record = await getArt(artId);
    if (record) art[artId] = artEntryOf(record);
  }
  return {
    id,
    worldId: world.id,
    code: clone(world.code),
    cast: clone(world.cast),
    art,
    sounds: clone(world.sounds),
    dials: { ...world.dials },
    twists: [...world.twists],
  };
}

/**
 * The world as it was at a snapshot. Drawn members that the snapshot doesn't know (added later) stay on
 * the cast line as resting members, so going back never hides a drawing.
 */
export function restoreWorld(world: World, snap: StepSnapshot): World {
  const cast: Record<CastKey, CastSlot> = clone(snap.cast);
  for (const [key, slot] of Object.entries(world.cast)) {
    if (!(key in cast) && slot.art) cast[key] = { ...clone(slot), laterUntil: 0 };
  }
  return {
    ...world,
    code: clone(snap.code),
    cast,
    sounds: clone(snap.sounds),
    dials: { ...snap.dials },
    twists: [...snap.twists],
  };
}

function sameRig(a: ArtEntry['rigData'], b: ArtEntry['rigData']): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Whether a drawing's record already matches a snapshot entry (pixels, export and bones). */
export function sameArt(record: ArtRecord, entry: ArtEntry): boolean {
  return (
    record.doc === entry.doc &&
    (record.export?.hash ?? null) === (entry.export?.hash ?? null) &&
    (record.export?.flat ?? null) === (entry.export?.flat ?? null) &&
    sameRig(record.rigData, entry.rigData)
  );
}

/** Whether games see the same drawing (export and bones), whatever the Desk saved since. */
function sameInGame(record: ArtRecord, entry: ArtEntry): boolean {
  return (
    (record.export?.hash ?? null) === (entry.export?.hash ?? null) &&
    (record.export?.flat ?? null) === (entry.export?.flat ?? null) &&
    sameRig(record.rigData, entry.rigData)
  );
}

/**
 * A drawing brought back to a snapshot's version, or null when it already is. The version goes up (never
 * back), because caches and the running game key drawings by version and hash. When games saw the same
 * drawing then as now, only the Desk's unfinished work (saved at a checkpoint, not brought to life yet)
 * is newer: no footstep holds it, so Go back leaves it where it is.
 */
export function restoreArt(record: ArtRecord, entry: ArtEntry, now: number): ArtRecord | null {
  if (sameArt(record, entry) || sameInGame(record, entry)) return null;
  return {
    ...record,
    doc: entry.doc,
    cels: [...entry.cels],
    export: entry.export ? clone(entry.export) : null,
    rigData: entry.rigData ? clone(entry.rigData) : null,
    version: record.version + 1,
    updatedAt: now,
  };
}

/** The parts of a cast that make a difference to the game (not the request tag's "Later" snooze). */
function castSignature(cast: Record<CastKey, CastSlot>): string {
  return JSON.stringify(
    Object.keys(cast)
      .sort()
      .map((k) => [k, cast[k].art, cast[k].madeBy, cast[k].extra]),
  );
}

type Comparable = Pick<StepSnapshot, 'code' | 'cast' | 'sounds' | 'twists'>;

/** Whether two snapshots (or a snapshot and a world) differ only in their dials. */
export function onlyDialsDiffer(a: Comparable, b: Comparable): boolean {
  return (
    JSON.stringify(a.code) === JSON.stringify(b.code) &&
    castSignature(a.cast) === castSignature(b.cast) &&
    JSON.stringify(a.sounds) === JSON.stringify(b.sounds) &&
    JSON.stringify(a.twists) === JSON.stringify(b.twists)
  );
}

/** Dial keys whose values differ. */
export function changedDials(a: Record<string, number>, b: Record<string, number>): string[] {
  return [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => a[k] !== b[k]);
}
