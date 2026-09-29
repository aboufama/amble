/**
 * Store upkeep (§4.3, §4.4): the blob GC keeps every referenced blob (from metas, worlds, drawings,
 * footsteps, drafts and the cache) and anything younger than a day; write health turns a quota error
 * into `library.storage = 'full'`; a connection the browser closed reopens by itself; stroke logs keep
 * their order across page loads; drafts list what was never committed; Lost and found expires.
 */
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { dailyTidy, purgeExpired, watchHealth } from '../../src/files/upkeep';
import { blobRefOf } from '../../src/model/ids';
import type { BlobRef, World } from '../../src/model/types';
import { setServices, type Services } from '../../src/app/services';
import { resetState, getState, setState } from '../../src/state/store';
import { upkeepOf, type Store, type StoreUpkeep } from '../../src/store/api';
import { GC_LAST_KEY } from '../../src/store/gc';
import { openAmbleDb } from '../../src/store/idb';
import { IdbStore } from '../../src/store/idbStore';
import { MemoryStore } from '../../src/store/memory';
import { isQuotaError } from '../../src/store/quota';
import { docBlob, png, seedWorld } from '../files/fixtures';
import { sampleWorld } from '../foundation/samples';

const DAY = 24 * 60 * 60 * 1000;

const IMPLS: Array<[string, () => Promise<Store & StoreUpkeep>]> = [
  ['IndexedDB', async () => new IdbStore(await openAmbleDb(new IDBFactory()))],
  ['memory', async () => new MemoryStore()],
];

afterEach(() => {
  resetState();
  vi.restoreAllMocks();
});

describe.each(IMPLS)('%s store upkeep', (_name, make) => {
  it('collects only blobs nobody references, and never a young one', async () => {
    const store = await make();
    const seed = await seedWorld(store);
    // Referenced only from a draft's doc JSON and from the cache.
    const draftCel = png(7001);
    const cached = png(7002);
    const [draftRef, cacheRef] = await Promise.all([store.blobs.put(draftCel), store.blobs.put(cached)]);
    await store.drafts.put({ artId: 'a_other00001', worldId: null, castKey: null, doc: await docBlob([draftRef]).text(), cels: {}, tool: 'ink', at: 1 });
    await store.cache.put('strip:x:y', { frames: 8, sheet: cacheRef });
    const orphan = await store.blobs.put(png(7003));

    const report = await store.collectGarbage({ now: Date.now() + 2 * DAY });
    expect(report.removed).toBe(1);
    expect(await store.blobs.get(orphan)).toBeNull();
    for (const ref of [...seed.blobs.keys(), draftRef, cacheRef]) expect(await store.blobs.get(ref), ref).not.toBeNull();

    const young = await store.blobs.put(png(7004));
    const again = await store.collectGarbage();
    expect(again.removed).toBe(0);
    expect(await store.blobs.get(young)).not.toBeNull();
  });

  it('keeps the snapshot a Trail sign shows, and a footstep\'s old drawing', async () => {
    const store = await make();
    const seed = await seedWorld(store);
    await store.collectGarbage({ now: Date.now() + 2 * DAY });
    expect(await store.blobs.get(seed.snapshot)).not.toBeNull();
    const old = seed.steps[1].art.a_hero000001;
    expect(await store.blobs.get(old.doc)).not.toBeNull();
    expect(await store.blobs.get(old.export!.flat)).not.toBeNull();
  });

  it('lists drafts newest first, and forgets kept file handles', async () => {
    const store = await make();
    await store.drafts.put({ artId: 'a_1', worldId: 'w_1', castKey: 'hero', doc: '{}', cels: {}, tool: 'ink', at: 10 });
    await store.drafts.put({ artId: 'a_2', worldId: null, castKey: null, doc: '{}', cels: {}, tool: 'ink', at: 20 });
    expect(await store.drafts.list()).toEqual([
      { artId: 'a_2', worldId: null, castKey: null, at: 20 },
      { artId: 'a_1', worldId: 'w_1', castKey: 'hero', at: 10 },
    ]);
    const handle = { kind: 'file', name: 'x.amble' } as unknown as FileSystemFileHandle;
    await store.handles.put('w_1', handle);
    expect((await store.handles.all()).map((h) => h.worldId)).toEqual(['w_1']);
    await store.handles.remove('w_1');
    expect(await store.handles.get('w_1')).toBeNull();
  });

  it('measures blobs and deletes everything on request', async () => {
    const store = await make();
    const seed = await seedWorld(store);
    const refs = [...seed.blobs.keys()].slice(0, 3);
    let expected = 0;
    for (const r of refs) expected += seed.blobs.get(r)!.size;
    expect(await store.blobBytes([...refs, ...refs])).toBe(expected);
    await store.wipe();
    expect(await store.worlds.list()).toEqual([]);
    expect(await store.art.list()).toEqual([]);
    expect(await store.blobs.get(refs[0])).toBeNull();
    expect(await store.settings.get('classLink')).toBeNull();
    expect(await store.strokes.read('a_hero000001')).toEqual([]);
  });

  it('purges Lost and found after 30 days, once a day with the GC', async () => {
    const store = await make();
    const w = sampleWorld();
    await store.commit({ worlds: [w, { ...w, id: 'w_keep000001' }] });
    await store.worlds.putAway(w.id);
    expect(await purgeExpired(store, Date.now() + 29 * DAY)).toBe(0);
    expect(await purgeExpired(store, Date.now() + 31 * DAY)).toBe(1);
    expect((await store.worlds.list()).map((m) => m.id)).toEqual(['w_keep000001']);
    if (store.mode === 'idb') {
      expect(await dailyTidy(store, Date.now())).toBe(true);
      expect(await store.cache.get(GC_LAST_KEY)).toBeTypeOf('number');
      expect(await dailyTidy(store, Date.now() + 1000)).toBe(false);
      expect(await dailyTidy(store, Date.now() + DAY + 1000)).toBe(true);
    }
  });
});

describe('the IndexedDB store', () => {
  it('turns a quota error into storage: full, and back to ok when writes land again', async () => {
    const store = new IdbStore(await openAmbleDb(new IDBFactory()));
    watchHealth(store);
    const put = IDBObjectStore.prototype.put;
    const spy = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, ...args: Parameters<IDBObjectStore['put']>) {
      if (this.name === 'worlds') throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
      return put.apply(this, args);
    });
    const err = await store.commit({ worlds: [sampleWorld()] }).catch((e: unknown) => e);
    expect(isQuotaError(err)).toBe(true);
    expect(store.health()).toBe('full');
    expect(getState().library.storage).toBe('full');
    expect(getState().app.toasts.map((t) => t.text)).toContain(
      "Amble can't save on this Chromebook right now. It's out of space. Save to Drive now, then delete old worlds in Settings.",
    );
    expect(await store.worlds.list()).toEqual([]);
    spy.mockRestore();
    await store.commit({ worlds: [sampleWorld()] });
    expect(store.health()).toBe('ok');
    expect(getState().library.storage).toBe('ok');
  });

  it("saves the open world's newest copy to Drive from the out-of-space toast", async () => {
    const store = new IdbStore(await openAmbleDb(new IDBFactory()));
    const saved: World[] = [];
    setServices({
      store,
      files: {
        saveWorld: async (w: World) => {
          saved.push(w);
          return { name: 'Moon King.amble', at: 1, method: 'download' };
        },
      },
    } as unknown as Services);
    const before = sampleWorld();
    await store.commit({ worlds: [before] });
    // The student keeps working; the store fills up, so these changes live only in the session.
    setState((s) => {
      s.session.world = { ...before, title: 'Moon King 2', updatedAt: before.updatedAt + 60_000 };
    });
    watchHealth(store);
    const put = IDBObjectStore.prototype.put;
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, ...args: Parameters<IDBObjectStore['put']>) {
      if (this.name === 'worlds') throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
      return put.apply(this, args);
    });
    await store.commit({ worlds: [getState().session.world!] }).catch(() => undefined);
    const toast = getState().app.toasts.find((t) => t.action);
    toast?.action?.run();
    await vi.waitFor(() => expect(saved).toHaveLength(1));
    expect(saved[0].title).toBe('Moon King 2');
  });

  it('reopens a connection the browser closed', async () => {
    const factory = new IDBFactory();
    const db = await openAmbleDb(factory);
    const store = new IdbStore(db, () => openAmbleDb(factory));
    await store.commit({ worlds: [sampleWorld()] });
    db.close();
    await store.commit({ worlds: [sampleWorld({ title: 'After' })] });
    expect((await store.worlds.list())[0].title).toBe('After');
  });

  it('keeps a stroke log in order across page loads', async () => {
    const factory = new IDBFactory();
    const first = new IdbStore(await openAmbleDb(factory));
    for (let i = 0; i < 3; i++) await first.strokes.append('a_1', new Uint8Array([i]));
    first.close();
    const second = new IdbStore(await openAmbleDb(factory));
    await Promise.all([second.strokes.append('a_1', new Uint8Array([3])), second.strokes.append('a_1', new Uint8Array([4]))]);
    expect((await second.strokes.read('a_1')).map((c) => c[0])).toEqual([0, 1, 2, 3, 4]);
  });

  it('writes a snapshot ref only when its world exists', async () => {
    const store = new IdbStore(await openAmbleDb(new IDBFactory()));
    const ref: BlobRef = await blobRefOf(png(1));
    await store.commit({ snapshots: { w_nothere0001: ref } });
    expect(await store.worlds.list()).toEqual([]);
    expect(upkeepOf(store)).toBe(store);
  });
});
