/**
 * Footsteps storage (§4.5): record and go back never delete and always append, dial bursts merge,
 * snapshots share blobs by reference, and a step's diff says what it changed.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { createHistory, type HistoryApi } from '../../src/history/api';
import { canGoBack, GoBackError } from '../../src/history/goBack';
import { DIAL_MERGE_MS } from '../../src/history/record';
import type { ArtRecord, World } from '../../src/model/types';
import { MemoryStore } from '../../src/store/memory';
import { REF_A, REF_B, REF_C, sampleArt, sampleWorld } from '../foundation/samples';

let store: MemoryStore;
let clock: number;
let ids: number;
let history: HistoryApi;

const exportOf = (sticker: typeof REF_A, hash: string): NonNullable<ArtRecord['export']> => ({
  hash,
  flat: sticker,
  w: 300,
  h: 420,
  anchor: [150, 410],
  inkMask: null,
  parts: {},
  sticker,
  thumb: sticker,
  frames: null,
});

beforeEach(async () => {
  store = new MemoryStore();
  clock = 1_700_000_000_000;
  ids = 0;
  history = createHistory({ store: () => store, now: () => clock, newId: () => `s_${String(++ids).padStart(10, '0')}` });
  await store.commit({ art: [sampleArt({ export: exportOf(REF_B, 'h1') })], worlds: [sampleWorld()] });
});

async function open(): Promise<World> {
  const world = (await store.worlds.get('w_sample0001'))!;
  await history.ensureHead(world);
  return world;
}

describe('record', () => {
  it('appends a step with a snapshot and commits the world', async () => {
    const world = await open();
    clock += 5_000;
    const next = await history.record({ ...world, dials: { jump: 900 } }, { kind: 'dials', by: 'student', text: 'You turned Jump height up to 900.' });
    expect(next.steps.map((s) => s.kind)).toEqual(['start', 'dials']);
    expect(next.head).toBe(next.steps[1].id);
    expect(next.updatedAt).toBe(clock);
    expect((await store.worlds.get(world.id))?.head).toBe(next.head);
    const snap = await store.steps.get(next.head);
    expect(snap?.dials).toEqual({ jump: 900 });
    expect(snap?.art.a_hero000001.export?.sticker).toBe(REF_B);
    expect(world.steps).toHaveLength(1);
  });

  it('shares blobs by reference: snapshots hold refs and never copy pixels', async () => {
    const world = await open();
    const blobsBefore = (await store.estimate()).usage;
    let w = world;
    for (let i = 0; i < 5; i++) {
      clock += 120_000;
      w = await history.record({ ...w, twists: i % 2 ? [] : ['moonGravity'] }, { kind: 'twists', by: 'student', text: 'You switched a twist.' });
    }
    expect((await store.estimate()).usage).toBe(blobsBefore);
    const snaps = await Promise.all(w.steps.map((s) => store.steps.get(s.id)));
    for (const snap of snaps) expect(snap?.art.a_hero000001.doc).toBe(REF_A);
    expect(JSON.stringify(snaps[1]).length).toBeLessThan(4000);
  });

  it('merges a dial burst on the same dial into the step before it', async () => {
    const world = await open();
    clock += 10_000;
    const one = await history.record({ ...world, dials: { jump: 900 } }, { kind: 'dials', by: 'student', text: 'You turned Jump height up to 900.' });
    clock += 3_000;
    const two = await history.record({ ...one, dials: { jump: 960 } }, { kind: 'dials', by: 'student', text: 'You turned Jump height up to 960.' });
    expect(two.steps).toHaveLength(2);
    expect(two.steps[1].id).toBe(one.steps[1].id);
    expect(two.steps[1].text).toBe('You turned Jump height up to 960.');
    expect((await store.steps.get(two.head))?.dials).toEqual({ jump: 960 });
    // Another dial, a pause longer than the window, or anything else in between: a new step.
    clock += 1_000;
    const three = await history.record({ ...two, dials: { jump: 960, orbSpeed: 200 } }, { kind: 'dials', by: 'student', text: 'You turned Orb speed down to 200.' });
    expect(three.steps).toHaveLength(3);
    clock += DIAL_MERGE_MS + 1;
    const four = await history.record({ ...three, dials: { jump: 960, orbSpeed: 180 } }, { kind: 'dials', by: 'student', text: 'You turned Orb speed down to 180.' });
    expect(four.steps).toHaveLength(4);
  });

  it('deletes the snapshot of a step that folds past 60 steps, and keeps its summary', async () => {
    let w = await open();
    const start = w.head;
    for (let i = 0; i < 60; i++) {
      clock += 1_000;
      w = await history.record({ ...w, twists: i % 2 ? [] : ['moonGravity'] }, { kind: 'twists', by: 'student', text: 'You switched a twist.' });
    }
    // 61 steps: the oldest is the only old step of its day, so it keeps its snapshot.
    expect(await store.steps.get(start)).not.toBeNull();
    clock += 1_000;
    w = await history.record(w, { kind: 'twists', by: 'student', text: 'You switched a twist.' });
    expect(w.steps).toHaveLength(62);
    expect(w.steps[0]).toMatchObject({ id: start, kind: 'start' });
    expect(await store.steps.get(start)).toBeNull();
    expect(await store.steps.forWorld(w.id)).toHaveLength(61);
    expect(canGoBack(w, start)).toBe(false);
  });

  it('counts the lines a code step wrote', async () => {
    const world = await open();
    const code = [{ ...world.code[0], source: `${world.code[0].source}\n// one\n// two` }];
    const next = await history.record({ ...world, code }, { kind: 'code', by: 'student', text: 'You changed game.js', files: ['game.js'] });
    expect(next.steps[1]).toMatchObject({ kind: 'code', files: ['game.js'], lines: 2 });
  });
});

describe('goBack', () => {
  it('restores code, drawings and dials, and appends a step (never deletes)', async () => {
    const world = await open();
    clock += 60_000;
    const withDial = await history.record({ ...world, dials: { jump: 900 } }, { kind: 'dials', by: 'student', text: 'You turned Jump height up to 900.' });
    // A redraw of the hero (same record, new pixels), then a code change.
    clock += 60_000;
    await store.commit({ art: [sampleArt({ export: exportOf(REF_C, 'h2'), doc: REF_C, version: 2 })] });
    const redrawn = await history.record(withDial, { kind: 'redraw', by: 'student', text: 'You redrew Pip.', cast: 'hero' });
    clock += 60_000;
    const code = [{ ...redrawn.code[0], source: `${redrawn.code[0].source}\n// mine`, authors: [['starter', 4], ['student', 1]] as World['code'][0]['authors'] }];
    const changed = await history.record({ ...redrawn, code, dials: { jump: 1000 } }, { kind: 'code', by: 'student', text: 'You changed game.js', files: ['game.js'] });

    expect(canGoBack(changed, withDial.head)).toBe(true);
    expect(canGoBack(changed, changed.head)).toBe(false);
    clock += 60_000;
    const back = await history.goBack(changed, withDial.head);
    expect(back.steps.map((s) => s.kind)).toEqual(['start', 'dials', 'redraw', 'code', 'goback']);
    expect(back.steps[4].text).toBe("You went back to 'You turned Jump height up to 900'");
    expect(back.code).toEqual(withDial.code);
    expect(back.dials).toEqual({ jump: 900 });
    const hero = await store.art.get('a_hero000001');
    expect(hero?.export?.sticker).toBe(REF_B);
    expect(hero?.doc).toBe(REF_A);
    expect(hero?.version).toBe(3);
    expect((await store.worlds.get(world.id))?.head).toBe(back.head);

    // Going back is itself undoable: go back to the code step.
    clock += 60_000;
    const forward = await history.goBack(back, changed.head);
    expect(forward.code).toEqual(changed.code);
    expect(forward.dials).toEqual({ jump: 1000 });
    expect((await store.art.get('a_hero000001'))?.export?.sticker).toBe(REF_C);
    expect(forward.steps).toHaveLength(6);
  });

  it("keeps the drawing the student is still working on at the Desk when games saw the same one", async () => {
    const world = await open();
    clock += 60_000;
    const withDial = await history.record({ ...world, dials: { jump: 900 } }, { kind: 'dials', by: 'student', text: 'You turned Jump height up to 900.' });
    // Redrawing the hero at the Desk, saved at a checkpoint but not brought to life yet: new pixels, the
    // same export and bones (what games load).
    clock += 60_000;
    const working = { ...(await store.art.get('a_hero000001'))!, doc: REF_C, cels: [REF_C], updatedAt: clock };
    await store.commit({ art: [working] });
    clock += 60_000;
    const back = await history.goBack(withDial, world.head);
    expect(back.dials).toEqual(world.dials);
    const hero = await store.art.get('a_hero000001');
    expect(hero?.doc).toBe(REF_C);
    expect(hero?.cels).toEqual([REF_C]);
  });

  it('keeps drawn members added later as resting members', async () => {
    const world = await open();
    const withNew = { ...world, cast: { ...world.cast, pizza: { key: 'pizza', art: 'a_pizza00001', madeBy: 'student' as const, extra: null, laterUntil: 0 } } };
    await store.commit({ art: [sampleArt({ id: 'a_pizza00001', name: 'Pizza' })] });
    clock += 60_000;
    const drew = await history.record(withNew, { kind: 'draw', by: 'student', text: 'You drew a Pizza slice.', cast: 'pizza' });
    const back = await history.goBack(drew, world.head);
    expect(back.cast.pizza?.art).toBe('a_pizza00001');
  });

  it('refuses unknown and missing steps without touching the world', async () => {
    const world = await open();
    await expect(history.goBack(world, 's_nope000000')).rejects.toBeInstanceOf(GoBackError);
    const orphan: World = { ...world, steps: [...world.steps, { id: 's_orphan0000', at: clock, by: 'student', kind: 'dials', text: 'x' }] };
    await expect(history.goBack(orphan, 's_orphan0000')).rejects.toMatchObject({ reason: 'missing' });
    expect((await store.worlds.get(world.id))?.steps).toHaveLength(1);
  });
});

describe('without a store', () => {
  it('only appends steps (worlds built before the app has one), and cannot go back', async () => {
    const bare = createHistory({ store: () => null, now: () => 5, newId: () => 's_bare000001' });
    const world = sampleWorld();
    const next = await bare.record(world, { kind: 'import', by: 'student', text: 'You opened Moon King.amble.' });
    expect(next.steps.at(-1)).toEqual({ id: 's_bare000001', at: 5, by: 'student', kind: 'import', text: 'You opened Moon King.amble.' });
    expect(next.head).toBe('s_bare000001');
    await expect(bare.goBack(next, world.head)).rejects.toMatchObject({ reason: 'missing' });
    expect(await bare.diff(next, next.head)).toEqual({ files: [], drawings: [], dials: [] });
  });
});

describe('diff', () => {
  it('shows the code, drawing and dial changes of a step', async () => {
    const world = await open();
    const source = world.code[0].source.replace('this.spawn(100, 300, "hero");', 'this.spawn(120, 300, "hero");');
    clock += 1000;
    const next = await history.record({ ...world, code: [{ ...world.code[0], source }], dials: { jump: 700 } }, { kind: 'ask', by: 'ai', text: 'Amble moved the hero.' });
    const diff = await history.diff(next, next.head);
    expect(diff.files).toHaveLength(1);
    expect(diff.files[0].hunks).toContain('+  create() { this.spawn(120, 300, "hero"); }');
    expect(diff.dials).toEqual([{ key: 'jump', before: 820, after: 700 }]);
    expect(diff.drawings).toEqual([]);
    expect(await history.diff(next, world.head)).toEqual({ files: [], drawings: [], dials: [] });
  });
});
