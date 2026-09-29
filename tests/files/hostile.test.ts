/**
 * Hostile `.amble` files (§4.6): a zip whose headers lie about sizes (a zip bomb) never makes Amble hold
 * more than the sizes it checked, and keys that would reach an object's prototype never survive cleaning.
 */
import { strToU8, unzipSync, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { collectWorld, packAmble, readAmble } from '../../src/files/amble';
import { FileProblem } from '../../src/files/problem';
import { cleanArtRecord, cleanWorld } from '../../src/files/validate';
import { LIMITS } from '../../src/model/limits';
import { MemoryStore } from '../../src/store/memory';
import { sampleArt, sampleWorld } from '../foundation/samples';
import { seedWorld } from './fixtures';

const json = (v: unknown) => strToU8(JSON.stringify(v));

/** Rewrites the uncompressed size every central-directory record claims (what the reader checks). */
function claimSize(zip: Uint8Array, size: number): Uint8Array {
  const out = zip.slice();
  const view = new DataView(out.buffer);
  for (let i = 0; i + 46 <= out.length; i++) if (view.getUint32(i, true) === 0x02014b50) view.setUint32(i + 24, size, true);
  return out;
}

describe('a zip bomb', () => {
  it('is refused when its headers say how big it is, before anything is inflated', async () => {
    const small = new Uint8Array(1024);
    const bomb = claimSize(zipSync({ 'manifest.json': json({ format: 'amble-file', version: 2, kind: 'world' }), 'a.bin': small, 'b.bin': small }), 40 * 1024 * 1024);
    expect(bomb.length).toBeLessThan(64 * 1024);
    await expect(readAmble(new Blob([bomb as Uint8Array<ArrayBuffer>]))).rejects.toMatchObject({ kind: 'too-big' });
  });

  it('never grows past the size its headers claim when they lie', async () => {
    const zeros = new Uint8Array(4 * 1024 * 1024);
    const liar = claimSize(zipSync({ 'world.json': zeros }, { level: 1 }), 1000);
    // What the reader relies on: an entry is inflated into a buffer of the size it claims, and no bigger.
    const entries = unzipSync(liar, { filter: (f) => f.originalSize <= LIMITS.ambleFileBytes });
    expect(entries['world.json'].length).toBeLessThanOrEqual(1000);
    await expect(readAmble(new Blob([liar as Uint8Array<ArrayBuffer>]))).rejects.toBeInstanceOf(FileProblem);
  });
});

describe('prototype keys', () => {
  it('never reach a prototype, and the file is cleaned or refused', async () => {
    const store = new MemoryStore();
    const seed = await seedWorld(store);
    const entries = unzipSync(new Uint8Array(await (await packAmble(await collectWorld(store, seed.world, 'world'))).arrayBuffer()));
    const world = JSON.parse(new TextDecoder().decode(entries['world.json'])) as Record<string, unknown>;
    const hostile = JSON.parse(
      JSON.stringify(world).replace('"dials":{', '"dials":{"__proto__":{"polluted":1},"constructor":{"prototype":{"polluted":1}},'),
    ) as Record<string, unknown>;
    hostile.sounds = JSON.parse('{"__proto__":{"name":"x","source":{"kind":"preset","preset":"coin","variation":0},"effects":[],"caption":"","madeBy":"student"}}');
    hostile.gameStorage = JSON.parse('{"__proto__":"x","best":"12"}');
    const f = await readAmble(new Blob([zipSync({ ...entries, 'world.json': json(hostile) }) as Uint8Array<ArrayBuffer>]));
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.getPrototypeOf(f.world!.dials)).toBe(Object.prototype);
    expect(Object.getPrototypeOf(f.world!.sounds)).toBe(Object.prototype);
    expect(Object.keys(f.world!.dials)).not.toContain('__proto__');
    expect(Object.getPrototypeOf(f.world!.gameStorage)).toBe(Object.prototype);

    const cast = JSON.parse(`{"__proto__":${JSON.stringify(sampleWorld().cast.hero)}}`);
    expect(cleanWorld({ ...sampleWorld(), cast })).toBeNull();
    const parts = JSON.parse('{"__proto__":{"lines":"a","colors":"b"}}');
    const art = cleanArtRecord({ ...sampleArt(), parts });
    expect(art === null || Object.getPrototypeOf(art.parts) === Object.prototype).toBe(true);
    expect(({} as Record<string, unknown>).lines).toBeUndefined();
  });
});
