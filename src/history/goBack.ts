/**
 * Go back (§2.9, §4.5): loads a step's snapshot into the world (code, cast, drawings, sounds, dials,
 * twists) and appends a "You went back to …" step. Nothing is deleted, so going back is itself undoable:
 * every step, including the ones after the target, stays in Footsteps.
 */
import type { ArtRecord, StepId, StepSnapshot, World } from '../model/types';
import { foldedSteps } from './prune';
import { headOf, type HistoryDeps } from './record';
import { artEntryOf, restoreArt, restoreWorld } from './snapshot';
import { wentBackText } from './summary';

export class GoBackError extends Error {
  constructor(
    readonly reason: 'unknown-step' | 'folded' | 'missing',
    message: string,
  ) {
    super(message);
    this.name = 'GoBackError';
  }
}

/** Whether a step can be gone back to (it exists, isn't the head, and its snapshot wasn't folded). */
export function canGoBack(world: World, to: StepId): boolean {
  const head = headOf(world);
  return world.steps.some((s) => s.id === to) && head?.id !== to && !foldedSteps(world.steps).has(to);
}

/** `HistoryApi.goBack`. Throws `GoBackError` when the step can't be restored (the world is untouched). */
export async function goBack(deps: HistoryDeps, world: World, to: StepId): Promise<World> {
  const target = world.steps.find((s) => s.id === to);
  if (!target) throw new GoBackError('unknown-step', `No step ${to} in this world.`);
  if (foldedSteps(world.steps).has(to)) throw new GoBackError('folded', `Step ${to} is folded.`);
  const store = deps.store();
  const snap = store ? await store.steps.get(to) : null;
  if (!snap || !store) throw new GoBackError('missing', `Step ${to} has no snapshot.`);
  const now = deps.now();
  const restored = restoreWorld(world, snap);

  // Drawings come back to the versions the step had (their records are shared, so they are rewritten).
  const art: ArtRecord[] = [];
  const entries: StepSnapshot['art'] = {};
  for (const [artId, entry] of Object.entries(snap.art)) {
    const current = await store.art.get(artId);
    const back = current ? restoreArt(current, entry, now) : null;
    if (back) art.push(back);
    entries[artId] = back ? artEntryOf(back) : current ? artEntryOf(current) : entry;
  }
  // Resting members kept from after the target keep their current drawing in the new snapshot.
  for (const slot of Object.values(restored.cast)) {
    if (slot.art && !(slot.art in entries)) {
      const record = await store.art.get(slot.art);
      if (record) entries[slot.art] = artEntryOf(record);
    }
  }

  const id = deps.newId();
  const next: World = {
    ...restored,
    steps: [...world.steps, { id, at: now, by: 'student', kind: 'goback', text: wentBackText(target) }],
    head: id,
    updatedAt: now,
  };
  const newSnap: StepSnapshot = {
    id,
    worldId: world.id,
    code: structuredClone(next.code),
    cast: structuredClone(next.cast),
    art: entries,
    sounds: structuredClone(next.sounds),
    dials: { ...next.dials },
    twists: [...next.twists],
  };
  await store.commit({ worlds: [next], art, steps: [newSnap] });
  return next;
}
