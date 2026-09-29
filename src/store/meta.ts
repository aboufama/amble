/**
 * `WorldMeta` (the Trail's index) derived from a world on every commit (§4.3). Pure.
 */
import type { ArtId, ArtRecord, BlobRef, World, WorldMeta } from '../model/types';

const encoder = new TextEncoder();

/** Size of a JSON value in bytes (UTF-8). */
export function jsonBytes(v: unknown): number {
  return encoder.encode(JSON.stringify(v)).length;
}

/** The drawing that plays the hero: the `hero` key, else the plan's first cast member, else the first drawn member. */
export function heroArt(world: World): ArtId | null {
  const byKey = world.cast.hero?.art;
  if (byKey) return byKey;
  const planHero = world.plan?.cast[0]?.key;
  if (planHero && world.cast[planHero]?.art) return world.cast[planHero].art;
  return Object.values(world.cast).find((s) => s.art !== null)?.art ?? null;
}

export interface MetaExtras {
  /** A new snapshot ref (undefined keeps the previous one). */
  snapshot?: BlobRef | null;
  /** Art records known to the caller, to pick walking characters. */
  art?: (id: ArtId) => ArtRecord | undefined;
}

export function deriveMeta(world: World, prev: WorldMeta | null, o: MetaExtras = {}): WorldMeta {
  const slots = Object.values(world.cast);
  const declared = slots.filter((s) => s.extra === null);
  const hero = heroArt(world);
  const walkers: ArtId[] = hero ? [hero] : [];
  for (const s of slots) {
    if (walkers.length >= 2) break;
    if (!s.art || walkers.includes(s.art)) continue;
    const rec = o.art?.(s.art);
    if (!rec || rec.kind === 'character') walkers.push(s.art);
  }
  return {
    id: world.id,
    title: world.title,
    createdAt: world.createdAt,
    updatedAt: world.updatedAt,
    openedAt: world.openedAt,
    snapshot: o.snapshot !== undefined ? o.snapshot : (prev?.snapshot ?? null),
    hero,
    walkers,
    drawn: declared.filter((s) => s.art !== null).length,
    needed: declared.length,
    bytes: jsonBytes(world),
    origin: world.origin.kind,
    assignment: world.assignment ? { title: world.assignment.title, due: world.assignment.due } : null,
    handedIn: world.handIn.turnedInAt,
    putAwayAt: prev?.putAwayAt ?? null,
  };
}

/** Most recently opened first. */
export function sortMetas(list: WorldMeta[]): WorldMeta[] {
  return [...list].sort((a, b) => b.openedAt - a.openedAt || b.updatedAt - a.updatedAt);
}
