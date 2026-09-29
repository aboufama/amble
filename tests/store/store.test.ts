/**
 * The one `amble` database (§4.3) with fake-indexeddb, and the in-memory store (files-only mode) against
 * the same behaviour: atomic commits, content-addressed blobs, Lost and found, stroke logs, drafts, the
 * AI log cap, settings and change events. (FOUNDATION wrote these; M6 owns and extends them.)
 */
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { openAmbleDb, STORE_NAMES } from '../../src/store/idb';
import { IdbStore } from '../../src/store/idbStore';
import { MemoryStore } from '../../src/store/memory';
import { openStore } from '../../src/store';
import type { Store, StoreChange } from '../../src/store/api';
import type { StepSnapshot } from '../../src/model/types';
import { REF_A, sampleArt, sampleClassLink, sampleDraft, sampleLog, samplePrefs, sampleStep, sampleWorld } from '../foundation/samples';

const IMPLS: Array<[string, () => Promise<Store>]> = [
  ['IndexedDB', async () => new IdbStore(await openAmbleDb(new IDBFactory()))],
  ['memory', async () => new MemoryStore()],
];

const bytes = (...n: number[]) => new Uint8Array(n);

describe.each(IMPLS)('%s store', (_name, make) => {
  it('commits worlds, metas, art, steps and blobs together', async () => {
    const store = await make();
    const world = sampleWorld();
    const flat = new Blob([bytes(1, 2, 3)], { type: 'image/png' });
    await store.commit({ blobs: [flat], worlds: [world], art: [sampleArt()], steps: [sampleStep(world)] });
    expect(await store.worlds.get(world.id)).toEqual(world);
    const [meta] = await store.worlds.list();
    expect(meta).toMatchObject({ id: world.id, title: world.title, hero: 'a_hero000001', drawn: 1, needed: 2, putAwayAt: null });
    expect(await store.art.get('a_hero000001')).toEqual(sampleArt());
    expect(await store.steps.forWorld(world.id)).toEqual([world.head]);
    expect(await store.steps.get(world.head)).toEqual(sampleStep(world));
    const ref = await store.blobs.put(flat);
    expect((await store.blobs.get(ref))?.size).toBe(3);
  });

  it('writes nothing when any part of a commit fails', async () => {
    const store = await make();
    const world = sampleWorld();
    const broken = { ...sampleStep(world), id: undefined } as unknown as StepSnapshot;
    const blob = new Blob([bytes(9, 9, 9)]);
    await expect(store.commit({ blobs: [blob], worlds: [world], art: [sampleArt()], steps: [broken] })).rejects.toThrow();
    expect(await store.worlds.get(world.id)).toBeNull();
    expect(await store.worlds.list()).toEqual([]);
    expect(await store.art.get('a_hero000001')).toBeNull();
    const ref = `sha256:${'0'.repeat(64)}` as const;
    expect(await store.blobs.get(ref)).toBeNull();
    // The store still works afterwards.
    await store.commit({ worlds: [world] });
    expect(await store.worlds.get(world.id)).toEqual(world);
  });

  it('stores each blob once, by content', async () => {
    const store = await make();
    const a = await store.blobs.put(new Blob([bytes(1, 2)], { type: 'image/png' }));
    const b = await store.blobs.put(new Blob([bytes(1, 2)], { type: 'image/png' }));
    const c = await store.blobs.put(new Blob([bytes(2, 1)], { type: 'image/png' }));
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(await store.blobs.get(REF_A)).toBeNull();
  });

  it('keeps Lost and found: put away, restore, purge', async () => {
    const store = await make();
    const world = sampleWorld();
    await store.commit({ worlds: [world], steps: [sampleStep(world)] });
    await store.worlds.putAway(world.id);
    expect((await store.worlds.list())[0].putAwayAt).toBeTypeOf('number');
    await store.commit({ worlds: [{ ...world, title: 'Still away' }] });
    expect((await store.worlds.list())[0]).toMatchObject({ title: 'Still away', putAwayAt: expect.any(Number) });
    await store.worlds.restore(world.id);
    expect((await store.worlds.list())[0].putAwayAt).toBeNull();
    await store.worlds.purge(world.id);
    expect(await store.worlds.list()).toEqual([]);
    expect(await store.worlds.get(world.id)).toBeNull();
    expect(await store.steps.forWorld(world.id)).toEqual([]);
  });

  it('updates a world snapshot without rewriting the world', async () => {
    const store = await make();
    const world = sampleWorld();
    await store.commit({ worlds: [world] });
    await store.commit({ snapshots: { [world.id]: REF_A } });
    expect((await store.worlds.list())[0].snapshot).toBe(REF_A);
    await store.commit({ worlds: [{ ...world, title: 'New name' }] });
    expect((await store.worlds.list())[0]).toMatchObject({ title: 'New name', snapshot: REF_A });
  });

  it('keeps stroke logs in order, per drawing', async () => {
    const store = await make();
    for (let i = 0; i < 12; i++) await store.strokes.append('a_1', bytes(i));
    await store.strokes.append('a_10', bytes(99));
    expect((await store.strokes.read('a_1')).map((c) => c[0])).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect((await store.strokes.read('a_10')).map((c) => c[0])).toEqual([99]);
    await store.strokes.clear('a_1');
    expect(await store.strokes.read('a_1')).toEqual([]);
    expect(await store.strokes.read('a_10')).toHaveLength(1);
  });

  it('round-trips drafts and clears them in a commit', async () => {
    const store = await make();
    const draft = sampleDraft();
    await store.drafts.put(draft);
    const back = await store.drafts.get(draft.artId);
    expect(back).toMatchObject({ artId: draft.artId, doc: draft.doc, tool: 'ink' });
    expect(back?.cels.l1.size).toBe(3);
    await store.commit({ clearDrafts: [draft.artId] });
    expect(await store.drafts.get(draft.artId)).toBeNull();
  });

  it('keeps the last 50 AI log entries, newest first', async () => {
    const store = await make();
    for (let i = 0; i < 55; i++) await store.ailog.add(sampleLog({ id: `l_${i}`, at: i }));
    const log = await store.ailog.list();
    expect(log).toHaveLength(50);
    expect(log[0].id).toBe('l_54');
    expect(log.at(-1)?.id).toBe('l_5');
    await store.ailog.clear();
    expect(await store.ailog.list()).toEqual([]);
  });

  it('stores settings and cache values', async () => {
    const store = await make();
    expect(await store.settings.get('prefs')).toBeNull();
    await store.settings.put('prefs', samplePrefs());
    await store.settings.put('classLink', sampleClassLink());
    expect(await store.settings.get('prefs')).toEqual(samplePrefs());
    await store.settings.remove('classLink');
    expect(await store.settings.get('classLink')).toBeNull();
    await store.cache.put('strip:x:y', { frames: 8 });
    expect(await store.cache.get('strip:x:y')).toEqual({ frames: 8 });
  });

  it('tells listeners what changed', async () => {
    const store = await make();
    const events: StoreChange[] = [];
    const stop = store.onChange((e) => events.push(e));
    const world = sampleWorld();
    await store.commit({ worlds: [world], art: [sampleArt()] });
    await store.worlds.putAway(world.id);
    await store.art.remove('a_hero000001');
    stop();
    await store.worlds.restore(world.id);
    expect(events).toEqual([{ worlds: [world.id], art: ['a_hero000001'] }, { worlds: [world.id] }, { art: ['a_hero000001'] }]);
  });

  it('lists shelf drawings', async () => {
    const store = await make();
    await store.commit({ art: [sampleArt(), sampleArt({ id: 'a_other00001', shelf: false })] });
    expect((await store.art.list({ shelf: true })).map((a) => a.id)).toEqual(['a_hero000001']);
    expect(await store.art.list()).toHaveLength(2);
  });
});

describe('the amble database', () => {
  it('has the eleven stores of §4.3', async () => {
    const db = await openAmbleDb(new IDBFactory());
    expect([...db.objectStoreNames].sort()).toEqual([...STORE_NAMES].sort());
    expect(STORE_NAMES).toHaveLength(11);
    db.close();
  });

  it('opens IndexedDB, or keeps work in memory when it is blocked', async () => {
    expect((await openStore({ factory: new IDBFactory() })).mode).toBe('idb');
    expect((await openStore({ factory: null })).mode).toBe('memory');
    const broken = { open: () => { throw new DOMException('blocked', 'SecurityError'); } } as unknown as IDBFactory;
    const warn = console.warn;
    console.warn = () => undefined;
    try {
      expect((await openStore({ factory: broken })).mode).toBe('memory');
    } finally {
      console.warn = warn;
    }
  });
});
