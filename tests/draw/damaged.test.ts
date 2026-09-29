/**
 * A drawing whose saved file can't be read (§4.4, "nothing is ever lost"). It opens as a blank sheet that says
 * so, never as a new drawing under the same id: the Desk keeps the new drawing in its draft, the damaged record
 * (and the drawing the game plays, its export) stay until Bring to life replaces them.
 */
import { describe, expect, it } from 'vitest';
import { newArtDoc } from '../../src/cores/art';
import { checkpointDrawing, DamagedDrawing, openDrawing, saveDrawing } from '../../src/draw/drafts';
import { loadFreeDesk, loadRequestDesk } from '../../src/draw/load';
import { blobRefOf } from '../../src/model/ids';
import type { ArtRecord, World } from '../../src/model/types';
import { MemoryStore } from '../../src/store/memory';
import { sampleArt, sampleWorld } from '../foundation/samples';

const ART = 'a_hero000001';

/** A world whose hero plays a drawing whose file is missing (`sampleArt` points at a blob that isn't stored). */
async function damagedWorld(over: Partial<ArtRecord> = {}): Promise<{ store: MemoryStore; world: World; record: ArtRecord }> {
  const store = new MemoryStore();
  const game = "class Game extends Amble.Scene {\n  static art = { hero: { kind: 'character', rig: 'biped', role: 'hero' } };\n}";
  const world = sampleWorld({ id: 'w_damaged001', code: [{ path: 'game.js', source: game, authors: [['starter', 3]], locked: [] }] });
  const record = sampleArt({ id: ART, ...over });
  await store.commit({ worlds: [world], art: [record] });
  return { store, world, record };
}

const drawing = () => {
  const doc = newArtDoc({ name: 'Blorp', kind: 'character', rig: 'biped', width: 64, height: 64, layers: 'freehand' });
  doc.cels.push({ frame: doc.frames[0].id, layer: doc.layers[0].id, x: 0, y: 0, w: 1, h: 1, png: new Blob([new Uint8Array([137, 80, 78, 71, 9])], { type: 'image/png' }) });
  return doc;
};

const checkpoint = (store: MemoryStore, record: ArtRecord | null, damaged: boolean) =>
  checkpointDrawing(store, {
    doc: drawing(),
    artId: ART,
    previous: record,
    name: 'Blorp',
    kind: 'character',
    rig: 'biped',
    role: 'hero',
    facing: 'right',
    mode: 'free',
    parts: {},
    shelf: false,
    damaged,
    worldId: 'w_damaged001',
    castKey: 'hero',
    tool: 'ink',
  });

describe('a drawing whose file is damaged', () => {
  it('is not opened as if it were new: its file missing, or not an Amble drawing', async () => {
    const { store } = await damagedWorld();
    await expect(openDrawing(store, ART)).rejects.toBeInstanceOf(DamagedDrawing);
    const junk = new Blob(['{"not":"a drawing"'], { type: 'application/json' });
    const ref = await blobRefOf(junk);
    await store.commit({ blobs: [junk], art: [sampleArt({ id: 'a_junk000001', doc: ref })] });
    const err = await openDrawing(store, 'a_junk000001').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DamagedDrawing);
    expect((err as DamagedDrawing).record.id).toBe('a_junk000001');
    // No record at all is a new drawing, as before.
    expect(await openDrawing(store, 'a_nothing001')).toBeNull();
  });

  it('opens the Desk on a blank sheet that says so, keeping the record the game plays', async () => {
    const { store, world, record } = await damagedWorld();
    const r = await loadRequestDesk(store, world.id, 'hero', []);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.setup.damaged).toBe(true);
    expect(r.setup.artId).toBe(ART);
    expect(r.setup.record).toEqual(record);
    expect(r.setup.doc.cels).toEqual([]);
    expect(r.setup.saved.size).toBe(0);
    expect(r.setup.restored).toBe(false);
  });

  it('keeps the new drawing in its draft, never over the record, until it is brought to life', async () => {
    const { store, world, record } = await damagedWorld();
    expect(await checkpoint(store, record, true)).toBeNull();
    // The record, and the export the game plays, are exactly as they were.
    expect(await store.art.get(ART)).toEqual(record);
    const draft = await store.drafts.get(ART);
    expect(draft?.worldId).toBe(world.id);
    expect(Object.keys(draft?.cels ?? {})).toHaveLength(1);

    // Opened again: the new drawing so far, still marked damaged (so saving still keeps drafts only).
    const again = await loadRequestDesk(store, world.id, 'hero', []);
    expect(again.ok && again.setup.damaged).toBe(true);
    expect(again.ok && again.setup.restored).toBe(true);
    expect(again.ok && again.setup.doc.cels.length).toBe(1);
    expect(await store.art.get(ART)).toEqual(record);

    // Brought to life, it has a file that reads again: no longer damaged.
    await saveDrawing(store, { doc: drawing(), artId: ART, previous: record, name: 'Blorp', kind: 'character', rig: 'biped', role: 'hero', facing: 'right', mode: 'free', parts: {}, shelf: false });
    const healed = await openDrawing(store, ART);
    expect(healed?.damaged).toBeUndefined();
    expect(healed?.record?.export).toEqual(record.export);
  });

  it('saves a readable drawing as before, keeping what games load', async () => {
    const { store, record } = await damagedWorld();
    const saved = await checkpoint(store, record, false);
    expect(saved?.doc).not.toBe(record.doc);
    expect(saved?.export).toEqual(record.export);
    expect(await store.drafts.get(ART)).toBeNull();
  });

  it('opens a damaged free drawing to draw again, instead of sending the student away', async () => {
    const store = new MemoryStore();
    const record = sampleArt({ id: 'a_free000001', shelf: true, board: { w: 512, h: 512, pixelArt: false } });
    await store.commit({ art: [record] });
    const r = await loadFreeDesk(store, record.id);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.setup.damaged).toBe(true);
    expect(r.setup.record).toEqual(record);
    expect([r.setup.board.w, r.setup.board.h]).toEqual([512, 512]);
  });
});
