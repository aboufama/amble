/**
 * Which footsteps keep their snapshot (§4.5): the newest 60 of a world, and before them one per day (the
 * last step of each day). Summaries are never removed from `World.steps`; a step whose snapshot is
 * pruned is "folded": it still shows under "Earlier", but there is nothing to go back to.
 */
import { KEEP } from '../model/limits';
import type { StepId, StepSummary } from '../model/types';

export interface PrunePlan {
  keep: StepId[];
  /** Folded steps: their snapshots can be deleted. */
  drop: StepId[];
}

/** The local calendar day of a time (steps are grouped the way a student remembers them). */
export function dayOf(at: number): string {
  const d = new Date(at);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

/** `steps` oldest first, as in `World.steps`. */
export function prunePlan(steps: readonly StepSummary[], keepRecent: number = KEEP.stepsPerWorld): PrunePlan {
  const keep: StepId[] = [];
  const drop: StepId[] = [];
  const oldCount = Math.max(0, steps.length - keepRecent);
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    if (i >= oldCount) {
      keep.push(step.id);
      continue;
    }
    // An old step keeps its snapshot only if it is the last old step of its day.
    const next = i + 1 < oldCount ? steps[i + 1] : null;
    if (next && dayOf(next.at) === dayOf(step.at)) drop.push(step.id);
    else keep.push(step.id);
  }
  return { keep, drop };
}

/** The folded steps of a world (no snapshot to go back to). */
export function foldedSteps(steps: readonly StepSummary[], keepRecent: number = KEEP.stepsPerWorld): Set<StepId> {
  return new Set(prunePlan(steps, keepRecent).drop);
}

/** Snapshots that became prunable when `before` grew into `after`. */
export function newlyFolded(before: readonly StepSummary[], after: readonly StepSummary[], keepRecent: number = KEEP.stepsPerWorld): StepId[] {
  const was = foldedSteps(before, keepRecent);
  return prunePlan(after, keepRecent).drop.filter((id) => !was.has(id));
}
