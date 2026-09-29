/**
 * The `ai` slice (M5): the running job (for the Ask card, the world's progress pill and the Desk's build
 * pill), the last outcome, the helper's status, and the actions that start, stop and apply jobs.
 *
 * Changes and fixes in the open world are applied through the session's `applyAccepted` (M2); builds run
 * while the student draws, so their result is written to the stored world here (with the ladder's cast
 * when the build fell back to its starter), and the open world is updated if it is the same one.
 */
import { getServices } from '../app/services';
import type { ArtNeed } from '../cores/play';
import { t } from '../i18n';
import { NotBuiltYet } from '../model/notBuilt';
import type { AiJobView, AiOutcome, AiProgress, AiStatus, CastKey, LocalSteer, PlanReply, PlayerError, StepInput, World, WorldId } from '../model/types';
import { ladderCast, ladderMapping } from '../pipeline/ladder';
import { readStatics } from '../pipeline/manifest';
import { applyAccepted, setDial, setTwist } from './session';
import { getState, setState } from './store';

export interface SteerRecord {
  steer: LocalSteer;
  worldId: WorldId;
  words: string;
  at: number;
  /** For a twist: whether it was on before (Undo puts it back). */
  wasOn: boolean;
}

export interface AiSlice {
  job: AiJobView | null;
  lastOutcome: AiOutcome | null;
  status: AiStatus;
  /** The world and the words of the last outcome (the words stay in the field after a failure). */
  outcomeFor: { worldId: WorldId; task: AiJobView['task']; request: string; at: number } | null;
  /** New cast members the running job's game.js declared (they appear before the job ends). */
  streamedArt: ArtNeed[];
  /** The last local steer, for the toast's Undo. */
  steer: SteerRecord | null;
}

export function initialAi(): AiSlice {
  return { job: null, lastOutcome: null, status: 'off', outcomeFor: null, streamedArt: [], steer: null };
}

export function setAiStatus(status: AiStatus): void {
  if (getState().ai.status === status) return;
  setState((s) => {
    s.ai.status = status;
  });
}

let controller: AbortController | null = null;
let lastTick = 0;

function setProgress(progress: AiProgress): void {
  // Streaming ticks at most 4 times a second; phase changes always go through.
  const now = Date.now();
  const job = getState().ai.job;
  if (job && job.progress.phase === progress.phase && progress.phase === 'writing' && now - lastTick < 250) return;
  lastTick = now;
  setState((s) => {
    if (s.ai.job) s.ai.job.progress = progress;
  });
}

function begin(world: World, task: AiJobView['task'], request: string): AbortController {
  controller?.abort();
  controller = new AbortController();
  setState((s) => {
    s.ai.job = { worldId: world.id, task, request, progress: { phase: 'checking' }, startedAt: Date.now() };
    s.ai.streamedArt = [];
  });
  return controller;
}

function finish(world: World, task: AiJobView['task'], request: string, outcome: AiOutcome, own: AbortController): void {
  if (controller === own) controller = null;
  setState((s) => {
    if (s.ai.job?.worldId === world.id) s.ai.job = null;
    s.ai.lastOutcome = outcome;
    s.ai.outcomeFor = { worldId: world.id, task, request, at: Date.now() };
    s.ai.streamedArt = [];
  });
}

/** Stops the running job; nothing is applied and the student's words stay. */
export function stopJob(): void {
  controller?.abort();
}

export function clearOutcome(): void {
  setState((s) => {
    s.ai.lastOutcome = null;
    s.ai.outcomeFor = null;
  });
}

function onArt(needs: ArtNeed[]): void {
  setState((s) => {
    s.ai.streamedArt = needs;
  });
}

// ------------------------------------------------------------------ applying outcomes

/** The world as it is now: the open one when it is this world, else the stored one. */
async function currentWorld(id: WorldId): Promise<World | null> {
  const open = getState().session.world;
  if (open?.id === id) return open;
  return getServices().store.worlds.get(id);
}

/** Writes a new version of a world: a footstep, one commit, and the open world if it is this one. */
async function commitWorld(next: World, step: StepInput): Promise<World> {
  const { store, history } = getServices();
  const recorded = await history.record(next, step);
  await store.commit({ worlds: [recorded] });
  setState((s) => {
    if (s.session.world?.id === recorded.id) s.session.world = recorded;
  });
  return recorded;
}

function stepFor(outcome: Extract<AiOutcome, { kind: 'accepted' }>, task: AiJobView['task'], words: string): StepInput {
  const files = outcome.files.map((f) => f.path);
  if (task === 'build') return { kind: 'ask', by: 'ai', text: outcome.summary ? t('ai.stepBuilt', { summary: outcome.summary }) : t('ai.stepBuiltPlain'), request: words, files, tested: outcome.tested };
  if (task === 'fix') return { kind: 'fix', by: 'ai', text: outcome.summary || t('ai.stepFixedPlain'), files, tested: outcome.tested };
  return { kind: 'ask', by: 'ai', text: outcome.summary || t('ai.changedPlain'), request: words, files, tested: outcome.tested, handEdits: outcome.handEditsTouched };
}

/** Applies an accepted change or fix: the session's `applyAccepted` (M2), else a direct commit. */
async function applyChange(worldId: WorldId, outcome: Extract<AiOutcome, { kind: 'accepted' }>, task: AiJobView['task'], words: string): Promise<void> {
  const open = getState().session.world;
  if (open?.id === worldId) {
    try {
      await applyAccepted(outcome);
      return;
    } catch (err) {
      if (!(err instanceof NotBuiltYet)) throw err;
    }
  }
  const world = await currentWorld(worldId);
  if (!world) return;
  await commitWorld({ ...world, code: outcome.files, updatedAt: Date.now() }, stepFor(outcome, task, words));
  if (getState().session.world?.id === worldId) {
    setState((s) => {
      s.session.manifest = outcome.manifest;
      s.session.newVersion = { summary: outcome.summary, ready: true };
    });
    void getServices().player.promote().catch(() => undefined);
  }
}

/** A build's result, written to the stored world (the student may be drawing on the Desk). */
async function applyBuild(worldId: WorldId, outcome: Extract<AiOutcome, { kind: 'accepted' | 'fallback' }>, words: string): Promise<void> {
  const world = await currentWorld(worldId);
  if (!world) return;
  if (outcome.kind === 'accepted') {
    await commitWorld({ ...world, code: outcome.files, updatedAt: Date.now() }, stepFor(outcome, 'build', words));
  } else {
    const plan = world.plan;
    const cast = plan ? ladderCast(world, ...ladderArgs(plan, outcome.files)) : world.cast;
    const starter = world.origin.kind === 'plan' ? world.origin.starter : null;
    const title = starter ? getServices().starters.info(starter).title : '';
    await commitWorld({ ...world, code: outcome.files, cast, title: plan?.title || world.title, updatedAt: Date.now() }, { kind: 'code', by: 'ai', text: t('ai.stepLadder', { starter: title }), request: words, files: outcome.files.map((f) => f.path) });
  }
  if (getState().session.world?.id === worldId) {
    setState((s) => {
      s.session.manifest = outcome.manifest;
    });
  }
}

function ladderArgs(plan: PlanReply, files: World['code']): [Record<CastKey, CastKey>, PlanReply['cast']] {
  const { mapping, resting } = ladderMapping(plan, readStatics(files).art);
  return [mapping, resting];
}

/** A refusal is kept as a category and a time only, never the words (§5.13). */
async function recordRefusal(worldId: WorldId, category: string): Promise<void> {
  const world = await currentWorld(worldId);
  if (!world) return;
  await commitWorld(world, { kind: 'refused', by: 'ai', text: category === 'support' ? t('ai.stepRefusedSupport') : t('ai.stepRefused', { category }) });
}

async function settle(world: World, task: AiJobView['task'], words: string, outcome: AiOutcome): Promise<void> {
  try {
    if (outcome.kind === 'accepted') {
      if (task === 'build') await applyBuild(world.id, outcome, words);
      else await applyChange(world.id, outcome, task, words);
    } else if (outcome.kind === 'fallback') await applyBuild(world.id, outcome, words);
    else if (outcome.kind === 'crisis') await recordRefusal(world.id, 'support');
    else if (outcome.kind === 'refused') await recordRefusal(world.id, 'request');
  } catch (err) {
    console.error(err);
  }
}

// ------------------------------------------------------------------ starting jobs

async function run(world: World, task: AiJobView['task'], words: string, go: (c: AbortController) => Promise<AiOutcome>): Promise<AiOutcome> {
  const own = begin(world, task, words);
  let outcome: AiOutcome;
  try {
    outcome = await go(own);
  } catch (err) {
    outcome = { kind: 'failed', reason: 'transport', message: t('ai.failed'), details: [err instanceof Error ? err.message : String(err)] };
  }
  await settle(world, task, words, outcome);
  finish(world, task, words, outcome, own);
  return outcome;
}

/** Ask (§2.8): the student's words change the world. */
export function startChange(world: World, words: string, scope: CastKey | null = null): Promise<AiOutcome> {
  return run(world, 'change', words, (c) => getServices().ai.change(world, words, { signal: c.signal, onProgress: setProgress, onArt, scope: scope ?? undefined }));
}

/** Ask Amble to fix it (the problem card). */
export function startFix(world: World, problems: PlayerError[]): Promise<AiOutcome> {
  return run(world, 'fix', t('ai.stepFixedPlain'), (c) => getServices().ai.fix(world, problems, { signal: c.signal, onProgress: setProgress, onArt }));
}

/** Draw while it builds (§2.5): the build runs in the background; the stored world gets its result. */
export function startBuild(world: World, plan: PlanReply): Promise<AiOutcome> {
  return run(world, 'build', plan.pitch || plan.title, (c) => getServices().ai.build(world, plan, { signal: c.signal, onProgress: setProgress, onArt }));
}

// ------------------------------------------------------------------ local steering

/** Applies a local steer (a dial move or a twist) and remembers it for Undo. */
export function applySteer(world: World, steer: LocalSteer, words: string): void {
  const wasOn = steer.kind === 'twist' && world.twists.includes(steer.id);
  if (steer.kind === 'dial') setDial(steer.key, steer.to);
  else setTwist(steer.id, steer.on);
  setState((s) => {
    s.ai.steer = { steer, worldId: world.id, words, at: Date.now(), wasOn };
  });
}

/** Undo for the steer toast. */
export function undoSteer(): void {
  const rec = getState().ai.steer;
  if (!rec) return;
  if (rec.steer.kind === 'dial') setDial(rec.steer.key, rec.steer.from);
  else setTwist(rec.steer.id, rec.wasOn);
  clearSteer();
}

export function clearSteer(): void {
  setState((s) => {
    s.ai.steer = null;
  });
}
