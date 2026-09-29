/**
 * The Phaser adapter without a binder: drawings arrive with the editor's bake (the player's runtime has no
 * binding code), a bake counts only for the bones it was made for, and a page that must bind by itself
 * loads the binder (the standalone script's global).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { bakeBound } from '../../src/rig/bake';
import { bindRig } from '../../src/rig/bind';
import { moveJoint } from '../../src/rig/editing';
import { BINDER_GLOBAL, boundFor, registerRigBake, registerRigBinder, scaleRigTo } from '../../src/rig/phaser';
import type { BoundRig, Pixels } from '../../src/rig/types';
import { rigged, sample } from './helpers';

/** What the runtime binds: a decoded drawing (here just its size and pixels). */
interface FakeImage {
  width: number;
  height: number;
  pixels: Pixels;
}

const imageOf = (p: Pixels): FakeImage => ({ width: p.width, height: p.height, pixels: p });
const binding = (image: FakeImage, rig: unknown) => ({ key: 'hero', rig, image: image as unknown as HTMLCanvasElement });

/** Node has no canvas: this one hands back the pixels of the image drawn into it (all the adapter reads). */
class FakeCanvas {
  private drawn: FakeImage | null = null;
  constructor(readonly width: number, readonly height: number) {}
  getContext() {
    return {
      drawImage: (img: FakeImage) => {
        this.drawn = img;
      },
      getImageData: (_x: number, _y: number, w: number, h: number) => {
        const data = new Uint8ClampedArray(w * h * 4);
        if (this.drawn) data.set(this.drawn.pixels.data.subarray(0, data.length));
        return { data, width: w, height: h };
      },
    };
  }
}

function sameMesh(a: BoundRig, b: BoundRig): void {
  expect(Array.from(a.rest)).toEqual(Array.from(b.rest));
  expect(Array.from(a.indices)).toEqual(Array.from(b.indices));
  expect(Array.from(a.boneW)).toEqual(Array.from(b.boneW));
  expect(a.partRanges).toEqual(b.partRanges);
}

afterEach(() => {
  registerRigBinder(null);
  delete (globalThis as Record<string, unknown>)[BINDER_GLOBAL];
  delete (globalThis as Record<string, unknown>).OffscreenCanvas;
});

describe('the adapter with baked drawings', () => {
  it("spawns a drawing from its registered bake, with this binding's facing and anchor", () => {
    const s = sample('hero');
    const { rig } = rigged('hero');
    const image = imageOf(s.image);
    const made = bindRig({ image: s.image }, scaleRigTo(rig, image.width, image.height));
    registerRigBake(image, bakeBound(made));
    const turned = { ...rig, facing: -1 as const, anchor: [rig.anchor[0] + 2, rig.anchor[1]] as [number, number] };
    const got = boundFor(binding(image, turned));
    sameMesh(got, made);
    expect(got.rig.facing).toBe(-1);
    expect(got.rig.anchor).toEqual(turned.anchor);
  }, 60_000);

  it("without a bake or a binder, the bones don't load (the kit shows the drawing as one piece)", () => {
    const s = sample('hero');
    expect(() => boundFor(binding(imageOf(s.image), rigged('hero').rig))).toThrow(/not prepared/);
  }, 60_000);

  it('ignores a bake made for other bones, and binds when the page has the binder', () => {
    const s = sample('hero');
    const { rig } = rigged('hero');
    const image = imageOf(s.image);
    const other = moveJoint(rig, rig.bones[1].name, rig.bones[1].x + 6, rig.bones[1].y - 4);
    registerRigBake(image, bakeBound(bindRig({ image: s.image }, other)));
    expect(() => boundFor(binding(image, rig))).toThrow(/not prepared/);

    // The standalone script puts bindRig where the runtime looks for it.
    (globalThis as Record<string, unknown>).OffscreenCanvas = FakeCanvas;
    (globalThis as Record<string, unknown>)[BINDER_GLOBAL] = (input: Parameters<typeof bindRig>[0], r: Parameters<typeof bindRig>[1]) => bindRig(input, r);
    sameMesh(boundFor(binding(image, rig)), bindRig({ image: s.image }, rig));
  }, 60_000);

  it('binds with a registered binder too (harnesses)', () => {
    const s = sample('dog');
    const { rig } = rigged('dog');
    (globalThis as Record<string, unknown>).OffscreenCanvas = FakeCanvas;
    let calls = 0;
    registerRigBinder((input, r) => {
      calls++;
      return bindRig(input, r);
    });
    const image = imageOf(s.image);
    sameMesh(boundFor(binding(image, rig)), bindRig({ image: s.image }, rig));
    // every spawn of the same drawing and bones shares one bind
    boundFor(binding(image, rig));
    expect(calls).toBe(1);
  }, 60_000);
});
