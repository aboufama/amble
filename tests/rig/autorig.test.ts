import { describe, expect, it } from 'vitest';
import { autoRig, confidenceOf } from '../../src/rig/autorig';
import { analyze } from '../../src/rig/analyze';
import { checkTruth, missingExpected } from '../../src/rig/samples/truth';
import type { CharacterKind, LayerPixels } from '../../src/rig/types';
import { rigged, sample, SAMPLE_NAMES } from './helpers';

describe('auto-rig on the sample drawings', () => {
  for (const name of SAMPLE_NAMES) {
    it(`${name}: every joint lands within tolerance`, () => {
      const s = sample(name);
      const r = rigged(name);
      const misses = checkTruth(r.rig, s).filter((c) => !c.ok).map((c) => `${c.truth.bone}.${c.truth.end} off by ${c.err.toFixed(1)}`);
      expect(misses).toEqual([]);
      expect(missingExpected(r.rig, s)).toEqual([]);
      expect(r.rig.kind).toBe(s.kind);
      expect(r.rig.format).toBe('amble-rig');
      expect(r.rig.made).toBe('auto');
      expect(r.rig.artHash).toMatch(/^\d+x\d+:[0-9a-f]{16}$/);
      // parents come first
      r.rig.bones.forEach((b, i) => expect(b.parent).toBeLessThan(i));
    }, 60_000);
  }

  it('uses the kind it is given, never a guess', () => {
    const s = sample('dog');
    const r = autoRig(s, 'biped');
    expect(r.rig.kind).toBe('biped');
    for (const kind of ['blob', 'object', 'swimmer'] as CharacterKind[]) expect(autoRig(s, kind).rig.kind).toBe(kind);
  }, 60_000);

  it('the boots that almost touch still get two legs (adaptive working size)', () => {
    const r = rigged('closeLegs');
    expect(r.rig.bones.some((b) => b.role === 'legL2')).toBe(true);
    expect(r.rig.bones.some((b) => b.role === 'legR2')).toBe(true);
    expect(r.workSize).toBe(240);
  }, 60_000);

  it('the raised arm holding a wand keeps the wand as a stiff bit in the hand', () => {
    const r = rigged('wand');
    const wand = r.rig.bones.find((b) => b.rigid);
    expect(wand).toBeTruthy();
    expect(r.rig.bones[wand!.parent].role).toMatch(/^arm[LR]2$/);
  }, 60_000);

  it('navy trousers are not ink: the Lines layer is the ink, and without it dark fills are not taken', () => {
    const s = sample('navy');
    const lines = s.layers.lines;
    expect(lines).toBeTruthy();
    const a = analyze(s, { workSize: 150 });
    // every ink pixel lies on a drawn line
    let off = 0, total = 0;
    for (let y = 0; y < a.h; y++) for (let x = 0; x < a.w; x++) {
      if (!a.ink[y * a.w + x]) continue;
      total++;
      const ax = Math.round((x - a.pad) / a.scale), ay = Math.round((y - a.pad) / a.scale);
      let near = false;
      for (let dy = -3; dy <= 3 && !near; dy++) for (let dx = -3; dx <= 3 && !near; dx++) {
        const px = ax + dx, py = ay + dy;
        if (px >= 0 && py >= 0 && px < lines.width && py < lines.height && lines.data[(py * lines.width + px) * 4 + 3] > 64) near = true;
      }
      if (!near) off++;
    }
    expect(total).toBeGreaterThan(100);
    expect(off / total).toBeLessThan(0.02);
    // a flat import with no layers still rigs: thick dark fills aren't lines
    const flat = autoRig({ image: s.image }, 'biped');
    expect(checkTruth(flat.rig, s).every((c) => c.ok)).toBe(true);
  }, 60_000);

  it('a ground shadow painted on the shading layer never becomes part of the body', () => {
    const s = sample('hero');
    const W = s.image.width, H = s.image.height;
    // a wide shadow under the feet, in the flat image and on the shading layer
    const image = { data: new Uint8ClampedArray(s.image.data), width: W, height: H };
    const shading: LayerPixels = { data: new Uint8ClampedArray(W * H * 4), width: W, height: H };
    const colors: LayerPixels = { data: new Uint8ClampedArray(s.image.data), width: W, height: H };
    for (let y = H - 14; y < H; y++) for (let x = 10; x < W - 10; x++) {
      const o = (y * W + x) * 4;
      if (image.data[o + 3] > 0) continue;
      image.data.set([90, 90, 110, 200], o);
      shading.data.set([90, 90, 110, 200], o);
    }
    const plain = analyze({ image }, { workSize: 150 });
    const aware = analyze({ image, layers: { lines: s.layers.lines, colors, shading } }, { workSize: 150 });
    const count = (m: Uint8Array) => m.reduce((acc, v) => acc + v, 0);
    expect(count(aware.solid)).toBeLessThan(count(plain.solid));
    expect(count(aware.solid)).toBe(count(analyze({ image: s.image, layers: { lines: s.layers.lines } }, { workSize: 150 }).solid));
  }, 60_000);

  it('shading and sketch layers never change the bones', () => {
    const s = sample('hero');
    const noise: LayerPixels = { data: new Uint8ClampedArray(s.image.width * s.image.height * 4), width: s.image.width, height: s.image.height };
    for (let i = 0; i < noise.data.length; i += 4) {
      noise.data[i + 3] = (i / 4) % 7 === 0 ? 255 : 0;
    }
    const a = autoRig({ image: s.image, layers: { ...s.layers } }, 'biped');
    const b = autoRig({ image: s.image, layers: { ...s.layers, shading: noise, sketch: noise } }, 'biped');
    expect(b.rig.bones).toEqual(a.rig.bones);
  }, 60_000);

  it('confidence is 1 for a clean fit and drops below 0.6 for missing limbs', () => {
    expect(rigged('hero').confidence).toBe(1);
    expect(confidenceOf([])).toBe(1);
    expect(confidenceOf(['legs-merged'])).toBeLessThan(0.6);
    expect(confidenceOf(['no-arms'])).toBeLessThan(0.6);
    expect(confidenceOf(['no-tail'])).toBeGreaterThan(0.9);
  }, 60_000);

  it('drawn in parts, each part layer becomes a part', () => {
    const r = rigged('layered');
    expect(r.rig.parts?.map((p) => p.layer).filter(Boolean).length).toBeGreaterThanOrEqual(6);
    expect(r.rig.parts?.find((p) => p.name === 'armL')?.bones).toEqual(['armL1', 'armL2']);
  }, 60_000);
});

describe('joint hints', () => {
  it('hints near the joints snap to the drawing', () => {
    const s = sample('hero');
    const truth = rigged('hero').rig;
    const armL1 = truth.bones.find((b) => b.role === 'armL1')!;
    const armL2 = truth.bones.find((b) => b.role === 'armL2')!;
    const r = autoRig(s, 'biped', {
      hints: { armL1: [armL1.x + 6, armL1.y - 4], armL2: [armL2.x - 5, armL2.y + 6] },
      tipHints: { armL2: [armL2.x2 + 4, armL2.y2 + 3] },
    });
    const b = r.rig.bones.find((x) => x.role === 'armL2')!;
    expect(Math.hypot(b.x2 - armL2.x2, b.y2 - armL2.y2)).toBeLessThan(12);
    expect(r.issues).not.toContain('hint-dropped');
  }, 60_000);

  it("a hinted limb that doesn't match the drawing is dropped (vision) or kept (guide)", () => {
    const s = sample('slime');
    // a biped's arm where the slime has nothing
    const far = { armL1: [10, 10] as [number, number], armL2: [5, 40] as [number, number] };
    const tips = { armL2: [2, 70] as [number, number] };
    const dropped = autoRig(s, 'biped', { hints: far, tipHints: tips, unsnapped: 'drop' });
    expect(dropped.issues).toContain('hint-dropped');
    expect(dropped.confidence).toBeLessThan(1);
    const kept = autoRig(s, 'biped', { hints: far, tipHints: tips, unsnapped: 'keep' });
    const arm = kept.rig.bones.find((b) => b.role === 'armL2');
    expect(arm).toBeTruthy();
    expect(Math.hypot(arm!.x2 - 2, arm!.y2 - 70)).toBeLessThan(3);
  }, 60_000);
});
