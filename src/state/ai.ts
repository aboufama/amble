/**
 * The `ai` slice (M5): the running job (for the wish box, the world's working pill and the Desk's build
 * pill), the last outcome, the helper's status, retry waits, the last wish that landed (the "Done!"
 * toast), the last local steer, and the actions that start, stop, apply and undo wishes.
 *
 * Wishes feel like magic (MAGIC-BRIEF.md): what the AI wrote for students (summaries, next ideas, notes)
 * is cleaned of machine words and of a helper speaking as "I" before anything reads it, and nothing here
 * announces the machinery's phases: "Working on it…", then "Done! …".
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
import type { AiJobView, AiOutcome, AiProgress, AiStatus, CastKey, LocalSteer, PlanReply, PlayerError, StepId, StepInput, World, WorldId } from '../model/types';
import { doneText, forStudentsOutcome, waitText } from '../screens/ai/words';
import { seeChange } from '../screens/footsteps/seeChange';
import { announce } from './app';
import { adoptWorld, applyAccepted, loadGame, patchSession, refreshCast, setDial, setTwist } from './session';
import { getState, setState } from './store';

export interface SteerRecord {
  steer: LocalSteer;
  worldId: WorldId;
  words: string;
  at: number;
  /** For a twist: whether it was on before (Undo puts it back). */
  wasOn: boolean;
}

/** A wish that landed in a world: "Done! {what changed}" [See what changed] [Undo]. */
export interface LandedWish {
  worldId: WorldId;
  /** Its footstep (See what changed opens it; Undo goes back to the step before it). */
  stepId: StepId | null;
  /** "Done! The Moon King throws fireballs now." */
  text: string;
  /** The files it changed (Look inside opens the first when there is no step to show). */
  files: string[];
  at: number;
}

export type WaitReason = 'rate-limited' | 'server' | 'network';

/** A request waiting to be sent again (the wish box says so, without a ticking counter). */
export interface AiWait {
  worldId: WorldId;
  reason: WaitReason;
  /** `Date.now()` when it is sent again. */
  until: number;
}

export interface AiSlice {
  job: AiJobView | null;
  lastOutcome: AiOutcome | null;
  status: AiStatus;
  /** The world and the words of the last outcome (the words stay in the field after a failure). */
  outcomeFor: { worldId: WorldId; task: AiJobView['task']; request: string; at: number } | null;
  /** New cast members the running job's game.js declared (they appear before the job ends). */
  streamedArt: ArtNeed[];
  /** The last local steer, for its toast's Undo. */
  steer: SteerRecord | null;
  /** The last wish that landed, for its toast (the newest of this and `steer` shows). */
  landed: LandedWish | null;
  /** The running job's retry wait. */
  wait: AiWait | null;
  /** What the last accepted change touched: its files, and a file whose student-written lines it rewrote. */
  changed: { worldId: WorldId; files: string[]; handFile: string | null } | null;
}

export function initialAi(): AiSlice {
  return { job: null, lastOutcome: null, status: 'off', outcomeFor: null, streamedArt: [], steer: null, landed: null, wait: null, changed: null };
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

function progressFor(worldId: WorldId): (p: AiProgress) => void {
  return (progress) => {
    const job = running.get(worldId);
    if (!job) return;
    // Streaming ticks at most 4 times a second; phase changes always go through. The phases stay out of
    // sight (no list, no announcements): the wish box only says "Working on it…".
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
  };
}

function waitFor(worldId: WorldId): (ms: number, reason: WaitReason) => void {
  return (ms, reason) => {
    const waiting = getState().ai.wait?.worldId === worldId;
    setState((s) => {
      s.ai.wait = { worldId, reason, until: Date.now() + ms };
    });
    // Said once when a wish starts waiting; the line itself changes quietly.
    if (!waiting && getState().session.world?.id === worldId) announce(waitText(Math.ceil(ms / 1000), reason));
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
  if (task !== 'build' && getState().session.world?.id === world.id) announce(t('ai.working'));
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

/** The files an accepted outcome changed (for See what changed). */
function changedFiles(before: World, outcome: Extract<AiOutcome, { kind: 'accepted' }>): string[] {
  return outcome.files.filter((f) => before.code.find((b) => b.path === f.path)?.source !== f.source).map((f) => f.path);
}

/** "Done! The Moon King throws fireballs now." lands (its toast shows over the world, §2.8 Done). */
function land(worldId: WorldId, outcome: Extract<AiOutcome, { kind: 'accepted' }>, files: string[], stepId: StepId | null): void {
  const text = doneText(outcome.summary);
  setState((s) => {
    s.ai.landed = { worldId, stepId, text, files, at: Date.now() };
  });
  if (getState().session.world?.id === worldId) announce(text);
}

export function clearLanded(): void {
  if (!getState().ai.landed) return;
  setState((s) => {
    s.ai.landed = null;
  });
}

/** Closes the "Done!" toast: See the change is open (Footsteps calls this), so it has done its job. */
export function dismissChangeToast(): void {
  clearLanded();
}

/**
 * See what changed: the same sheet as the footstep's link (§2.9: the summary, the student's words and the
 * diff), back in the world if the student has moved on; Look inside only when there is no step to show.
 */
export function seeWish(): void {
  const rec = getState().ai.landed;
  if (!rec) return;
  clearLanded();
  if (!rec.stepId) {
    navigate({ name: 'code', worldId: rec.worldId, file: rec.files[0] ?? 'game.js' });
    return;
  }
  const route = getState().app.route;
  if (route.name !== 'world' || route.id !== rec.worldId) navigate({ name: 'world', id: rec.worldId });
  seeChange(rec.worldId, rec.stepId);
}

/** Undo: the world goes back to the step before the wish (a new footstep; nothing is ever lost), and so does its game. */
export async function undoWish(): Promise<void> {
  const rec = getState().ai.landed;
  if (!rec?.stepId) return;
  clearLanded();
  const world = await currentWorld(rec.worldId);
  const at = world ? world.steps.findIndex((s) => s.id === rec.stepId) : -1;
  const before = world && at > 0 ? world.steps[at - 1] : null;
  if (!world || !before) {
    announce(t('ai.undoFailed'));
    return;
  }
  try {
    const back = await getServices().history.goBack(world, before.id);
    if (adoptWorld(back)) void loadGame(back, { autostart: true });
    setState((s) => {
      if (s.ai.outcomeFor?.worldId !== rec.worldId) return;
      s.ai.lastOutcome = null;
      s.ai.outcomeFor = null;
    });
    announce(t('ai.undone'));
  } catch {
    announce(t('ai.undoFailed'));
  }
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
    const recorded = await applyAccepted(outcome);
    land(worldId, outcome, files, recorded.steps.at(-1)?.id ?? null);
    return;
  }
  const recorded = await commitWorld({ ...before, code: outcome.files, updatedAt: Date.now() }, stepFor(outcome, task, words), keepCode);
  if (getState().session.world?.id === worldId) {
    setState((s) => {
      s.session.manifest = outcome.manifest;
      s.session.newVersion = { summary: outcome.summary, ready: true };
    });
    void getServices().player.promote().catch(() => undefined);
  }
  land(worldId, outcome, files, recorded.steps.at(-1)?.id ?? null);
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
  const s = getState();
  const open = s.session.world;
  if (open?.id !== worldId) return;
  setState((d) => {
    d.session.manifest = outcome.manifest;
  });
  refreshCast();
  // Watching the Warm-up in the world (Build it first): the real game comes like any new version, at once
  // or at the next pause. Elsewhere (the Desk's preview plays it itself) the world loads it on return.
  const route = s.app.route;
  const onScreen = (route.name === 'world' && route.id === worldId) || (route.name === 'handin' && route.worldId === worldId);
  if (!onScreen) return;
  // The ladder's own card explains a fallback; the new-version card then says it plainly.
  const summary = outcome.kind === 'accepted' ? outcome.summary : '';
  if (s.session.player === 'running' && s.session.mode === 'play') patchSession({ newVersion: { summary, ready: true } });
  else void loadGame(open, { autostart: true });
}

/** The cast of a build that fell back to its starter (the ladder's code tools load with the job). */
async function ladderCastOf(world: World, plan: PlanReply, files: World['code']): Promise<World['cast']> {
  const [{ ladderCast, ladderMapping }, { readStatics }] = await Promise.all([import('../pipeline/ladder'), import('../pipeline/manifest')]);
  const { mapping, resting } = ladderMapping(plan, readStatics(files).art);
  return ladderCast(world, mapping, resting);
}

/**
 * A refusal is kept as a category and a time only, never the words (§5.13): `support` for a crisis, else the
 * safety category ('real-person', 'personal-info'...), or 'flagged' when the AI service said no without one.
 */
async function recordRefusal(worldId: WorldId, category: string): Promise<void> {
  const world = await currentWorld(worldId);
  if (!world) return;
  await commitWorld(world, { kind: 'refused', by: 'ai', text: category === 'support' ? t('ai.stepRefusedSupport') : t('ai.stepRefused', { category }) });
}

/** A refusal or crisis the wish box caught on the device (nothing was sent): a footstep, never the words. */
export function noteLocalRefusal(world: World, category: string): Promise<void> {
  return recordRefusal(world.id, category).catch((err: unknown) => console.error(err));
}

async function settle(world: World, task: AiJobView['task'], words: string, outcome: AiOutcome): Promise<void> {
  try {
    if (outcome.kind === 'accepted') {
      if (task === 'build') await applyBuild(world.id, outcome, words);
      else await applyChange(world.id, outcome, task, words);
    } else if (outcome.kind === 'fallback') await applyBuild(world.id, outcome, words);
    else if (outcome.kind === 'crisis') await recordRefusal(world.id, 'support');
    else if (outcome.kind === 'refused') await recordRefusal(world.id, outcome.category ?? 'flagged');
  } catch (err) {
    console.error(err);
  }
}

// ------------------------------------------------------------------ starting jobs

async function run(world: World, task: AiJobView['task'], words: string, go: (c: AbortController) => Promise<AiOutcome>): Promise<AiOutcome> {
  const own = begin(world, task, words);
  let outcome: AiOutcome;
  try {
    outcome = forStudentsOutcome(await go(own));
  } catch (err) {
    outcome = { kind: 'failed', reason: 'transport', message: t('ai.failed'), details: [err instanceof Error ? err.message : String(err)] };
  }
  await settle(world, task, words, outcome);
  finish(world, task, words, outcome, own);
  // A wish that didn't work leaves the world as it was: said politely, it stops nothing.
  if ((outcome.kind === 'failed' || outcome.kind === 'unavailable') && getState().session.world?.id === world.id) announce(outcome.message);
  // A build lands while the student draws: the Desk's pill says so, and so does the live region.
  if (task === 'build' && (outcome.kind === 'accepted' || outcome.kind === 'fallback')) announce(t('ai.buildReady'));
  return outcome;
}

function jobOptions(world: World, c: AbortController) {
  return { signal: c.signal, onProgress: progressFor(world.id), onArt: artFor(world.id), onWait: waitFor(world.id) };
}

/** A wish (§2.8): the student's words change the world. */
export function startChange(world: World, words: string, scope: CastKey | null = null): Promise<AiOutcome> {
  return run(world, 'change', words, (c) => getServices().ai.change(world, words, { ...jobOptions(world, c), scope: scope ?? undefined }));
}

/** Ask Amble to fix it (the problem card); `words` is what the wish box shows while it works. */
export function startFix(world: World, problems: PlayerError[], words = t('ai.stepFixedPlain')): Promise<AiOutcome> {
  return run(world, 'fix', words, (c) => getServices().ai.fix(world, problems, jobOptions(world, c)));
}

/** Draw while it builds (§2.5): the build runs in the background; the stored world gets its result. */
export function startBuild(world: World, plan: PlanReply): Promise<AiOutcome> {
  return run(world, 'build', plan.pitch || plan.title, (c) => getServices().ai.build(world, plan, jobOptions(world, c)));
}

const resumed = new Set<WorldId>();

/**
 * A plan's world opened in its Warm-up with no build running (the tab closed or the Chromebook slept
 * mid-build, and a build is never picked up again): build it again, once per page. When the AI helper
 * can't, it ends on the ladder, so the world always becomes playable.
 */
export function resumeBuild(world: World): void {
  if (!world.plan || world.origin.kind !== 'plan' || isWorking(world.id) || resumed.has(world.id)) return;
  resumed.add(world.id);
  void startBuild(world, world.plan).catch((err: unknown) => console.warn('The build stopped:', err));
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
  clearLanded();
  setState((s) => {
    s.ai.lastOutcome = null;
    s.ai.outcomeFor = null;
  });
}

// ------------------------------------------------------------------ dials and twists matched on the device

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

/** Make a wish instead: the steer is undone and the same words go as a wish. */
export async function steerToWish(): Promise<AiOutcome | null> {
  const rec = getState().ai.steer;
  if (!rec) return null;
  undoSteer();
  const world = await currentWorld(rec.worldId);
  return world ? startChange(world, rec.words) : null;
}

export function clearSteer(): void {
  if (!getState().ai.steer) return;
  setState((s) => {
    s.ai.steer = null;
  });
}
