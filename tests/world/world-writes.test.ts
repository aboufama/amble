/**
 * Writes to a stored world take turns (§4.4): Bring to life and a build that lands while the student draws
 * (Draw while it builds, the world not open in the session) each read the stored world and commit all of it.
 * Overlapping, the one written last used to drop the other's change: the drawing's cast slot or the built game.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getServices, setServices, type Services } from '../../src/app/services';
import { newArtDoc, type ArtExportResult } from '../../src/cores/art';
import { EMPTY_MANIFEST, type GameManifest } from '../../src/cores/play';
import { templateFor } from '../../src/cores/rig';
import { bringToLife, sessionLink, type BringDeps } from '../../src/draw/api';
import { createHistory } from '../../src/history/api';
import type { AiOutcome, PlanReply, World } from '../../src/model/types';
import { startBuild } from '../../src/state/ai';
import { closeWorld } from '../../src/state/session';
import { resetState } from '../../src/state/store';
import { createStarterCatalog } from '../../src/starters/api';
import type { Store } from '../../src/store/api';
import { MemoryStore } from '../../src/store/memory';
import { writeWorld } from '../../src/store/worldWrites';
import { sampleWorld } from '../foundation/samples';

const MANIFEST: GameManifest = { ...EMPTY_MANIFEST, title: 'Moon King', kit: true };
const BUILT = 'class Game extends Amble.Scene {}\n// built';

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
    player: null,
    rig: async () => ({ rig: templateFor('blob', 200, 180), confidence: 0.9, notes: [], issues: [] }),
    sticker: async () => png(4),
    export: async () => null,
    session: sessionLink(),
  };
}

const bring = (worldId: string) =>
  bringToLife(
    {
      doc: newArtDoc({ name: 'Boss', kind: 'character', rig: 'blob', width: 64, height: 64, layers: 'freehand' }),
      artId: null,
      name: 'Boss',
      kind: 'character',
      rig: 'blob',
      mode: 'free',
      parts: {},
      worldId,
      castKey: 'boss',
      shelf: false,
      guideHints: null,
      exported: exported(),
    },
    bringDeps(),
  );

const outcome: Extract<AiOutcome, { kind: 'accepted' }> = {
  kind: 'accepted',
  files: [{ path: 'game.js', source: BUILT, authors: [['ai', 2]], locked: [] }],
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

/** Holds the first commit `match` picks until `release()`; `reached` resolves when that commit starts. */
function holdCommit(store: Store, match: (c: Parameters<Store['commit']>[0]) => boolean) {
  const commit = store.commit.bind(store);
  let release: () => void = () => undefined;
  let reach: () => void = () => undefined;
  const reached = new Promise<void>((r) => (reach = r));
  const gate = new Promise<void>((r) => (release = r));
  let held = false;
  store.commit = async (c) => {
    if (!held && match(c)) {
      held = true;
      reach();
      await gate;
    }
    return commit(c);
  };
  return { reached, release: () => release() };
}

let store: MemoryStore;
let world: World;

beforeEach(async () => {
  resetState();
  closeWorld();
  store = new MemoryStore();
  setServices({ store, player: { promote: vi.fn(async () => undefined) }, history: createHistory(), starters: createStarterCatalog() } as unknown as Services);
  // A plan's world, drawn on the Desk while it builds: not open in the session.
  world = sampleWorld({ id: 'w_writes0001', cast: { boss: { key: 'boss', art: null, madeBy: null, extra: null, laterUntil: 0 } }, dials: {}, twists: [] });
  await store.commit({ worlds: [world] });
  await getServices().history.ensureHead(world);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('writeWorld', () => {
  it('runs one task at a time per world, in order, and worlds apart side by side', async () => {
    const log: string[] = [];
    let open: () => void = () => undefined;
    const first = writeWorld('w_a', async () => {
      log.push('a1 start');
      await new Promise<void>((r) => (open = r));
      log.push('a1 end');
    });
    const second = writeWorld('w_a', async () => {
      log.push('a2');
    });
    const other = writeWorld('w_b', async () => {
      log.push('b');
    });
    await other;
    expect(log).toEqual(['a1 start', 'b']);
    open();
    await Promise.all([first, second]);
    expect(log).toEqual(['a1 start', 'b', 'a1 end', 'a2']);
  });

  it('goes on after a task that failed', async () => {
    const failed = writeWorld('w_c', async () => {
      throw new Error('no');
    });
    await expect(failed).rejects.toThrow('no');
    await expect(writeWorld('w_c', async () => 'next')).resolves.toBe('next');
  });
});

describe('Bring to life and a build writing the same stored world', () => {
  it('keeps the drawing when the build lands while Bring to life commits', async () => {
    const hold = holdCommit(store, (c) => !!c.art?.length && !!c.worlds?.length);
    const brought = bring(world.id);
    await hold.reached;
    // The build lands now: it reads the stored world while the drawing's commit is still going.
    (getServices() as unknown as { ai: { build: () => Promise<AiOutcome> } }).ai = { build: async () => outcome };
    const built = startBuild(world, { pitch: 'a boss fight', title: 'Moon King' } as PlanReply);
    await new Promise((r) => setTimeout(r, 20));
    hold.release();
    const res = await brought;
    await built;

    const stored = await store.worlds.get(world.id);
    expect(stored?.code[0].source).toBe(BUILT);
    expect(stored?.cast.boss.art).toBe(res.record.id);
    expect(stored?.steps.map((s) => s.kind)).toEqual(['start', 'draw', 'ask']);
  });

  it('keeps the built game when Bring to life reads while the build commits', async () => {
    const hold = holdCommit(store, (c) => !!c.worlds?.some((w) => w.code[0]?.source === BUILT));
    (getServices() as unknown as { ai: { build: () => Promise<AiOutcome> } }).ai = { build: async () => outcome };
    const built = startBuild(world, { pitch: 'a boss fight', title: 'Moon King' } as PlanReply);
    await hold.reached;
    // The student brings the drawing to life while the built game is being written.
    const brought = bring(world.id);
    await new Promise((r) => setTimeout(r, 20));
    hold.release();
    const res = await brought;
    await built;

    const stored = await store.worlds.get(world.id);
    expect(stored?.code[0].source).toBe(BUILT);
    expect(stored?.cast.boss.art).toBe(res.record.id);
    expect(stored?.steps.map((s) => s.kind)).toEqual(['start', 'ask', 'draw']);
  });
});
