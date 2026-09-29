/**
 * The session slice's actions (§2.6, §2.7): opening a world keeps a running game, dials move live and
 * print one footstep per burst, twists print theirs, Change mode pauses and resumes, and an accepted AI
 * change adds its cast and loads at once or waits for a pause.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setServices, type Services } from '../../src/app/services';
import { EMPTY_MANIFEST, type ArtNeed, type GameManifest } from '../../src/cores/play';
import { createHistory } from '../../src/history/api';
import type { AiOutcome, World } from '../../src/model/types';
import { createStarterCatalog } from '../../src/starters/api';
import { MemoryStore } from '../../src/store/memory';
import {
  applyAccepted,
  closeWorld,
  flushWorld,
  gameSignature,
  isLoaded,
  loadGame,
  openWorld,
  patchSession,
  setDial,
  setMode,
  setTwist,
} from '../../src/state/session';
import { getState, resetState } from '../../src/state/store';
import { sampleWorld } from '../foundation/samples';

function need(key: string, over: Partial<ArtNeed> = {}): ArtNeed {
  return {
    key, name: key, kind: 'character', rig: 'blob', role: 'enemy', shape: 'capsule', w: 40, h: 40, color: '#f08aa2', ask: '', about: '',
    pronoun: 'them', facing: 'right', priority: 10, required: true, spare: false, declared: true, used: true, drawn: false, ...over,
  };
}

const MANIFEST: GameManifest = {
  ...EMPTY_MANIFEST,
  title: 'Moon King',
  kit: true,
  art: [need('hero', { role: 'hero', priority: 1 }), need('boss', { role: 'boss', priority: 2 })],
  dials: [{ key: 'orbSpeed', label: 'Orb speed', value: 280, min: 120, max: 480, step: 10, live: true, words: '', for: 'boss', current: 280, source: 'static' }],
  twists: [{ id: 'moonGravity', name: 'Moon gravity', does: '', available: true, on: false }],
};

function fakePlayer() {
  return {
    attach: vi.fn(() => () => undefined),
    load: vi.fn(async () => MANIFEST),
    robot: vi.fn(),
    promote: vi.fn(),
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
    on: vi.fn(() => () => undefined),
    onObjects: vi.fn(() => () => undefined),
  };
}

let player: ReturnType<typeof fakePlayer>;
let store: MemoryStore;
let world: World;

beforeEach(async () => {
  resetState();
  closeWorld();
  player = fakePlayer();
  store = new MemoryStore();
  setServices({ store, player, history: createHistory(), starters: createStarterCatalog() } as unknown as Services);
  world = sampleWorld({ id: 'w_session0001', cast: {}, dials: {}, twists: [] });
  await store.commit({ worlds: [world] });
  await openWorld(world.id);
  patchSession({ manifest: structuredClone(MANIFEST) });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('openWorld', () => {
  it('keeps the same world open (and its session) when it comes back from the Desk', async () => {
    patchSession({ mode: 'change', comeAlive: { key: 'boss', artId: 'a_x', sticker: 'blob:x', from: { x: 0, y: 0, width: 10, height: 10 } as DOMRect } });
    await store.commit({ worlds: [{ ...world, updatedAt: world.updatedAt + 10_000, cast: { boss: { key: 'boss', art: 'a_boss000001', madeBy: 'student', extra: null, laterUntil: 0 } } }] });
    const again = await openWorld(world.id);
    expect(again?.cast.boss.art).toBe('a_boss000001');
    expect(getState().session.comeAlive?.key).toBe('boss');
  });

  it('starts a fresh session for another world', async () => {
    const other = sampleWorld({ id: 'w_session0002' });
    await store.commit({ worlds: [other] });
    patchSession({ mode: 'change' });
    await openWorld(other.id);
    expect(getState().session.world?.id).toBe(other.id);
    expect(getState().session.mode).toBe('play');
  });

  it('knows when another screen put another game in the player (a Desk preview, the gallery)', async () => {
    let loads = 0;
    player.load.mockImplementation(async () => {
      loads++;
      return MANIFEST;
    });
    (player as unknown as { loadCount(): number }).loadCount = () => loads;
    const open = getState().session.world!;
    await loadGame(open);
    expect(isLoaded(open)).toBe(true);
    // The Teacher desk's gallery plays a student's world in the same player.
    await player.load();
    expect(isLoaded(open)).toBe(false);
  });

  it('signs a game by its code, sounds and controls, not by its dials', () => {
    expect(gameSignature(world)).toBe(gameSignature({ ...world, dials: { jump: 1 } }));
    expect(gameSignature(world)).not.toBe(gameSignature({ ...world, controls: { jump: ['KeyW'] } }));
  });
});

describe('dials and twists', () => {
  it('turns a dial live and prints one footstep after 1.5 s of rest', async () => {
    vi.useFakeTimers();
    setDial('orbSpeed', 250);
    setDial('orbSpeed', 200);
    setDial('orbSpeed', 160);
    expect(player.dial).toHaveBeenLastCalledWith('orbSpeed', 160);
    expect(getState().session.world?.dials.orbSpeed).toBe(160);
    expect(getState().session.manifest?.dials[0].current).toBe(160);
    await vi.advanceTimersByTimeAsync(1500);
    await vi.waitFor(() => expect(getState().session.world?.steps.at(-1)?.text).toBe('You turned Orb speed down to 160'));
    expect(getState().session.world?.steps.filter((s) => s.kind === 'dials')).toHaveLength(1);
  });

  it('switches a twist live with its footstep', async () => {
    setTwist('moonGravity', true);
    expect(player.twist).toHaveBeenCalledWith('moonGravity', true);
    expect(getState().session.world?.twists).toEqual(['moonGravity']);
    await vi.waitFor(() => expect(getState().session.world?.steps.at(-1)?.text).toBe('You switched on Moon gravity'));
  });

  it('saves the world after changes', async () => {
    setTwist('moonGravity', true);
    await flushWorld();
    expect((await store.worlds.get(world.id))?.twists).toEqual(['moonGravity']);
  });
});

describe('Change mode', () => {
  it('pauses the world and streams its things, then resumes it', () => {
    setMode('change');
    expect(player.pause).toHaveBeenCalled();
    expect(player.setMode).toHaveBeenLastCalledWith('change');
    patchSession({ selectedId: 3, selected: 'boss', scope: 'boss' });
    setMode('play');
    expect(player.select).toHaveBeenLastCalledWith(null);
    expect(player.setMode).toHaveBeenLastCalledWith('play');
    expect(player.resume).toHaveBeenCalled();
    expect(getState().session).toMatchObject({ mode: 'play', selected: null, selectedId: null, scope: null });
  });
});

describe('applyAccepted', () => {
  const outcome = (): Extract<AiOutcome, { kind: 'accepted' }> => ({
    kind: 'accepted',
    files: [{ path: 'game.js', source: 'class Game extends Amble.Scene {}\n// pizza', authors: [], locked: [] }],
    manifest: { ...MANIFEST, art: [...MANIFEST.art, need('pizza', { role: 'item', kind: 'item', rig: 'object' })] },
    summary: 'the Moon King throws pizza.',
    play: '',
    next: [],
    safety: { kind: 'ok', note: '' },
    repairs: 0,
    tested: true,
    handEditsTouched: false,
    newArt: ['pizza'],
  });

  it('adds the new cast, prints a footstep with the words, and loads when nobody is playing', async () => {
    const next = await applyAccepted(outcome(), { task: 'change', request: 'make him throw pizza' });
    expect(next.code[0].source).toContain('pizza');
    expect(next.code[0].authors).toEqual([['ai', 2]]);
    expect(next.cast.pizza).toMatchObject({ key: 'pizza', art: null });
    expect(next.steps.at(-1)).toMatchObject({ kind: 'ask', by: 'ai', text: 'the Moon King throws pizza.', request: 'make him throw pizza', tested: true });
    expect(getState().session.fresh).toEqual(['pizza']);
    expect(getState().session.cast.map((m) => m.key)).toContain('pizza');
    await vi.waitFor(() => expect(player.load).toHaveBeenCalled());
  });

  it('waits for a pause when the student is playing ("New version ready")', async () => {
    patchSession({ player: 'running' });
    await applyAccepted(outcome());
    expect(getState().session.newVersion).toEqual({ summary: 'the Moon King throws pizza.', ready: true });
    expect(player.load).not.toHaveBeenCalled();
  });
});
