/**
 * The open world has one copy in the session, saved by the autosave 0.8-2.8 s after each change, and other
 * screens commit whole worlds straight to the store (Go back, Run it, Bring to life, an AI build). A copy
 * still waiting in the autosave must never be written over a newer commit: "nothing is ever lost" (§1.5).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getServices, setServices, type Services } from '../../src/app/services';
import { newArtDoc, type ArtExportResult } from '../../src/cores/art';
import { EMPTY_MANIFEST, type GameManifest } from '../../src/cores/play';
import { templateFor } from '../../src/cores/rig';
import { bringToLife, sessionLink, type BringDeps } from '../../src/draw/api';
import { createHistory } from '../../src/history/api';
import { playWorld } from '../../src/history/live';
import type { AiOutcome, PlanReply, World } from '../../src/model/types';
import { startBuild } from '../../src/state/ai';
import { closeWorld, flushWorld, openWorld, patchSession, setDial, updateWorld } from '../../src/state/session';
import { getState, resetState, setState } from '../../src/state/store';
import { createStarterCatalog } from '../../src/starters/api';
import { MemoryStore } from '../../src/store/memory';
import { sampleWorld } from '../foundation/samples';

const MANIFEST: GameManifest = {
  ...EMPTY_MANIFEST,
  title: 'Moon King',
  kit: true,
  dials: [{ key: 'orbSpeed', label: 'Orb speed', value: 280, min: 120, max: 480, step: 10, live: true, words: '', current: 280, source: 'static' }],
};

function fakePlayer() {
  const noop = () => undefined;
  return {
    attach: vi.fn(() => noop),
    load: vi.fn(async () => MANIFEST),
    robot: vi.fn(),
    promote: vi.fn(async () => undefined),
    manifest: vi.fn(() => MANIFEST),
    swapArt: vi.fn(),
    clearArt: vi.fn(),
    dial: vi.fn(),
    twist: vi.fn(),
    prefs: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    restartLevel: vi.fn(),
    setMode: vi.fn(),
    select: vi.fn(),
    celebrate: vi.fn(),
    step: vi.fn(),
    snapshot: vi.fn(async () => null),
    key: vi.fn(),
    releaseKeys: vi.fn(),
    focus: vi.fn(),
    fullscreen: vi.fn(),
    setTitle: vi.fn(),
    on: vi.fn(() => noop),
    onObjects: vi.fn(() => noop),
  };
}

const png = (n: number) => new Blob([new Uint8Array([137, 80, 78, 71, n, n + 1, n + 2])], { type: 'image/png' });

function exported(): ArtExportResult {
  return {
    flat: { png: png(1), w: 200, h: 180 },
    box: [100, 120, 400, 360],
    scale: 0.5,
    anchor: [100, 178],
    anchorBoard: [300, 476],
    layers: [],
    linesMask: { png: png(2), w: 200, h: 180 },
    parts: [],
    thumb: { png: png(3), w: 128, h: 115 },
  } as ArtExportResult;
}

function bringDeps(): BringDeps {
  const s = getServices();
  return {
    store: s.store,
    history: s.history,
    player: s.player,
    rig: async () => ({ rig: templateFor('blob', 200, 180), confidence: 0.9, notes: [], issues: [] }),
    sticker: async () => png(4),
    export: async () => null,
    session: sessionLink(),
  };
}

let store: MemoryStore;
let world: World;

beforeEach(async () => {
  resetState();
  closeWorld();
  store = new MemoryStore();
  setServices({ store, player: fakePlayer(), history: createHistory(), starters: createStarterCatalog() } as unknown as Services);
  world = sampleWorld({ id: 'w_races00001', cast: { boss: { key: 'boss', art: null, madeBy: null, extra: null, laterUntil: 0 } }, dials: {}, twists: [] });
  await store.commit({ worlds: [world] });
  await openWorld(world.id);
  patchSession({ manifest: structuredClone(MANIFEST) });
  // Worlds are born without a snapshot of their first step: the world screen makes it on open.
  await getServices().history.ensureHead(world);
});

afterEach(async () => {
  vi.useRealTimers();
  await flushWorld();
});

describe('a copy waiting in the autosave', () => {
  it('never undoes Go back', async () => {
    vi.useFakeTimers();
    setDial('orbSpeed', 250);
    await vi.advanceTimersByTimeAsync(1600);
    await vi.waitFor(() => expect(getState().session.world?.steps.at(-1)?.kind).toBe('dials'));

    // Footsteps: ↺ Go back to the first step (FootstepsPanel.goBack).
    const open = getState().session.world!;
    const back = await getServices().history.goBack(open, open.steps[0].id);
    await playWorld(back);
    await vi.advanceTimersByTimeAsync(5000);

    const stored = await store.worlds.get(world.id);
    expect(stored?.head).toBe(back.head);
    expect(stored?.dials).toEqual({});
    expect(getState().session.world?.head).toBe(back.head);
  });

  it('never takes a drawing brought to life out of the world', async () => {
    vi.useFakeTimers();
    // An unsaved change in the open world, then the Desk (the world screen has left; the session stays).
    updateWorld((w) => {
      w.title = 'Pizza Boss';
    });
    const res = await bringToLife(
      {
        doc: newArtDoc({ name: 'Boss', kind: 'character', rig: 'blob', width: 64, height: 64, layers: 'freehand' }),
        artId: null,
        name: 'Boss',
        kind: 'character',
        rig: 'blob',
        mode: 'free',
        parts: {},
        worldId: world.id,
        castKey: 'boss',
        shelf: false,
        guideHints: null,
        exported: exported(),
      },
      bringDeps(),
    );
    await vi.advanceTimersByTimeAsync(5000);
    // Back in the world.
    await openWorld(world.id);
    await flushWorld();

    const stored = await store.worlds.get(world.id);
    expect(stored?.cast.boss.art).toBe(res.record.id);
    expect(stored?.title).toBe('Pizza Boss');
    expect(stored?.steps.at(-1)?.kind).toBe('draw');
    expect(getState().session.world?.cast.boss.art).toBe(res.record.id);
    expect(getState().session.world?.title).toBe('Pizza Boss');
  });

  it('puts a build that lands while the student watches the Warm-up into the game', async () => {
    const built = 'class Game extends Amble.Scene {}\n// built';
    const outcome: Extract<AiOutcome, { kind: 'accepted' }> = {
      kind: 'accepted',
      files: [{ path: 'game.js', source: built, authors: [['ai', 2]], locked: [] }],
      manifest: MANIFEST,
      summary: 'a boss fight.',
      play: '',
      next: [],
      safety: { kind: 'ok', note: '' },
      repairs: 0,
      tested: true,
      handEditsTouched: false,
      newArt: [],
    };
    (getServices() as unknown as { ai: { build: () => Promise<AiOutcome> } }).ai = { build: async () => outcome };
    const player = getServices().player as unknown as ReturnType<typeof fakePlayer>;
    // Build it first: the world screen shows the Warm-up, playing.
    setState((s) => {
      s.app.route = { name: 'world', id: world.id };
    });
    patchSession({ player: 'running', mode: 'play' });
    player.load.mockClear();
    await startBuild(getState().session.world!, { pitch: 'a boss fight', title: 'Moon King' } as PlanReply);
    // Mid-play it waits for a pause as "New version ready"; stopped, it loads at once.
    expect(getState().session.newVersion).toEqual({ summary: 'a boss fight.', ready: true });
    patchSession({ newVersion: null, player: 'paused' });
    (getServices() as unknown as { ai: { build: () => Promise<AiOutcome> } }).ai = { build: async () => ({ ...outcome, summary: 'again.' }) };
    await startBuild(getState().session.world!, { pitch: 'a boss fight', title: 'Moon King' } as PlanReply);
    await vi.waitFor(() => expect(player.load).toHaveBeenCalled());
  });

  it("never undoes an AI build that lands while the world is open", async () => {
    vi.useFakeTimers();
    const built = 'class Game extends Amble.Scene {}\n// built';
    const outcome: Extract<AiOutcome, { kind: 'accepted' }> = {
      kind: 'accepted',
      files: [{ path: 'game.js', source: built, authors: [['ai', 2]], locked: [] }],
      manifest: MANIFEST,
      summary: 'a boss fight.',
      play: '',
      next: [],
      safety: { kind: 'ok', note: '' },
      repairs: 0,
      tested: true,
      handEditsTouched: false,
      newArt: [],
    };
    const services = getServices() as unknown as { ai: { build: () => Promise<AiOutcome> } };
    let answer: (o: AiOutcome) => void = () => undefined;
    services.ai = { build: () => new Promise<AiOutcome>((resolve) => (answer = resolve)) };
    const job = startBuild(getState().session.world!, { pitch: 'a boss fight', title: 'Moon King' } as PlanReply);
    // The student renames the world while it builds; the build lands before that change is saved.
    updateWorld((w) => {
      w.title = 'Pizza Boss';
    });
    answer(outcome);
    await job;
    await vi.advanceTimersByTimeAsync(8000);

    const stored = await store.worlds.get(world.id);
    expect(stored?.code[0].source).toBe(built);
    expect(stored?.title).toBe('Pizza Boss');
    expect(getState().session.world?.code[0].source).toBe(built);
  });
});
