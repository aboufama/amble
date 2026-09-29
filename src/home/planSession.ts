/**
 * The idea on its way to a plan (§2.5): the words, the hero they are for, the plan call while it runs,
 * and its outcome. It lives outside any screen, so the idea survives going from the First page or the
 * New world sheet to `#/plan`, and a reload of `#/plan` (kept in this tab's sessionStorage) shows the
 * same plan again. Nothing here is ever sent anywhere except through `AiService.plan`.
 */
import { useSyncExternalStore } from 'react';
import type { AiService } from '../pipeline/api';
import type { AiProgress, ArtId, ArtKind, Level, PlanOutcome, RigKind, StarterId } from '../model/types';

export interface PlanHero {
  id: ArtId;
  name: string;
  kind: ArtKind;
  rig: RigKind;
}

export interface PlanSessionState {
  idea: string;
  hero: PlanHero | null;
  status: 'idle' | 'waiting' | 'done';
  outcome: PlanOutcome | null;
  progress: AiProgress | null;
  startedAt: number;
  finishedAt: number;
  /** Bumped on every new plan call (screens key their effects on it). */
  run: number;
}

const KEY = 'amble.plan';

const EMPTY: PlanSessionState = { idea: '', hero: null, status: 'idle', outcome: null, progress: null, startedAt: 0, finishedAt: 0, run: 0 };

function session(): Storage | null {
  try {
    return globalThis.sessionStorage ?? null;
  } catch {
    return null;
  }
}

function restore(): PlanSessionState {
  try {
    const raw = session()?.getItem(KEY);
    if (!raw) return EMPTY;
    const saved = JSON.parse(raw) as Partial<PlanSessionState>;
    if (typeof saved.idea !== 'string') return EMPTY;
    // A call that was still running when the tab went away cannot be picked up again.
    const status = saved.status === 'done' && saved.outcome ? 'done' : 'idle';
    return { ...EMPTY, ...saved, status, progress: null, outcome: status === 'done' ? (saved.outcome ?? null) : null };
  } catch {
    return EMPTY;
  }
}

let state: PlanSessionState | null = null;
let controller: AbortController | null = null;
const listeners = new Set<() => void>();

function current(): PlanSessionState {
  state ??= restore();
  return state;
}

function set(patch: Partial<PlanSessionState>): void {
  state = { ...current(), ...patch };
  try {
    const { idea, hero, status, outcome, startedAt, finishedAt, run } = state;
    session()?.setItem(KEY, JSON.stringify({ idea, hero, status, outcome, startedAt, finishedAt, run }));
  } catch {
    // A full or blocked sessionStorage only costs the reload case.
  }
  for (const fn of listeners) fn();
}

export function getPlanSession(): PlanSessionState {
  return current();
}

export function subscribePlanSession(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function usePlanSession(): PlanSessionState {
  return useSyncExternalStore(subscribePlanSession, current, current);
}

/** Keeps the words (and the hero) without asking for a plan yet: the idea field's draft. */
export function setIdea(idea: string, hero: PlanHero | null = current().hero): void {
  set({ idea, hero });
}

/**
 * Asks the AI helper for a plan. Any running call is stopped first; the outcome lands in the session
 * (`done`), whatever it is. Resolves with the outcome.
 */
export async function startPlan(ai: AiService, idea: string, hero: PlanHero | null, level: Level, closest: (idea: string) => StarterId): Promise<PlanOutcome> {
  controller?.abort();
  const ctl = new AbortController();
  controller = ctl;
  const run = current().run + 1;
  set({ idea, hero, status: 'waiting', outcome: null, progress: null, startedAt: Date.now(), finishedAt: 0, run });
  let outcome: PlanOutcome;
  try {
    outcome = await ai.plan(idea, {
      level,
      hero: hero ? { name: hero.name, kind: hero.kind, rig: hero.rig } : null,
      signal: ctl.signal,
      onProgress: (progress) => {
        if (controller === ctl) set({ progress });
      },
    });
  } catch (err) {
    // The ladder's first rung (§5.9): an unexpected failure still ends at a world close to the idea.
    outcome = ctl.signal.aborted ? { kind: 'cancelled' } : { kind: 'fallback', starter: closest(idea), message: err instanceof Error ? err.message : String(err) };
  }
  if (controller === ctl) {
    controller = null;
    set({ status: 'done', outcome, progress: null, finishedAt: Date.now() });
  }
  return outcome;
}

/** Stops a running plan call (the words stay). */
export function stopPlan(): void {
  if (!controller) return;
  controller.abort();
  controller = null;
  set({ status: 'idle', outcome: null, progress: null });
}

/** Forgets the plan (keeps the words for the idea field). */
export function clearPlanOutcome(): void {
  controller?.abort();
  controller = null;
  set({ status: 'idle', outcome: null, progress: null });
}

/** Seconds the plan took, rounded (at least 1). */
export function planSeconds(s: Pick<PlanSessionState, 'startedAt' | 'finishedAt'>): number {
  return Math.max(1, Math.round((s.finishedAt - s.startedAt) / 1000));
}

/** Tests only. */
export function resetPlanSession(): void {
  controller?.abort();
  controller = null;
  state = { ...EMPTY };
  try {
    session()?.removeItem(KEY);
  } catch {
    // ignore
  }
}
