/**
 * Asks the world screen sends itself to the AI helper (§2.6): "Ask Amble to fix it" on the problem card,
 * "Ask Amble to add him" on a resting cast member, and "Add {name}, a {role}: {what}" after Add someone.
 * They run as the AI slice's jobs, like any Ask: the Ask card and the progress pill show them, its Stop
 * stops them, their outcome (a failure, a refusal, the crisis card) shows in the Ask card, and an accepted
 * change goes into the world through `applyAccepted`. The world keeps playing meanwhile.
 */
import type { AiOutcome, CastKey, PlayerError } from '../model/types';
import { isWorking, startChange, startFix } from '../state/ai';
import { getState } from '../state/store';

/** Is the open world's AI helper already working on something? (One job per world, §2.8.) */
export function askBusy(): boolean {
  const world = getState().session.world;
  return !!world && isWorking(world.id);
}

export async function runAsk(task: 'change' | 'fix', words: string, o: { scope?: CastKey; problems?: PlayerError[] } = {}): Promise<AiOutcome> {
  const world = getState().session.world;
  if (!world || askBusy()) return { kind: 'cancelled' };
  return task === 'fix' ? startFix(world, o.problems ?? getState().session.problems, words) : startChange(world, words, o.scope ?? null);
}
