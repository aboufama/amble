/**
 * Opens "See the change" for a step from anywhere (the Ask card's "Amble changed your world" toast, "See
 * them" after the AI touched the student's lines): the world's Footsteps panel listens and opens its sheet.
 */
import type { StepId, WorldId } from '../../model/types';

type Listener = (worldId: WorldId, stepId: StepId) => void;

const listeners = new Set<Listener>();
let pending: { worldId: WorldId; stepId: StepId } | null = null;

/** Asks the Footsteps panel of `worldId` to show what `stepId` changed. */
export function seeChange(worldId: WorldId, stepId: StepId): void {
  if (!listeners.size) {
    pending = { worldId, stepId };
    return;
  }
  for (const fn of listeners) fn(worldId, stepId);
}

/** For the panel: calls `fn` for requests (including one made just before it mounted). */
export function onSeeChange(fn: Listener): () => void {
  listeners.add(fn);
  if (pending) {
    const p = pending;
    pending = null;
    fn(p.worldId, p.stepId);
  }
  return () => listeners.delete(fn);
}
