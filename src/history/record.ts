/**
 * Recording footsteps (§4.5). Every change the student sees becomes a step with a snapshot; the world
 * and the snapshot are written in one commit. A dial burst that follows a step for the same dial merges
 * into it ("You turned Orb speed down to 160" once, not five times). Nothing is ever deleted: old
 * snapshots only fold (one per day) once a world has more than 60 steps.
 */
import type { StepId, StepInput, StepSnapshot, StepSummary, World } from '../model/types';
import type { Store } from '../store/api';
import { linesWritten } from './diff';
import { newlyFolded } from './prune';
import { changedDials, onlyDialsDiffer, snapshotOf } from './snapshot';

export interface HistoryDeps {
  /** Where snapshots live; null when there is no store yet (then steps are only appended to the world). */
  store(): Store | null;
  now(): number;
  newId(): StepId;
}

/** Consecutive dial steps for the same dial within this window become one step. */
export const DIAL_MERGE_MS = 60_000;

/** The step a world is at (its head), falling back to the newest. */
export function headOf(world: World): StepSummary | null {
  return world.steps.find((s) => s.id === world.head) ?? world.steps[world.steps.length - 1] ?? null;
}

/** The step just before `id` in the world's list. */
export function parentOf(world: World, id: StepId): StepSummary | null {
  const i = world.steps.findIndex((s) => s.id === id);
  return i > 0 ? world.steps[i - 1] : null;
}

function summaryOf(id: StepId, at: number, input: StepInput, lines: number | undefined): StepSummary {
  const s: StepSummary = { id, at, by: input.by, kind: input.kind, text: input.text };
  if (input.request !== undefined) s.request = input.request;
  if (input.files?.length) s.files = [...input.files];
  if (input.cast !== undefined) s.cast = input.cast;
  if (lines !== undefined) s.lines = lines;
  if (input.tested !== undefined) s.tested = input.tested;
  if (input.handEdits !== undefined) s.handEdits = input.handEdits;
  return s;
}

/** Deletes snapshots that just folded, when the store can (the summaries stay). */
async function pruneFolded(store: Store, before: World, after: World): Promise<void> {
  const drop = newlyFolded(before.steps, after.steps);
  const steps = store.steps as Store['steps'] & { remove?: (ids: StepId[]) => Promise<void> };
  if (drop.length && typeof steps.remove === 'function') await steps.remove(drop).catch(() => undefined);
}

/** A dial step right after a dial step on the same dial(s): rewrite that step instead of adding one. */
async function mergeDialBurst(deps: HistoryDeps, world: World, input: StepInput): Promise<World | null> {
  if (input.kind !== 'dials') return null;
  const head = headOf(world);
  if (!head || head.kind !== 'dials' || head.by !== input.by || head.id !== world.steps[world.steps.length - 1]?.id) return null;
  const now = deps.now();
  if (now - head.at > DIAL_MERGE_MS) return null;
  const parent = parentOf(world, head.id);
  const store = deps.store();
  if (!parent || !store) return null;
  const [headSnap, parentSnap] = await Promise.all([store.steps.get(head.id), store.steps.get(parent.id)]);
  if (!headSnap || !parentSnap) return null;
  const now1 = changedDials(headSnap.dials, world.dials);
  const before = changedDials(parentSnap.dials, headSnap.dials);
  if (!now1.length || !now1.every((k) => before.includes(k)) || !onlyDialsDiffer(headSnap, world)) return null;
  const snap = await snapshotOf(world, head.id, (id) => store.art.get(id));
  const merged: StepSummary = { ...head, at: now, text: input.text };
  const next: World = { ...world, steps: world.steps.map((s) => (s.id === head.id ? merged : s)), head: head.id, updatedAt: now };
  await store.commit({ worlds: [next], steps: [snap] });
  return next;
}

const CODE_KINDS = new Set(['code', 'ask', 'fix', 'goback', 'import']);

/** `HistoryApi.record`: snapshot, append (or merge a dial burst), one commit; returns the new world. */
export async function record(deps: HistoryDeps, world: World, input: StepInput): Promise<World> {
  const merged = await mergeDialBurst(deps, world, input);
  if (merged) return merged;
  const store = deps.store();
  const id = deps.newId();
  const at = deps.now();
  if (!store) return { ...world, steps: [...world.steps, summaryOf(id, at, input, undefined)], head: id, updatedAt: at };
  const head = headOf(world);
  const [snap, headSnap] = await Promise.all([snapshotOf(world, id, (a) => store.art.get(a)), head ? store.steps.get(head.id) : Promise.resolve(null)]);
  const lines = CODE_KINDS.has(input.kind) && headSnap ? linesWritten(headSnap.code, world.code) : undefined;
  const next: World = { ...world, steps: [...world.steps, summaryOf(id, at, input, lines)], head: id, updatedAt: at };
  await store.commit({ worlds: [next], steps: [snap] });
  await pruneFolded(store, world, next);
  return next;
}

/**
 * Makes sure the step a world is at has a snapshot. Worlds are born with a first step ("You started Moon
 * King") but no snapshot; since every later change records its own, the world as it is now is exactly
 * its head, so it is snapshotted under the head's id. Call it when a world opens.
 */
export async function ensureHead(deps: HistoryDeps, world: World): Promise<StepSnapshot | null> {
  const head = headOf(world);
  const store = deps.store();
  if (!head || !store) return null;
  const existing = await store.steps.get(head.id);
  if (existing) return existing;
  const snap = await snapshotOf(world, head.id, (a) => store.art.get(a));
  await store.commit({ steps: [snap] });
  return snap;
}
