/**
 * The `ai` slice (M5): the running job (for the Ask card, the world's progress pill and the Desk's build
 * pill), the last outcome, the helper's status, retry waits, the explainer before the first Ask, explain
 * answers, the last local steer, and the actions that start, stop and apply jobs.
 *
 * One job runs per world (§5.2): starting one never stops another world's. Changes and fixes in the open
 * world are applied through the session's `applyAccepted` (M2); builds run while the student draws, so
 * their result is written to the stored world here (with the ladder's cast when the build fell back to its
 * starter), and the open world is updated if it is the same one.
 */
import type { Draft } from 'immer';
import { getServices } from '../app/services';
import { navigate } from '../app/router';
import type { ArtNeed } from '../cores/play';
import { t } from '../i18n';
import type {
  AiJobView,
  AiOutcome,
  AiProgress,
  AiStatus,
  CastKey,
  ExplainReply,
  LocalSteer,
  PlanReply,
  PlayerError,
  StepInput,
  World,
  WorldId,
} from '../model/types';
import { announce, showToast } from './app';
import { markSeen } from './prefs';
import { adoptWorld, applyAccepted, loadGame, setDial, setTwist } from './session';
import { getState, setState } from './store';

export interface SteerRecord {
  steer: LocalSteer;
  worldId: WorldId;
  words: string;
  at: number;
  /** For a twist: whether it was on before (Undo puts it back). */
  wasOn: boolean;
}

export type WaitReason = 'rate-limited' | 'server' | 'network';

/** A request waiting to be sent again (the Ask card counts it down). */
export interface AiWait {
  worldId: WorldId;
  reason: WaitReason;
  /** `Date.now()` when it is sent again. */
  until: number;
}

/** An Ask waiting for the student to read the AI explainer (the first Ask on this device). */
export interface PendingAsk {
  worldId: WorldId;
  words: string;
  scope: CastKey | null;
}

/** An explain-only class's answer (§2.8): shown in the Ask card, and as notes in Look inside. */
export interface ExplainNote {
  worldId: WorldId;
  question: string;
  path: string;
  reply: ExplainReply | null;
  /** Why there is no reply (kid words), or null. */
  error: string | null;
  at: number;
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
  /** The running job's retry wait. */
  wait: AiWait | null;
  /** The explainer is open before this Ask. */
  explainer: PendingAsk | null;
  /** The world an explain request is running for. */
  explaining: WorldId | null;
  explain: ExplainNote | null;
  /** What the last accepted change touched: its files, and a file whose student-written lines it rewrote. */
  changed: { worldId: WorldId; files: string[]; handFile: string | null } | null;
}

export function initialAi(): AiSlice {
  return { job: null, lastOutcome: null, status: 'off', outcomeFor: null, streamedArt: [], steer: null, wait: null, explainer: null, explaining: null, explain: null, changed: null };
}

export function setAiStatus(status: AiStatus): void {
  if (getState().ai.status === status) return;
  setState((s) => {
    s.ai.status = status;
  });
}

// ------------------------------------------------------------------ running jobs, one per world

const controllers = new Map<WorldId, AbortController>();
const running = new Map<WorldId, AiJobView>();
const ticks = new Map<WorldId, number>();

/** The job the cards show: the newest one still running. */
function shownJob(): AiJobView | null {
  let newest: AiJobView | null = null;
  for (const j of running.values()) if (!newest || j.startedAt >= newest.startedAt) newest = j;
  return newest;
}

const PHASE_WORDS: Partial<Record<AiProgress['phase'], () => string>> = {
  checking: () => t('ai.stepChecking'),
  planning: () => t('ai.stepPlanning'),
  validating: () => t('ai.stepValidating'),
  testing: () => t('ai.stepTesting'),
  swapping: () => t('ai.stepSwapping'),
};

function progressFor(worldId: WorldId): (p: AiProgress) => void {
  return (progress) => {
    const job = running.get(worldId);
    if (!job) return;
    // Streaming ticks at most 4 times a second; phase changes always go through.
    const now = Date.now();
    const same = job.progress.phase === progress.phase && job.progress.file === progress.file;
    if (same && progress.phase === 'writing' && now - (ticks.get(worldId) ?? 0) < 250) return;
    ticks.set(worldId, now);
    const next: AiJobView = { ...job, progress };
    running.set(worldId, next);
    setState((s) => {
      if (s.ai.job?.worldId === worldId) s.ai.job = next;
      if (progress.phase !== 'queued' && s.ai.wait?.worldId === worldId) s.ai.wait = null;
    });
    if (!same) {
      const words = progress.phase === 'writing' ? (progress.file ? t('ai.stepWritingFile', { file: progress.file }) : t('ai.stepWriting')) : progress.phase === 'fixing' ? t('ai.stepFixing', { round: progress.round ?? 1 }) : PHASE_WORDS[progress.phase]?.();
      if (words && getState().session.world?.id === worldId) announce(words);
    }
  };
}

function waitFor(worldId: WorldId): (ms: number, reason: WaitReason) => void {
  return (ms, reason) => {
    setState((s) => {
      s.ai.wait = { worldId, reason, until: Date.now() + ms };
    });
  };
}

function artFor(worldId: WorldId): (needs: ArtNeed[]) => void {
  return (needs) => {
    setState((s) => {
      if (s.ai.job?.worldId === worldId) s.ai.streamedArt = needs;
    });
  };
}

function begin(world: World, task: AiJobView['task'], request: string): AbortController {
  controllers.get(world.id)?.abort();
  const own = new AbortController();
  controllers.set(world.id, own);
  const view: AiJobView = { worldId: world.id, task, request, progress: { phase: 'checking' }, startedAt: Date.now() };
  running.set(world.id, view);
  setState((s) => {
    s.ai.job = view;
    s.ai.streamedArt = [];
    if (s.ai.wait?.worldId === world.id) s.ai.wait = null;
  });
  return own;
}

function finish(world: World, task: AiJobView['task'], request: string, outcome: AiOutcome, own: AbortController): void {
  if (controllers.get(world.id) === own) {
    controllers.delete(world.id);
    running.delete(world.id);
    ticks.delete(world.id);
  }
  const next = shownJob();
  setState((s) => {
    s.ai.job = next;
    if (!next || next.worldId !== s.ai.job?.worldId) s.ai.streamedArt = [];
    if (s.ai.wait?.worldId === world.id) s.ai.wait = null;
    s.ai.lastOutcome = outcome;
    s.ai.outcomeFor = { worldId: world.id, task, request, at: Date.now() };
  });
}

/** Stops a world's running job (the open one's by default); nothing is applied and the words stay. */
export function stopJob(worldId: WorldId | null = getState().ai.job?.worldId ?? null): void {
  if (worldId) controllers.get(worldId)?.abort();
}

/** Is a job running for this world? */
export function isWorking(worldId: WorldId): boolean {
  return running.has(worldId);
}

export function clearOutcome(): void {
  setState((s) => {
    s.ai.lastOutcome = null;
    s.ai.outcomeFor = null;
  });
}

// ------------------------------------------------------------------ applying outcomes

/** The world as it is now: the open one when it is this world, else the stored one. */
async function currentWorld(id: WorldId): Promise<World | null> {
  const open = getState().session.world;
  if (open?.id === id) return open;
  return getServices().store.worlds.get(id);
}

/**
 * Writes a new version of a world: a footstep and one commit; when it is the open world, what `keep` copies
 * (and the footstep) goes into the session, whose own newer edits stay.
 */
async function commitWorld(next: World, step: StepInput, keep: (w: Draft<World>, committed: World) => void = () => undefined): Promise<World> {
  const { store, history } = getServices();
  const recorded = await history.record(next, step);
  await store.commit({ worlds: [recorded] });
  return adoptWorld(recorded, keep) ?? recorded;
}

const keepCode = (w: Draft<World>, c: World): void => {
  w.code = c.code;
};

function stepFor(outcome: Extract<AiOutcome, { kind: 'accepted' }>, task: AiJobView['task'], words: string): StepInput {
  const files = outcome.files.map((f) => f.path);
  if (task === 'build') return { kind: 'ask', by: 'ai', text: outcome.summary ? t('ai.stepBuilt', { summary: outcome.summary }) : t('ai.stepBuiltPlain'), request: words, files, tested: outcome.tested };
  if (task === 'fix') return { kind: 'fix', by: 'ai', text: outcome.summary || t('ai.stepFixedPlain'), files, tested: outcome.tested };
  return { kind: 'ask', by: 'ai', text: outcome.summary || t('ai.changedPlain'), request: words, files, tested: outcome.tested, handEdits: outcome.handEditsTouched };
}

/** The files an accepted outcome changed (for See the change). */
function changedFiles(before: World, outcome: Extract<AiOutcome, { kind: 'accepted' }>): string[] {
  return outcome.files.filter((f) => before.code.find((b) => b.path === f.path)?.source !== f.source).map((f) => f.path);
}

/** "Amble changed your world: …" [See the change] (§2.8 Done). */
function doneToast(worldId: WorldId, outcome: Extract<AiOutcome, { kind: 'accepted' }>, files: string[]): void {
  if (getState().session.world?.id !== worldId) return;
  const text = outcome.summary ? t('ai.changed', { summary: outcome.summary }) : t('ai.changedPlain');
  showToast(text, { kind: 'ai', action: { label: t('ai.seeChange'), run: () => navigate({ name: 'code', worldId, file: files[0] ?? 'game.js' }) } });
}

/** Applies an accepted change or fix: the session's `applyAccepted` (M2), else a direct commit. */
async function applyChange(worldId: WorldId, outcome: Extract<AiOutcome, { kind: 'accepted' }>, task: AiJobView['task'], words: string): Promise<void> {
  const before = await currentWorld(worldId);
  if (!before) return;
  const files = changedFiles(before, outcome);
  // The pipeline's code tools (acorn and friends) are loaded by now: this outcome came from them.
  const handFile = outcome.handEditsTouched ? (await import('../pipeline/service')).handEditFile(before.code, outcome.files) : null;
  setState((s) => {
    s.ai.changed = { worldId, files, handFile };
  });
  if (getState().session.world?.id === worldId) {
    await applyAccepted(outcome);
    doneToast(worldId, outcome, files);
    return;
  }
  await commitWorld({ ...before, code: outcome.files, updatedAt: Date.now() }, stepFor(outcome, task, words), keepCode);
  if (getState().session.world?.id === worldId) {
    setState((s) => {
      s.session.manifest = outcome.manifest;
      s.session.newVersion = { summary: outcome.summary, ready: true };
    });
    void getServices().player.promote().catch(() => undefined);
  }
  doneToast(worldId, outcome, files);
}

/** A build's result, written to the stored world (the student may be drawing on the Desk). */
async function applyBuild(worldId: WorldId, outcome: Extract<AiOutcome, { kind: 'accepted' | 'fallback' }>, words: string): Promise<void> {
  const world = await currentWorld(worldId);
  if (!world) return;
  if (outcome.kind === 'accepted') {
    await commitWorld({ ...world, code: outcome.files, updatedAt: Date.now() }, stepFor(outcome, 'build', words), keepCode);
  } else {
    const plan = world.plan;
    const cast = plan ? await ladderCastOf(world, plan, outcome.files) : world.cast;
    const starter = world.origin.kind === 'plan' ? world.origin.starter : null;
    const title = starter ? getServices().starters.info(starter).title : '';
    await commitWorld(
      { ...world, code: outcome.files, cast, title: plan?.title || world.title, updatedAt: Date.now() },
      { kind: 'code', by: 'ai', text: t('ai.stepLadder', { starter: title }), request: words, files: outcome.files.map((f) => f.path) },
      (w, c) => {
        w.code = c.code;
        w.cast = c.cast;
        w.title = c.title;
      },
    );
  }
  if (getState().session.world?.id === worldId) {
    setState((s) => {
      s.session.manifest = outcome.manifest;
    });
  }
}

/** The cast of a build that fell back to its starter (the ladder's code tools load with the job). */
async function ladderCastOf(world: World, plan: PlanReply, files: World['code']): Promise<World['cast']> {
  const [{ ladderCast, ladderMapping }, { readStatics }] = await Promise.all([import('../pipeline/ladder'), import('../pipeline/manifest')]);
  const { mapping, resting } = ladderMapping(plan, readStatics(files).art);
  return ladderCast(world, mapping, resting);
}

/** A refusal is kept as a category and a time only, never the words (§5.13). */
async function recordRefusal(worldId: WorldId, category: 'request' | 'support'): Promise<void> {
  const world = await currentWorld(worldId);
  if (!world) return;
  await commitWorld(world, { kind: 'refused', by: 'ai', text: category === 'support' ? t('ai.stepRefusedSupport') : t('ai.stepRefused', { category }) });
}

/** A refusal or crisis the Ask card caught on the device (nothing was sent): a footstep, never the words. */
export function noteLocalRefusal(world: World, category: 'request' | 'support'): Promise<void> {
  return recordRefusal(world.id, category).catch((err: unknown) => console.error(err));
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
  if (outcome.kind === 'failed' || outcome.kind === 'unavailable') announce(outcome.message, 'assertive');
  return outcome;
}

function jobOptions(world: World, c: AbortController) {
  return { signal: c.signal, onProgress: progressFor(world.id), onArt: artFor(world.id), onWait: waitFor(world.id) };
}

/** Ask (§2.8): the student's words change the world. */
export function startChange(world: World, words: string, scope: CastKey | null = null): Promise<AiOutcome> {
  return run(world, 'change', words, (c) => getServices().ai.change(world, words, { ...jobOptions(world, c), scope: scope ?? undefined }));
}

/** Ask Amble to fix it (the problem card). */
export function startFix(world: World, problems: PlayerError[]): Promise<AiOutcome> {
  return run(world, 'fix', t('ai.stepFixedPlain'), (c) => getServices().ai.fix(world, problems, jobOptions(world, c)));
}

/** Draw while it builds (§2.5): the build runs in the background; the stored world gets its result. */
export function startBuild(world: World, plan: PlanReply): Promise<AiOutcome> {
  return run(world, 'build', plan.pitch || plan.title, (c) => getServices().ai.build(world, plan, jobOptions(world, c)));
}

/**
 * An Ask from the student: the AI explainer first when this device has never seen it (§2.16), else the
 * change. Returns null while the explainer is open.
 */
export function askAi(world: World, words: string, scope: CastKey | null = null): Promise<AiOutcome> | null {
  if (!getState().prefs.seen.aiExplainer) {
    setState((s) => {
      s.ai.explainer = { worldId: world.id, words, scope };
    });
    return null;
  }
  return startChange(world, words, scope);
}

/** Got it: the explainer is seen on this device, and the Ask it held goes ahead. */
export async function confirmExplainer(): Promise<AiOutcome | null> {
  const pending = getState().ai.explainer;
  closeExplainer();
  if (!pending) return null;
  const world = await currentWorld(pending.worldId);
  return world ? startChange(world, pending.words, pending.scope) : null;
}

/** Closes the explainer without asking (What gets sent?, Esc). It still counts as seen. */
export function closeExplainer(): void {
  markSeen('aiExplainer');
  setState((s) => {
    s.ai.explainer = null;
  });
}

// ------------------------------------------------------------------ explain-only classes

let explainController: AbortController | null = null;

/** An explain-only class asks about its world (§2.8): the answer is a note, and nothing changes. */
export async function startExplain(world: World, question: string, path = 'game.js'): Promise<void> {
  explainController?.abort();
  const own = new AbortController();
  explainController = own;
  const file = world.code.find((f) => f.path === path) ?? world.code.find((f) => f.path === 'game.js') ?? world.code[0];
  setState((s) => {
    s.ai.explaining = world.id;
  });
  let note: ExplainNote = { worldId: world.id, question, path: file?.path ?? path, reply: null, error: null, at: Date.now() };
  try {
    if (!file) throw new Error('no code');
    const out = await getServices().ai.explain(world, { path: file.path, from: 1, to: file.source.split('\n').length, question }, { signal: own.signal });
    if (out.kind === 'explained') note = { ...note, reply: out.reply };
    else if (out.kind === 'cancelled') return;
    else if (out.kind === 'crisis') {
      note = { ...note, error: '' };
      void noteLocalRefusal(world, 'support');
    } else note = { ...note, error: out.kind === 'refused' ? out.note || t('ai.refusedDefault') : out.message || t('ai.explainFailed') };
  } catch {
    note = { ...note, error: t('ai.explainFailed') };
  } finally {
    if (explainController === own) {
      explainController = null;
      setState((s) => {
        s.ai.explaining = null;
      });
    }
  }
  setState((s) => {
    s.ai.explain = note;
  });
}

export function stopExplain(): void {
  explainController?.abort();
}

// ------------------------------------------------------------------ after a change

/** Go back (§2.8): the change rewrote the student's own lines, and they want their version back. */
export async function goBackBefore(worldId: WorldId): Promise<void> {
  const world = await currentWorld(worldId);
  if (!world || world.steps.length < 2) return;
  const { store, history } = getServices();
  const at = world.steps.findIndex((s) => s.id === world.head);
  const to = world.steps[(at < 0 ? world.steps.length : at) - 1];
  if (!to) return;
  const back = await history.goBack(world, to.id);
  await store.commit({ worlds: [back] });
  // The world goes back, and so does the game playing it.
  if (adoptWorld(back)) void loadGame(back, { autostart: true });
  setState((s) => {
    s.ai.lastOutcome = null;
    s.ai.outcomeFor = null;
  });
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

/** Ask the AI instead: the steer is undone and the same words go to the AI helper. */
export async function steerToAi(): Promise<AiOutcome | null> {
  const rec = getState().ai.steer;
  if (!rec) return null;
  undoSteer();
  const world = await currentWorld(rec.worldId);
  return world ? askAi(world, rec.words) : null;
}

export function clearSteer(): void {
  setState((s) => {
    s.ai.steer = null;
  });
}
