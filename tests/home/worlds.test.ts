/**
 * Making worlds from Home (§2.3-2.5): a plan's world with its Warm-up, the build started in the
 * background, the sign menu's Rename and Make a copy, starter copies kept only once changed, and the
 * idea's trip to a plan.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setServices, type Services } from '../../src/app/services';
import type { FilesApi } from '../../src/files/api';
import { createHistory } from '../../src/history/api';
import { copyWorld, createPlanWorld, firstToDraw, openSeed, planHeroKey, renameWorld, startBuild } from '../../src/home/createWorld';
import { getPlanSession, planSeconds, resetPlanSession, startPlan, stopPlan } from '../../src/home/planSession';
import { isUntouchedStarterCopy, routeWorldId } from '../../src/home/starterCopies';
import type { AiOutcome, PlanOutcome } from '../../src/model/types';
import { createAppAi, type AiService } from '../../src/pipeline/api';
import type { SchoolApi } from '../../src/school/api';
import type { PlayerHost } from '../../src/app/player/host';
import { createStarterCatalog } from '../../src/starters/api';
import { getState, resetState } from '../../src/state/store';
import { MemoryStore } from '../../src/store/memory';
import { samplePlan, sampleWorld } from '../foundation/samples';

function services(over: Partial<Services> = {}): Services {
  const s: Services = {
    store: new MemoryStore(),
    files: {} as FilesApi,
    ai: createAppAi(),
    history: createHistory(),
    starters: createStarterCatalog(),
    school: {} as SchoolApi,
    player: {} as PlayerHost,
    ...over,
  };
  setServices(s);
  return s;
}

beforeEach(() => resetState());
afterEach(() => {
  vi.useRealTimers();
  resetPlanSession();
});

describe("a plan's world", () => {
  it('lines the cast up as slots, puts the hero drawing in its slot and plays the Warm-up', async () => {
    const { store } = services();
    const plan = samplePlan();
    const world = await createPlanWorld(plan, 'a snail who rescues friends', 'a_hero000001');
    expect(world.origin).toEqual({ kind: 'plan', starter: 'moon-king', planTitle: 'Snail Rescue' });
    expect(Object.keys(world.cast)).toEqual(['hero', 'saltKing']);
    expect(world.cast.hero).toMatchObject({ art: 'a_hero000001', madeBy: 'student' });
    expect(world.cast.saltKing.art).toBeNull();
    expect(world.code.map((f) => f.path)).toEqual(['game.js']);
    expect(world.code[0].source).toContain('Warm-up');
    expect(world.plan).toBe(plan);
    expect(world.pitch).toBe('a snail who rescues friends');
    expect(world.steps).toHaveLength(1);
    expect(await store.worlds.get(world.id)).toEqual(world);
  });

  it('draws the hero first, or the next required character when the hero is drawn', () => {
    const plan = samplePlan();
    expect(planHeroKey(plan)).toBe('hero');
    expect(firstToDraw(plan, false)?.key).toBe('hero');
    expect(firstToDraw(plan, true)?.key).toBe('saltKing');
    expect(firstToDraw(samplePlan({ cast: plan.cast.slice(0, 1) }), true)).toBeNull();
  });

  it('starts the build in the background and saves an accepted result', async () => {
    const files = [{ path: 'game.js', source: '// built', authors: [['ai', 1]] as Array<['ai', number]>, locked: [] }];
    const accepted: AiOutcome = { kind: 'accepted', files, manifest: {} as never, summary: 'Built', play: '', next: [], safety: { kind: 'ok', note: '' }, repairs: 0, tested: true, handEditsTouched: false, newArt: [] };
    const build = vi.fn<AiService['build']>(async () => accepted);
    const { store } = services({ ai: { ...createAppAi(), build } });
    const world = await createPlanWorld(samplePlan(), 'idea', null);
    startBuild(world, samplePlan());
    expect(getState().ai.job).toMatchObject({ worldId: world.id, task: 'build' });
    await vi.waitFor(() => expect(getState().ai.job).toBeNull());
    expect(build).toHaveBeenCalledOnce();
    const saved = await store.worlds.get(world.id);
    expect(saved?.code[0].source).toBe('// built');
    expect(saved?.steps.at(-1)).toMatchObject({ kind: 'ask', by: 'ai', tested: true });
  });

  it("quotes the student's own idea in the build's footstep, never the plan's pitch as if they said it", async () => {
    const files = [{ path: 'game.js', source: '// built', authors: [['ai', 1]] as Array<['ai', number]>, locked: [] }];
    const accepted: AiOutcome = { kind: 'accepted', files, manifest: {} as never, summary: 'Built', play: '', next: [], safety: { kind: 'ok', note: '' }, repairs: 0, tested: true, handEditsTouched: false, newArt: [] };
    const build = vi.fn<AiService['build']>(async () => accepted);
    const { store } = services({ ai: { ...createAppAi(), build } });
    const plan = samplePlan();
    const world = await createPlanWorld(plan, 'a snail who rescues her friends', null);
    startBuild(world, plan);
    expect(getState().ai.job).toMatchObject({ worldId: world.id, task: 'build', request: 'a snail who rescues her friends' });
    await vi.waitFor(() => expect(getState().ai.job).toBeNull());
    expect((await store.worlds.get(world.id))?.steps.at(-1)).toMatchObject({ kind: 'ask', by: 'ai', request: 'a snail who rescues her friends' });
  });

  it('keeps the Warm-up when the build fails', async () => {
    const build = vi.fn<AiService['build']>(async () => ({ kind: 'failed', reason: 'runtime', message: 'no', details: [] }));
    const { store } = services({ ai: { ...createAppAi(), build } });
    const world = await createPlanWorld(samplePlan(), 'idea', null);
    startBuild(world, samplePlan());
    await vi.waitFor(() => expect(getState().ai.job).toBeNull());
    expect(build).toHaveBeenCalledOnce();
    expect((await store.worlds.get(world.id))?.code[0].source).toContain('Warm-up');
  });
});

describe('seeds, renames and copies', () => {
  it("opens a world type with the student's hero drawn", async () => {
    const { store } = services();
    const world = await openSeed('moon-king', 'a_hero000001');
    expect(world.origin).toMatchObject({ kind: 'starter', starter: 'moon-king', withArt: false });
    expect(world.cast.hero.art).toBe('a_hero000001');
    expect(await store.worlds.get(world.id)).not.toBeNull();
  });

  it('renames (40 characters at most) and makes copies with their own Footsteps', async () => {
    const { store } = services();
    await store.commit({ worlds: [sampleWorld()] });
    const renamed = await renameWorld('w_sample0001', `  ${'A'.repeat(50)}  `);
    expect(renamed?.title).toBe('A'.repeat(40));
    expect(await renameWorld('w_sample0001', '   ')).toMatchObject({ title: 'A'.repeat(40) });
    const copy = await copyWorld('w_sample0001');
    expect(copy?.id).not.toBe('w_sample0001');
    expect(copy?.title).toContain('(copy)');
    expect(copy?.steps).toHaveLength(1);
    expect(copy?.code).toEqual(sampleWorld().code);
    expect((await store.worlds.list()).length).toBe(2);
  });
});

describe('starter copies', () => {
  const copy = sampleWorld({ origin: { kind: 'starter', starter: 'moon-king', withArt: true }, dials: {}, twists: [], cast: { hero: { key: 'hero', art: 'a_x', madeBy: 'example', extra: null, laterUntil: 0 } } });

  it('are untouched until the student changes something', () => {
    expect(isUntouchedStarterCopy(copy)).toBe(true);
    expect(isUntouchedStarterCopy({ ...copy, dials: { jump: 900 } })).toBe(false);
    expect(isUntouchedStarterCopy({ ...copy, twists: ['moonGravity'] })).toBe(false);
    expect(isUntouchedStarterCopy({ ...copy, steps: [...copy.steps, { ...copy.steps[0], id: 's_2', kind: 'draw' }] })).toBe(false);
    expect(isUntouchedStarterCopy({ ...copy, cast: { hero: { ...copy.cast.hero, madeBy: 'student' } } })).toBe(false);
  });

  it('never count seeds or plan worlds (the hero is the student’s)', () => {
    expect(isUntouchedStarterCopy({ ...copy, origin: { kind: 'starter', starter: 'moon-king', withArt: false } })).toBe(false);
    expect(isUntouchedStarterCopy({ ...copy, origin: { kind: 'plan', starter: 'moon-king', planTitle: 'x' } })).toBe(false);
  });

  it("know when the student is still inside a world", () => {
    expect(routeWorldId({ name: 'world', id: 'w_1' })).toBe('w_1');
    expect(routeWorldId({ name: 'draw', worldId: 'w_1', key: 'hero' })).toBe('w_1');
    expect(routeWorldId({ name: 'trail', view: 'trail' })).toBeNull();
  });
});

describe('the idea on its way to a plan', () => {
  it('waits, then keeps the outcome and how long it took', async () => {
    let resolve: (o: PlanOutcome) => void = () => undefined;
    const plan = vi.fn<AiService['plan']>(() => new Promise<PlanOutcome>((r) => (resolve = r)));
    const ai = { ...createAppAi(), plan };
    const run = startPlan(ai, 'a snail', { id: 'a_1', name: 'Shelly', kind: 'character', rig: 'blob' }, 'middle', () => 'sky-run');
    expect(getPlanSession()).toMatchObject({ idea: 'a snail', status: 'waiting' });
    expect(plan.mock.calls[0][1]).toMatchObject({ level: 'middle', hero: { name: 'Shelly', kind: 'character', rig: 'blob' } });
    resolve({ kind: 'plan', plan: samplePlan() });
    await run;
    expect(getPlanSession()).toMatchObject({ status: 'done', outcome: { kind: 'plan' } });
    expect(planSeconds(getPlanSession())).toBeGreaterThanOrEqual(1);
  });

  it('falls back to the closest starter when the call breaks', async () => {
    const ai = { ...createAppAi(), plan: vi.fn<AiService['plan']>(async () => Promise.reject(new Error('blocked'))) };
    await startPlan(ai, 'a runner in the sky', null, 'middle', () => 'sky-run');
    expect(getPlanSession().outcome).toMatchObject({ kind: 'fallback', starter: 'sky-run' });
  });

  it('stops, keeping the words', async () => {
    const ai = { ...createAppAi(), plan: vi.fn<AiService['plan']>((_idea, o) => new Promise<PlanOutcome>((_r, reject) => o.signal.addEventListener('abort', () => reject(new Error('aborted'))))) };
    const run = startPlan(ai, 'a maze of ghosts', null, 'middle', () => 'lantern-maze');
    stopPlan();
    await run;
    expect(getPlanSession()).toMatchObject({ idea: 'a maze of ghosts', status: 'idle', outcome: null });
  });
});
