/**
 * Asks the world screen itself sends to the AI helper (§2.6): "Ask Amble to fix it" on the problem card,
 * "Ask Amble to add him" on a resting cast member, and "Add {name}, a {role}: {what}" after Add someone.
 * The running job shows in the `ai` slice like any Ask (the Ask card and the progress pill read it); an
 * accepted change goes into the world through `applyAccepted`. The world keeps playing meanwhile.
 */
import { getServices } from '../app/services';
import type { AiOutcome, AiProgress, CastKey, PlayerError } from '../model/types';
import { applyAccepted } from '../state/session';
import { getState, setState } from '../state/store';

let running: AbortController | null = null;

export function askBusy(): boolean {
  return !!getState().ai.job || !!running;
}

function progress(p: AiProgress): void {
  setState((s) => {
    if (s.ai.job) s.ai.job.progress = p;
  });
}

export async function runAsk(task: 'change' | 'fix', words: string, o: { scope?: CastKey; problems?: PlayerError[] } = {}): Promise<AiOutcome> {
  const world = getState().session.world;
  if (!world) return { kind: 'cancelled' };
  if (askBusy()) return { kind: 'cancelled' };
  const { ai } = getServices();
  const controller = new AbortController();
  running = controller;
  setState((s) => {
    s.ai.job = { worldId: world.id, task, request: words, progress: { phase: 'checking' }, startedAt: Date.now() };
  });
  let outcome: AiOutcome;
  try {
    const job = { signal: controller.signal, onProgress: progress };
    outcome = task === 'fix' ? await ai.fix(world, o.problems ?? getState().session.problems, job) : await ai.change(world, words, { ...job, scope: o.scope });
  } catch (err) {
    outcome = { kind: 'failed', reason: 'transport', message: err instanceof Error ? err.message : String(err), details: [] };
  } finally {
    if (running === controller) running = null;
  }
  if ((outcome.kind === 'accepted' || outcome.kind === 'fallback') && getState().session.world?.id === world.id) {
    await applyAccepted(outcome, { task, request: task === 'change' ? words : undefined }).catch((err: unknown) => console.warn(err));
  }
  setState((s) => {
    if (s.ai.job?.worldId === world.id) s.ai.job = null;
    s.ai.lastOutcome = outcome;
  });
  return outcome;
}

export function stopAsk(): void {
  running?.abort();
}
