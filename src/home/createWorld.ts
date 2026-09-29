/**
 * Making worlds from Home (§2.3-2.5): a seed with the student's hero ("Give Blorp a world"), a plan's
 * world with its Warm-up game and the build started in the background, an assignment's world, and the
 * sign menu's Rename and Make a copy. Every write is one `Store.commit`.
 */
import { getServices } from '../app/services';
import { t } from '../i18n';
import { uid } from '../model/ids';
import type { ArtId, ArtRecord, Assignment, CastKey, CastSlot, PlanReply, StarterId, StepSummary, World, WorldId } from '../model/types';
import { startBuild as startBuildJob } from '../state/ai';
import { refreshLibrary } from '../state/library';
import { getState } from '../state/store';
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

/**
 * A world type with the student's hero drawn and everything else as just bones ("Give Blorp a world"). The
 * hero keeps the name the student gave it, everywhere the world names it (the Cast, the Desk, Footsteps).
 */
export async function openSeed(seed: StarterId, hero: ArtId | null): Promise<World> {
  const { world, art, blobs } = await seedWorld(seed, hero);
  return commitWorld(world, { art, blobs });
}

/** A world type opened with the student's hero (if any) drawn and called by its name; not saved yet. */
async function seedWorld(seed: StarterId, hero: ArtId | null): Promise<{ world: World; art: ArtRecord[]; blobs: Blob[] }> {
  const { starters, store } = getServices();
  const opened = await starters.open(seed, hero ? { withArt: false, hero } : { withArt: false });
  const name = hero ? ((await store.art.get(hero))?.name ?? '').trim() : '';
  if (!name) return opened;
  // The code tools load only here, never with the first screen.
  const { renameMembers } = await import('../pipeline/ladder');
  return { ...opened, world: { ...opened.world, code: renameMembers(opened.world.code, { [starters.info(seed).heroKey]: name }) } };
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

/**
 * Starts the build in the background (§2.5) as the AI slice's job (M5): it waits its random 0-3 s
 * (§5.2), drives the build pill, and writes the result to the world (the open one, or the stored one
 * while the student draws). The Warm-up keeps playing meanwhile.
 */
export function startBuild(world: World, plan: PlanReply): void {
  void startBuildJob(world, plan).catch((err: unknown) => console.warn('The build stopped:', err));
}

/**
 * An assignment's world: its starter as a seed, carrying the assignment. The Trail's note starts it with
 * nothing drawn (draw first); the First page's "From your teacher" card starts it with the hero just drawn.
 */
export async function createAssignmentWorld(asg: Assignment, hero: ArtId | null = null): Promise<{ world: World; heroKey: CastKey }> {
  const { starters } = getServices();
  const seed = asg.starter ?? 'moon-king';
  const { world, art, blobs } = await seedWorld(seed, hero);
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
