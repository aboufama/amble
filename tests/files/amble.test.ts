/**
 * The `.amble` file (§4.6): a world round-trips with identical JSON and identical blob hashes, and never
 * carries stroke logs, drafts or settings; importing gives fresh ids with every reference moved along.
 */
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { collectDrawing, collectWorld, packAmble, readAmble, withNewIds } from '../../src/files/amble';
import { createFiles } from '../../src/files/service';
import { createHistory } from '../../src/history/api';
import { isBlobRef } from '../../src/model/ids';
import type { AmbleFile, BlobRef } from '../../src/model/types';
import { createStarterCatalog } from '../../src/starters/api';
import type { Store } from '../../src/store/api';
import { openAmbleDb } from '../../src/store/idb';
import { IdbStore } from '../../src/store/idbStore';
import { MemoryStore } from '../../src/store/memory';
import { contains, seedWorld } from './fixtures';

const IMPLS: Array<[string, () => Promise<Store>]> = [
  ['IndexedDB', async () => new IdbStore(await openAmbleDb(new IDBFactory()))],
  ['memory', async () => new MemoryStore()],
];

async function bytes(b: Blob): Promise<Uint8Array> {
  return new Uint8Array(await b.arrayBuffer());
}

describe.each(IMPLS)('.amble files over the %s store', (_name, make) => {
  it('round-trips a world: identical JSON, identical blob hashes, the last footsteps', async () => {
    const store = await make();
    const seed = await seedWorld(store);
    const file = await packAmble(await collectWorld(store, seed.world, 'world'));
    expect(file.type).toBe('application/x-amble');
    const back = await readAmble(file);
    expect(back.warnings).toEqual([]);
    expect(back.manifest).toMatchObject({ format: 'amble-file', version: 2, kind: 'world', title: 'Moon King', thumb: 'thumb.png', assignmentId: null });
    expect(back.world).toEqual(seed.world);
    expect(back.art.sort((a, b) => a.id.localeCompare(b.id))).toEqual([...seed.art].sort((a, b) => a.id.localeCompare(b.id)));
    expect(back.steps).toEqual(seed.steps);
    expect(back.thumb).not.toBeNull();
    // Every blob the world, its drawings and its footsteps need, with the same hash and the same bytes.
    const wanted = [...seed.blobs.keys()].filter((r) => r !== seed.snapshot);
    expect([...back.blobs.keys()].sort()).toEqual(wanted.sort());
    for (const ref of wanted) expect(await bytes(back.blobs.get(ref)!)).toEqual(await bytes(seed.blobs.get(ref)!));
  });

  it('never carries stroke logs, drafts, settings or class codes', async () => {
    const store = await make();
    const seed = await seedWorld(store);
    const zipped = await bytes(await packAmble(await collectWorld(store, seed.world, 'world')));
    const names = Object.keys(unzipSync(zipped));
    expect(names.every((n) => /^(manifest\.json|world\.json|thumb\.png|art\/[^/]+\.json|steps\/[^/]+\.json|blobs\/[0-9a-f]{64}\.(png|wav|webm|json))$/.test(n))).toBe(true);
    expect(names.some((n) => /stroke|draft|setting|ailog/i.test(n))).toBe(false);
    const all = unzipSync(zipped);
    for (const data of Object.values(all)) {
      expect(contains(data, seed.secrets.stroke)).toBe(false);
      expect(contains(data, await bytes(seed.secrets.draftCel))).toBe(false);
      expect(contains(data, new TextEncoder().encode(seed.secrets.classCode))).toBe(false);
    }
  });

  it('opens a file as a new world with fresh ids, its footsteps and its snapshot', async () => {
    const store = await make();
    const seed = await seedWorld(store);
    const blob = await packAmble(await collectWorld(store, seed.world, 'world'));
    const target = await make();
    const files = createFiles({ store: () => target, history: () => createHistory(), starters: () => createStarterCatalog() });
    const f = await files.read(blob);
    const id = await files.importWorld(f, { asCopy: false, fileName: 'Moon King.amble' });
    const again = await files.importWorld(await files.read(blob), { asCopy: false });
    expect(id).not.toBe(seed.world.id);
    expect(again).not.toBe(id);
    const world = (await target.worlds.get(id))!;
    expect(world.title).toBe('Moon King');
    expect(world.steps.at(-1)).toMatchObject({ kind: 'import', by: 'student', text: 'You opened Moon King.amble.' });
    const heroId = world.cast.hero.art!;
    expect(heroId).not.toBe('a_hero000001');
    const hero = (await target.art.get(heroId))!;
    expect(hero.name).toBe('Blorp');
    expect(await target.blobs.get(hero.export!.flat)).not.toBeNull();
    const stepIds = await target.steps.forWorld(id);
    expect(stepIds).toHaveLength(2);
    for (const sid of stepIds) {
      const snap = (await target.steps.get(sid))!;
      expect(snap.worldId).toBe(id);
      expect(world.steps.some((s) => s.id === sid)).toBe(true);
      for (const artId of Object.keys(snap.art)) expect(artId.startsWith('a_') && artId !== 'a_hero000001' && artId !== 'a_king000001').toBe(true);
    }
    const meta = (await target.worlds.list()).find((m) => m.id === id)!;
    expect(meta.snapshot && isBlobRef(meta.snapshot)).toBe(true);
    // The second copy did not overwrite the first one's footsteps.
    expect(await target.steps.forWorld(again)).toHaveLength(2);
    expect(await target.steps.forWorld(id)).toHaveLength(2);
  });

  it('writes a drawing file and opens it onto the Trail', async () => {
    const store = await make();
    const seed = await seedWorld(store);
    const blob = await packAmble(await collectDrawing(store, seed.art[0].id));
    const f = await readAmble(blob);
    expect(f.manifest.kind).toBe('drawing');
    expect(f.world).toBeNull();
    expect(f.art).toHaveLength(1);
    const target = await make();
    const files = createFiles({ store: () => target, history: () => null, starters: () => createStarterCatalog() });
    const [id] = await files.importDrawing(f);
    const rec = (await target.art.get(id))!;
    expect(rec).toMatchObject({ name: 'Blorp', shelf: true });
    expect((await target.art.list({ shelf: true })).map((a) => a.id)).toContain(id);
  });

  it('makes an assignment file and opens it as the student\'s own copy', async () => {
    const store = await make();
    const seed = await seedWorld(store);
    const assignment = { id: 'g_boss000001', title: 'Boss Battle Week', text: 'Make a boss fight.', starter: 'moon-king' as const, require: ['hero'], goals: [], ai: 'on' as const, level: null, due: 'Friday', locked: {} };
    const world = { ...seed.world, assignment, credits: { madeBy: 'Ms. B' }, handIn: { fileName: 'x.amble', savedAt: 1, method: 'download' as const, turnedInAt: 2 } };
    const f = await readAmble(await packAmble(await collectWorld(store, world, 'assignment')));
    expect(f.manifest).toMatchObject({ kind: 'assignment', assignmentId: 'g_boss000001' });
    expect(f.steps).toEqual([]);
    const target = await make();
    const files = createFiles({ store: () => target, history: () => null, starters: () => createStarterCatalog() });
    const id = await files.importWorld(f, { asCopy: true });
    const mine = (await target.worlds.get(id))!;
    expect(mine.origin).toEqual({ kind: 'assignment', assignmentId: 'g_boss000001', starter: 'moon-king' });
    expect(mine.handIn).toEqual({ fileName: null, savedAt: null, method: null, turnedInAt: null });
    expect(mine.credits.madeBy).toBe('');
  });
});

describe('fresh ids', () => {
  it('moves every reference between the world, its drawings and its footsteps', async () => {
    const store = new MemoryStore();
    const seed = await seedWorld(store);
    const f = (await readAmble(await packAmble(await collectWorld(store, seed.world, 'world')))) as AmbleFile;
    const next = withNewIds(f, 5);
    const world = next.world!;
    const ids = new Set(next.art.map((a) => a.id));
    for (const slot of Object.values(world.cast)) if (slot.art) expect(ids.has(slot.art)).toBe(true);
    expect(world.steps.map((s) => s.id)).toEqual(next.steps.map((s) => s.id));
    expect(world.head).toBe(world.steps.at(-1)!.id);
    expect(world.openedAt).toBe(5);
    const mapped = new Set(next.artIds.values());
    for (const s of next.steps) {
      expect(s.worldId).toBe(world.id);
      for (const slot of Object.values(s.cast)) if (slot.art) expect(mapped.has(slot.art)).toBe(true);
      for (const artId of Object.keys(s.art)) expect(mapped.has(artId)).toBe(true);
    }
    const refs: BlobRef[] = next.art.flatMap((a) => [a.doc, ...a.cels]);
    expect(refs.every(isBlobRef)).toBe(true);
  });
});
