import { describe, expect, it } from 'vitest';
import { bindKey, BIND_VERSION, hashPixels, hashRig } from '../../src/rig/hash';
import { cloneRig, normalizeKind, parseRig, RigFormatError, serializeRig, tryParseRig } from '../../src/rig/format';
import { geodesic } from '../../src/rig/imgproc';
import type { RigData } from '../../src/rig/types';
import { rigged } from './helpers';

const tiny = (): RigData => ({
  format: 'amble-rig', v: 1, kind: 'blob', facing: 0, anchor: [50, 100], artHash: '100x100:0123456789abcdef', made: 'auto',
  bones: [
    { name: 'body', role: 'body', parent: -1, x: 50, y: 99, x2: 50, y2: 50 },
    { name: 'top', role: 'top', parent: 0, x: 50, y: 50, x2: 50, y2: 5 },
  ],
});

describe('rig format', () => {
  it('round-trips through JSON', () => {
    const rig = rigged('dog').rig;
    const back = parseRig(serializeRig(rig));
    expect(back.bones.map((b) => b.name)).toEqual(rig.bones.map((b) => b.name));
    back.bones.forEach((b, i) => {
      expect(b.x).toBeCloseTo(rig.bones[i].x, 1);
      expect(b.parent).toBe(rig.bones[i].parent);
      expect(!!b.dynamic).toBe(!!rig.bones[i].dynamic);
    });
    expect(parseRig(back)).toEqual(back);
  }, 60_000);

  it('keeps unknown fields and turns unknown roles into extras', () => {
    const raw = { ...tiny(), future: { x: 1 }, bones: [...tiny().bones, { name: 'fin', role: 'finL1', parent: 0, x: 1, y: 2, x2: 3, y2: 4, sparkle: true }] };
    const rig = parseRig(raw) as RigData & { future?: unknown };
    expect(rig.future).toEqual({ x: 1 });
    expect(rig.bones[2].role).toBe('extra');
    expect((rig.bones[2] as unknown as { sparkle: boolean }).sparkle).toBe(true);
  });

  it('throws a readable RigFormatError on bad input', () => {
    expect(() => parseRig('{nope')).toThrow(RigFormatError);
    expect(() => parseRig({ ...tiny(), format: 'other' })).toThrow(/Amble rig/);
    expect(() => parseRig({ ...tiny(), bones: [{ ...tiny().bones[1], parent: 5 }] })).toThrow(RigFormatError);
    expect(() => parseRig({ ...tiny(), bones: [tiny().bones[0], { ...tiny().bones[1], name: 'body' }] })).toThrow(/twice/);
    const r = tryParseRig(null);
    expect(r.ok).toBe(false);
    expect(tryParseRig(tiny()).ok).toBe(true);
  });

  it('knows the other names for kinds', () => {
    expect(normalizeKind('snake')).toBe('swimmer');
    expect(normalizeKind('none')).toBe('object');
    expect(normalizeKind('Person')).toBe('biped');
    expect(normalizeKind('toaster')).toBeNull();
  });

  it('clones deeply', () => {
    const a = tiny();
    const b = cloneRig(a);
    b.bones[0].x = 1;
    expect(a.bones[0].x).toBe(50);
  });
});

describe('hashes', () => {
  it('hash every pixel, and see no difference between transparent colours', () => {
    const a = { data: new Uint8ClampedArray(16 * 16 * 4), width: 16, height: 16 };
    const b = { data: new Uint8ClampedArray(16 * 16 * 4).fill(255), width: 16, height: 16 };
    for (let i = 3; i < b.data.length; i += 4) b.data[i] = 0;
    expect(hashPixels(a)).toBe(hashPixels(b));
    const c = { data: new Uint8ClampedArray(a.data), width: 16, height: 16 };
    c.data[4 * 200 + 3] = 1;
    expect(hashPixels(c)).not.toBe(hashPixels(a));
    expect(hashPixels(a)).toMatch(/^16x16:[0-9a-f]{16}$/);
  });

  it('change with the bones but not with facing, springs, tweaks or authorship', () => {
    const r = tiny();
    const h = hashRig(r);
    expect(hashRig({ ...r, facing: 1, made: 'hand', anims: { walk: { speed: 2 } } })).toBe(h);
    expect(hashRig({ ...r, bones: [r.bones[0], { ...r.bones[1], x2: 60 }] })).not.toBe(h);
    expect(hashRig({ ...r, bones: [r.bones[0], { ...r.bones[1], rigid: true }] })).not.toBe(h);
    expect(bindKey(r, 'L')).toBe(`${r.artHash}|${h}|L|b${BIND_VERSION}`);
  });
});

describe('geodesic distances', () => {
  it('stay exact along long paths (Float64, strict relaxation)', () => {
    // a 1-pixel corridor 4000 long: in Float32 the sums stop being exact long before the end
    const w = 4000, h = 3;
    const m = new Uint8Array(w * h);
    for (let x = 0; x < w; x++) m[w + x] = 1;
    const d = geodesic(m, w, h, [w], {});
    expect(d[w + w - 1]).toBe(w - 1);
    expect(d[w + 2345]).toBe(2345);
    // offsets start seeds ahead
    const owner = new Int32Array(w * h).fill(-1);
    geodesic(m, w, h, [w, w + w - 1], { offsets: [0, -100], seedLabels: [0, 1], owner });
    expect(owner[w + 1949]).toBe(0);
    expect(owner[w + 1951]).toBe(1);
  });
});
