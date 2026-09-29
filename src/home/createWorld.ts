/**
 * Making worlds from Home (§2.3-2.5): a seed with the student's hero ("Give Blorp a world"), a plan's
 * world with its Warm-up game and the build started in the background, an assignment's world, and the
 * sign menu's Rename and Make a copy. Every write is one `Store.commit`.
 */
import { getServices } from '../app/services';
import { t } from '../i18n';
import { uid } from '../model/ids';
import type { AiOutcome, AiProgress, ArtId, ArtRecord, Assignment, CastKey, CastSlot, PlanReply, StarterId, StepSummary, World, WorldId } from '../model/types';
import { refreshLibrary } from '../state/library';
import { applyAccepted } from '../state/session';
import { getState, setState } from '../state/store';
import { warmupCode } from '../world/warmup';

export const TITLE_MAX = 40;
const PITCH_MAX = 300;

function emptySlot(key: CastKey): CastSlot {
  return { key, art: null, madeBy: null, extra: null, laterUntil: 0 };
}

function startStep(title: string, at: number): StepSummary {
  return { id: uid('s_'), at, by: 'student', kind: 'start', text: t('home.startedStep', { title }) };
}

async function commitWorld(world: World, extra: { art?: ArtRecord[]; blobs?: Blob[] } = {}): Promise<World> {
  const { store } = getServices();
  await store.commit({ blobs: extra.blobs ?? [], art: extra.art ?? [], worlds: [world] });
  void refreshLibrary(store);
  return world;
}

/** A world type with the student's hero drawn and everything else as just bones ("Give Blorp a world"). */
export async function openSeed(seed: StarterId, hero: ArtId | null): Promise<World> {
  const { starters } = getServices();
  const { world, art, blobs } = await starters.open(seed, hero ? { withArt: false, hero } : { withArt: false });
  return commitWorld(world, { art, blobs });
}

/** The hero's cast key in a plan: the first member (the plan puts the hero first). */
export function planHeroKey(plan: PlanReply): CastKey {
  return plan.cast.find((c) => c.role === 'hero')?.key ?? plan.cast[0]?.key ?? 'hero';
}

/** The first member the student still has to draw (the hero, unless it is already drawn). */
export function firstToDraw(plan: PlanReply, heroDrawn: boolean): PlanReply['cast'][number] | null {
  const heroKey = planHeroKey(plan);
  const order = [...plan.cast].sort((a, b) => Number(b.key === heroKey) - Number(a.key === heroKey));
  return order.find((c) => (c.key === heroKey ? !heroDrawn : c.required && c.kind === 'character')) ?? null;
}

/**
 * The plan's world, made at once (§2.5): the plan's cast as slots (the hero's drawing in its slot when
 * there is one), the plan stored, and the Warm-up game as its code, so it plays while Amble builds.
 */
export async function createPlanWorld(plan: PlanReply, idea: string, hero: ArtId | null): Promise<World> {
  const now = Date.now();
  const title = plan.title.slice(0, TITLE_MAX);
  const cast: Record<CastKey, CastSlot> = {};
  for (const c of plan.cast) cast[c.key] = emptySlot(c.key);
  const heroKey = planHeroKey(plan);
  if (hero && cast[heroKey]) cast[heroKey] = { ...cast[heroKey], art: hero, madeBy: 'student' };
  const step = startStep(title, now);
  const config = getState().config;
  const world: World = {
    format: 'amble-world',
    version: 1,
    id: uid('w_'),
    title,
    pitch: idea.slice(0, PITCH_MAX),
    level: config.level,
    createdAt: now,
    updatedAt: now,
    openedAt: now,
    origin: { kind: 'plan', starter: plan.starter, planTitle: plan.title },
    code: warmupCode(plan),
    cast,
    sounds: {},
    dials: {},
    twists: [],
    controls: {},
    gameStorage: {},
    steps: [step],
    head: step.id,
    assignment: null,
    handIn: { fileName: null, savedAt: null, method: null, turnedInAt: null },
    credits: { madeBy: '' },
    plan,
  };
  return commitWorld(world);
}

const builds = new Map<WorldId, AbortController>();

/** Whether a build started from Home is still running for this world. */
export function isBuilding(worldId: WorldId): boolean {
  return builds.has(worldId);
}

function showJob(worldId: WorldId, request: string, progress: AiProgress | null, startedAt: number): void {
  setState((s) => {
    s.ai.job = progress ? { worldId, task: 'build', request, progress, startedAt } : null;
  });
}

async function applyBuild(worldId: WorldId, outcome: Extract<AiOutcome, { kind: 'accepted' | 'fallback' }>, title: string): Promise<void> {
  const { store, history } = getServices();
  // The open world takes the change through its own session (no restart, M2); otherwise it is saved.
  if (getState().session.world?.id === worldId) {
    try {
      await applyAccepted(outcome);
      return;
    } catch {
      // Not wired yet: save it to the world below.
    }
  }
  const latest = await store.worlds.get(worldId);
  if (!latest) return;
  const changed: World = { ...latest, code: outcome.files, updatedAt: Date.now() };
  let next = changed;
  try {
    next = await history.record(changed, { kind: 'ask', by: 'ai', text: t('home.buildStep', { title }), tested: outcome.kind === 'accepted' ? outcome.tested : false });
  } catch {
    next = changed;
  }
  await store.commit({ worlds: [next] });
  void refreshLibrary(store);
}

/**
 * Starts `AiService.build` in the background after a random 0-3 s wait (§5.2, so a class that presses
 * at once does not arrive at once). The Warm-up keeps playing; an accepted (or ladder) result replaces
 * the code; anything else leaves the world as it was.
 */
export function startBuild(worldId: WorldId, plan: PlanReply, idea: string): void {
  builds.get(worldId)?.abort();
  const ctl = new AbortController();
  builds.set(worldId, ctl);
  const startedAt = Date.now();
  showJob(worldId, idea, { phase: 'queued' }, startedAt);
  const wait = Math.random() * 3000;
  setTimeout(() => {
    void (async () => {
      const { ai, store } = getServices();
      try {
        const world = await store.worlds.get(worldId);
        if (!world || ctl.signal.aborted) return;
        const outcome = await ai.build(world, plan, {
          signal: ctl.signal,
          onProgress: (p) => {
            if (!ctl.signal.aborted) showJob(worldId, idea, p, startedAt);
          },
        });
        setState((s) => {
          s.ai.lastOutcome = outcome;
        });
        if (outcome.kind === 'accepted' || outcome.kind === 'fallback') await applyBuild(worldId, outcome, world.title);
      } catch (err) {
        console.warn('The build stopped:', err);
      } finally {
        if (builds.get(worldId) === ctl) builds.delete(worldId);
        if (getState().ai.job?.worldId === worldId) showJob(worldId, idea, null, startedAt);
      }
    })();
  }, wait);
}

/** Stops a build started from Home (the world keeps its Warm-up). */
export function stopBuild(worldId: WorldId): void {
  builds.get(worldId)?.abort();
  builds.delete(worldId);
}

/** An assignment's world: its starter as a seed (draw first), carrying the assignment. */
export async function createAssignmentWorld(asg: Assignment): Promise<{ world: World; heroKey: CastKey }> {
  const { starters } = getServices();
  const seed = asg.starter ?? 'moon-king';
  const { world, art, blobs } = await starters.open(seed, { withArt: false });
  const title = asg.title.slice(0, TITLE_MAX) || world.title;
  const step = startStep(title, Date.now());
  const made: World = {
    ...world,
    title,
    origin: { kind: 'assignment', assignmentId: asg.id, starter: asg.starter },
    assignment: asg,
    steps: [step],
    head: step.id,
  };
  await commitWorld(made, { art, blobs });
  return { world: made, heroKey: starters.info(seed).heroKey };
}

/** Rename from the sign menu (40 characters at most; an empty name keeps the old one). */
export async function renameWorld(id: WorldId, title: string): Promise<World | null> {
  const { store } = getServices();
  const world = await store.worlds.get(id);
  const name = title.replace(/\s+/g, ' ').trim().slice(0, TITLE_MAX);
  if (!world || !name || name === world.title) return world;
  return commitWorld({ ...world, title: name, updatedAt: Date.now() });
}

/** Make a copy: the same world under a new id, starting its own Footsteps. */
export async function copyWorld(id: WorldId): Promise<World | null> {
  const { store } = getServices();
  const world = await store.worlds.get(id);
  if (!world) return null;
  const now = Date.now();
  // Shorten the old title, never the "(copy)" words, so a long title still reads as a copy.
  const room = TITLE_MAX - t('home.copyTitle', { title: '' }).length;
  const title = t('home.copyTitle', { title: world.title.slice(0, Math.max(1, room)).trimEnd() }).slice(0, TITLE_MAX);
  const step = startStep(title, now);
  const copy: World = {
    ...world,
    id: uid('w_'),
    title,
    createdAt: now,
    updatedAt: now,
    openedAt: now,
    steps: [step],
    head: step.id,
    handIn: { fileName: null, savedAt: null, method: null, turnedInAt: null },
  };
  return commitWorld(copy);
}
