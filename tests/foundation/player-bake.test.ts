/**
 * PlayerHost's bakes (src/app/player/bake.ts): drawings with bones reach games bound by the rig worker,
 * with the bones scaled to the image the game decodes (as the runtime scales them), part layers included.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RigData } from '../../src/cores/rig';

const bake = vi.fn(async (_src: unknown, _rig: RigData) => new ArrayBuffer(16));
vi.mock('../../src/cores/rig', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../src/cores/rig')>()), rigWorker: { bake } }));

const { withBake, withBakes } = await import('../../src/app/player/bake');

/** The first 24 bytes of a PNG of this size (all that is read for its size). */
function pngOf(w: number, h: number): Blob {
  const head = new Uint8Array(24);
  const dv = new DataView(head.buffer);
  dv.setUint32(0, 0x89504e47);
  dv.setUint32(4, 0x0d0a1a0a);
  dv.setUint32(8, 13);
  dv.setUint32(12, 0x49484452);
  dv.setUint32(16, w);
  dv.setUint32(20, h);
  return new Blob([head], { type: 'image/png' });
}

const RIG: RigData = {
  format: 'amble-rig',
  v: 1,
  kind: 'blob',
  facing: 1,
  anchor: [50, 100],
  bones: [{ name: 'body', role: 'body', parent: -1, x: 50, y: 100, x2: 50, y2: 20 }],
  artHash: '100x100:0000000000000000',
  made: 'auto',
} as RigData;

afterEach(() => bake.mockClear());

describe('PlayerHost bakes', () => {
  it('binds a drawing with bones in the rig worker, the bones fitted to the image the game decodes', async () => {
    const image = pngOf(200, 200);
    const head = pngOf(200, 200);
    const out = await withBake({ key: 'hero', image, rig: RIG, layers: { 'part:head': head } });
    expect(out.bake).toBeInstanceOf(ArrayBuffer);
    expect(bake).toHaveBeenCalledTimes(1);
    const [src, rig] = bake.mock.calls[0] as [{ image: Blob; layers?: Record<string, Blob> }, RigData];
    expect(src.image).toBe(image);
    expect(src.layers).toEqual({ 'part:head': head });
    // a 2x image: the bones scale with it
    expect(rig.anchor).toEqual([100, 200]);
    expect([rig.bones[0].x2, rig.bones[0].y2]).toEqual([100, 40]);
  });

  it('leaves drawings without bones, already baked, or with broken bones as they are', async () => {
    const plain = { key: 'coin', image: pngOf(40, 40) };
    expect(await withBake(plain)).toBe(plain);
    const baked = { key: 'hero', image: pngOf(100, 100), rig: RIG, bake: new ArrayBuffer(8) };
    expect(await withBake(baked)).toBe(baked);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const broken = { key: 'boss', image: pngOf(100, 100), rig: { nope: true } };
    expect(await withBake(broken)).toBe(broken);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
    expect(bake).not.toHaveBeenCalled();
  });

  it('bakes every drawing of a game, keeping their order', async () => {
    const art = await withBakes([
      { key: 'hero', image: pngOf(100, 100), rig: RIG },
      { key: 'coin', image: pngOf(40, 40) },
    ]);
    expect(art.map((a) => [a.key, !!a.bake])).toEqual([
      ['hero', true],
      ['coin', false],
    ]);
  });
});
