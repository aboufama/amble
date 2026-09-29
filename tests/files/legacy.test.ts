/**
 * The old-Amble rescue (§4.7): the old autosave in the old `keyval-store` database comes in as a Parade
 * world titled "{title} (old)" with its drawings and sounds; blocks, AI art and 3D models stay behind;
 * the old key is never changed; `settings.legacy` remembers the answer, so the card never comes back.
 */
import 'fake-indexeddb/auto';
import { get, set } from 'idb-keyval';
import { describe, expect, it } from 'vitest';
import { bringLegacy, castKeyFrom, dismissLegacy, findLegacy, legacyFromFileText } from '../../src/files/legacy';
import { dataUrlBytes, encodeWav, type PictureMaker, type SoundMaker } from '../../src/files/media';
import { createHistoryStub } from '../../src/history/api';
import { LEGACY_AUTOSAVE_KEY } from '../../src/legacy/reader';
import type { LegacyProject } from '../../src/legacy/types';
import { createStarterStub } from '../../src/starters/api';
import { MemoryStore } from '../../src/store/memory';
import { base64, png } from './fixtures';

async function pngUrl(tag: number): Promise<string> {
  return `data:image/png;base64,${base64(new Uint8Array(await png(tag).arrayBuffer()))}`;
}

function wavUrl(level: number): string {
  return `data:audio/wav;base64,${base64(encodeWav(new Float32Array(64).fill(level), 22050))}`;
}

async function oldProject(): Promise<LegacyProject> {
  const image = async (name: string, tag: number, extra: Record<string, unknown> = {}) => ({
    id: `a-${name}`,
    name,
    kind: 'image' as const,
    dataUrl: await pngUrl(tag),
    mime: 'image/png',
    width: 96,
    height: 106,
    resolution: 2,
    centerX: 48,
    centerY: 58,
    ...extra,
  });
  const sound = (name: string) => ({ id: `s-${name}`, name, kind: 'sound' as const, dataUrl: wavUrl(name.length / 20), mime: 'audio/wav', duration: 0.5 });
  const sprite = (name: string, costumes: unknown[], sounds: unknown[] = []) => ({
    id: `t-${name}`,
    kind: 'sprite' as const,
    name,
    description: '',
    costumes,
    sounds,
    currentCostume: 0,
    blocks: { blocks: { blocks: [{ type: 'ev_start' }] } },
    x: 0,
    y: 0,
    z: 0,
    size: 100,
    direction: 0,
    visible: true,
    rotationStyle: 'left-right' as const,
  });
  return {
    format: 'amble',
    version: 1,
    id: 'p-1',
    title: 'Cat Quest',
    notes: 'A cat collects coins.',
    mode: '2d',
    stage: { id: 't-stage', kind: 'stage', name: 'Stage', description: '', costumes: [await image('night sky', 9, { width: 960, height: 720 })], sounds: [sound('music')], currentCostume: 0, blocks: null },
    sprites: [
      sprite('Cat', [await image('cat walk', 1), await image('cat jump', 2)], [sound('meow')]),
      sprite('Rocket', [{ id: 'a-rocket', name: 'rocket', kind: 'model', dataUrl: 'data:model/gltf-binary;base64,Z2xURg' }]),
    ],
    compiled: { assets: [{ kind: 'image', dataUrl: await pngUrl(77), name: 'boss' }] },
  } as unknown as LegacyProject;
}

/** Pictures without a canvas: the bytes become the board, the flat, the thumb and the sticker. */
const pictures: PictureMaker = {
  async prepare(bytes, _mime, o) {
    const b = new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'image/png' });
    const w = o.width ?? 1;
    const h = o.height ?? 1;
    return { board: { png: b, w, h }, flat: { png: b, w, h, x: 0, y: 0 }, pixels: { data: new Uint8ClampedArray(w * h * 4).fill(255), width: w, height: h }, thumb: b, sticker: b };
  },
};

const sounds: SoundMaker = {
  async toKept(bytes) {
    return { bytes, mime: 'audio/wav', duration: 0.5 };
  },
};

describe('the old Amble rescue', () => {
  it('brings drawings and sounds into a new world and never touches the old save', async () => {
    const project = await oldProject();
    await set(LEGACY_AUTOSAVE_KEY, project);
    const before = structuredClone(await get(LEGACY_AUTOSAVE_KEY));
    const store = new MemoryStore();
    const found = await findLegacy({ store });
    expect(found?.title).toBe('Cat Quest');
    expect(found?.drawings.map((d) => d.name)).toEqual(['cat walk', 'cat jump', 'night sky']);
    const r = await bringLegacy({ store, starters: createStarterStub(), history: createHistoryStub(), pictures, sounds }, found!);
    expect(r).toMatchObject({ title: 'Cat Quest (old)', drawings: 3, sounds: 2 });
    const world = (await store.worlds.get(r.worldId))!;
    expect(world.title).toBe('Cat Quest (old)');
    expect(world.origin).toEqual({ kind: 'import-v1', title: 'Cat Quest' });
    expect(world.steps.at(-1)).toMatchObject({ kind: 'import', text: 'You brought in drawings from the old Amble.' });
    const art = await store.art.list();
    expect(art).toHaveLength(3);
    expect(art.every((a) => a.madeBy === 'import')).toBe(true);
    const sky = art.find((a) => a.name === 'night sky')!;
    expect(sky).toMatchObject({ kind: 'background', rig: 'none', shelf: false, rigData: null });
    const cats = art.filter((a) => a.kind === 'character');
    expect(cats.every((a) => a.rig === 'blob' && a.shelf && a.rigData?.kind === 'blob')).toBe(true);
    // Every drawing is in the world's cast; the first costume is the hero.
    const inCast = Object.values(world.cast).flatMap((s) => (s.art ? [s.art] : []));
    expect(new Set(inCast)).toEqual(new Set(art.map((a) => a.id)));
    expect(world.cast.hero.art).toBe(cats.find((a) => a.name === 'cat walk')!.id);
    // Sounds are recordings with captions.
    expect(Object.values(world.sounds).map((s) => s.name).sort()).toEqual(['meow', 'music']);
    for (const s of Object.values(world.sounds)) {
      expect(s.source.kind).toBe('recording');
      if (s.source.kind === 'recording') expect(await store.blobs.get(s.source.blob)).not.toBeNull();
    }
    // Remembered; the old key is exactly as it was.
    expect(await store.settings.get('legacy')).toMatchObject({ choice: 'brought', hash: expect.stringMatching(/^[0-9a-f]{64}$/) });
    expect(await findLegacy({ store })).toBeNull();
    expect(await get(LEGACY_AUTOSAVE_KEY)).toEqual(before);
  });

  it('never asks again after Not now', async () => {
    const project = await oldProject();
    const read = async () => project;
    const store = new MemoryStore();
    const found = await findLegacy({ store, read });
    expect(found).not.toBeNull();
    await dismissLegacy({ store }, found);
    expect(await store.settings.get('legacy')).toMatchObject({ choice: 'dismissed' });
    expect(await findLegacy({ store, read })).toBeNull();
  });

  it('reads an old .amble JSON file the same way', async () => {
    const project = await oldProject();
    const l = legacyFromFileText(JSON.stringify(project));
    expect(l?.drawings).toHaveLength(3);
    expect(legacyFromFileText('{"format":"amble-file"}')).toBeNull();
    expect(legacyFromFileText('nope')).toBeNull();
  });

  it('makes cast keys from names and data URLs into bytes without the network', () => {
    const taken = new Set<string>(['hero']);
    expect(castKeyFrom('Cat cat walk', taken)).toBe('catCatWalk');
    expect(castKeyFrom('Cat cat walk', taken)).toBe('catCatWalk2');
    expect(castKeyFrom('123 !!', taken)).toBe('drawing');
    expect(castKeyFrom('hero', taken)).toBe('hero2');
    expect(dataUrlBytes('data:text/plain,hi%20there').bytes).toEqual(new TextEncoder().encode('hi there'));
    expect(dataUrlBytes('data:image/png;base64,AAEC')).toEqual({ bytes: new Uint8Array([0, 1, 2]), mime: 'image/png' });
  });
});
