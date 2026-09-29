/**
 * Make a copy (§2.3, §2.6) gives the copy its own drawings: each drawing its cast plays is a new record under a
 * new id, pointing at the same pictures (blobs are content-addressed and never change). Drawing one again in the
 * copy never changes the original's.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { setServices, type Services } from '../../src/app/services';
import { newArtDoc, type ArtExportResult } from '../../src/cores/art';
import { templateFor } from '../../src/cores/rig';
import { bringToLife, type BringDeps } from '../../src/draw/api';
import { createHistory } from '../../src/history/api';
import { copyWorld } from '../../src/home/createWorld';
import type { ArtRecord, World } from '../../src/model/types';
import { saveCopy } from '../../src/screens/world/WorldMenu';
import { resetState } from '../../src/state/store';
import { createStarterCatalog } from '../../src/starters/api';
import { MemoryStore } from '../../src/store/memory';
import { copyDrawings } from '../../src/world/copy';
import { sampleArt, sampleWorld } from '../foundation/samples';

const png = (n: number) => new Blob([new Uint8Array([137, 80, 78, 71, n, n + 1, n + 2])], { type: 'image/png' });

function exported(): ArtExportResult {
  return {
    flat: { png: png(11), w: 200, h: 180 },
    box: [100, 120, 400, 360],
    scale: 0.5,
    anchor: [100, 178],
    anchorBoard: [300, 476],
    layers: [],
    linesMask: null,
    parts: [],
    thumb: { png: png(13), w: 128, h: 115 },
  } as unknown as ArtExportResult;
}

let store: MemoryStore;
let world: World;
let hero: ArtRecord;

beforeEach(async () => {
  resetState();
  store = new MemoryStore();
  setServices({ store, history: createHistory(), starters: createStarterCatalog(), player: null } as unknown as Services);
  hero = sampleArt({ id: 'a_hero000001', shelf: true });
  world = sampleWorld({
    id: 'w_original01',
    cast: {
      hero: { key: 'hero', art: hero.id, madeBy: 'student', extra: null, laterUntil: 0 },
      // The same drawing plays a second member, and one member's drawing is gone.
      pal: { key: 'pal', art: hero.id, madeBy: 'student', extra: null, laterUntil: 0 },
      moonKing: { key: 'moonKing', art: 'a_gone000001', madeBy: 'student', extra: null, laterUntil: 0 },
      orb: { key: 'orb', art: null, madeBy: null, extra: null, laterUntil: 0 },
    },
  });
  await store.commit({ worlds: [world], art: [hero] });
  await store.strokes.append(hero.id, new Uint8Array([1, 2, 3]));
});

describe('copyDrawings', () => {
  it('duplicates each drawing once under a new id, sharing its pictures', async () => {
    const { cast, art, ids } = await copyDrawings(store, world.cast, 5);
    expect(art).toHaveLength(1);
    const copy = art[0];
    expect(copy.id).not.toBe(hero.id);
    expect(copy.id).toMatch(/^a_[0-9a-z]{10}$/);
    expect(ids.get(hero.id)).toBe(copy.id);
    // Same pictures, bones and version; its own id and times, and not on the shelf twice.
    expect({ ...copy, id: hero.id, shelf: true, createdAt: hero.createdAt, updatedAt: hero.updatedAt }).toEqual(hero);
    expect(copy).toMatchObject({ shelf: false, createdAt: 5, updatedAt: 5 });
    expect(cast.hero.art).toBe(copy.id);
    expect(cast.pal.art).toBe(copy.id);
    // A drawing that is gone plays as just bones in the copy (as it does in the original).
    expect(cast.moonKing.art).toBeNull();
    expect(cast.orb).toEqual(world.cast.orb);
  });
});

describe('Make a copy', () => {
  for (const [where, make] of [
    ["from the world's ⋯ menu", () => saveCopy(store, world)],
    ["from the Trail's sign menu", async () => (await copyWorld(world.id))!],
  ] as const) {
    it(`${where}: drawing one again in the copy leaves the original's drawing as it was`, async () => {
      const copy = await make();
      const copyArt = copy.cast.hero.art!;
      expect(copyArt).not.toBe(hero.id);
      expect(await store.art.get(copyArt)).toMatchObject({ doc: hero.doc, export: hero.export });
      expect(await store.strokes.read(copyArt)).toEqual([new Uint8Array([1, 2, 3])]);
      expect((await store.worlds.get(copy.id))?.cast.hero.art).toBe(copyArt);

      // Redraw the hero in the copy (the Desk opens on the copy's slot, so its id).
      const deps: BringDeps = {
        store,
        history: createHistory(),
        player: null,
        rig: async () => ({ rig: templateFor('biped', 200, 180), confidence: 0.9, notes: [], issues: [] }),
        sticker: async () => png(14),
        export: async () => null,
      };
      const doc = newArtDoc({ name: 'Blorp', kind: 'character', rig: 'biped', width: 64, height: 64, layers: 'freehand' });
      const res = await bringToLife(
        { doc, artId: copyArt, name: 'Blorp', kind: 'character', rig: 'biped', mode: 'free', parts: {}, worldId: copy.id, castKey: 'hero', shelf: false, guideHints: null, exported: exported() },
        deps,
      );
      expect(res.record.id).toBe(copyArt);
      expect(res.record.version).toBe(hero.version + 1);
      // The original world and its drawing are untouched.
      expect(await store.art.get(hero.id)).toEqual(hero);
      expect((await store.worlds.get(world.id))?.cast.hero.art).toBe(hero.id);
      expect((await store.art.get(copyArt))?.export?.flat).not.toBe(hero.export?.flat);
    });
  }
});
