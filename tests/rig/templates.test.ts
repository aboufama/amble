import { describe, expect, it } from 'vitest';
import { autoRig } from '../../src/rig/autorig';
import { parseRig } from '../../src/rig/format';
import { hintsFromVision, visionSilhouette } from '../../src/rig/hints';
import { defaultParts } from '../../src/rig/parts';
import { checkTruth } from '../../src/rig/samples/truth';
import { ghostShapes, partSteps, templateFor, templateHints } from '../../src/rig/templates';
import { CHARACTER_KINDS } from '../../src/rig/types';
import { rigged, sample } from './helpers';

describe('templates', () => {
  it('every kind has a valid skeleton inside its box, standing on the bottom centre', () => {
    for (const kind of CHARACTER_KINDS) {
      const t = templateFor(kind, 120, 200);
      expect(() => parseRig(t)).not.toThrow();
      expect(t.kind).toBe(kind);
      expect(t.anchor).toEqual([60, 200]);
      for (const b of t.bones) for (const [x, y] of [[b.x, b.y], [b.x2, b.y2]]) {
        expect(x).toBeGreaterThanOrEqual(0);
        expect(x).toBeLessThanOrEqual(120);
        expect(y).toBeGreaterThanOrEqual(0);
        expect(y).toBeLessThanOrEqual(200);
      }
      expect(ghostShapes(t)).toHaveLength(t.bones.length);
    }
  });

  it('a person stands in the star pose: arms 30° out, feet apart', () => {
    const t = templateFor('biped', 160, 300);
    const arm = t.bones.find((b) => b.role === 'armL1')!;
    const angle = (Math.atan2(arm.x - arm.x2, arm.y2 - arm.y) * 180) / Math.PI;
    expect(angle).toBeCloseTo(30, 0);
    const fl = t.bones.find((b) => b.role === 'legL2')!, fr = t.bones.find((b) => b.role === 'legR2')!;
    expect(fr.x2 - fl.x2).toBeGreaterThan(0.15 * 300);
    expect(templateFor('dog' as never, 10, 10).kind).toBe('dog');
  });

  it('animals face right unless asked; facing left mirrors them', () => {
    const r = templateFor('quadruped', 200, 120);
    const l = templateFor('quadruped', 200, 120, -1);
    expect(r.facing).toBe(1);
    const head = (t: typeof r) => t.bones.find((b) => b.role === 'head')!;
    expect(head(r).x2).toBeGreaterThan(150);
    expect(head(l).x2).toBeLessThan(50);
  });

  it('drawing on the bones: steps name the parts the binder knows, in draw order', () => {
    for (const kind of CHARACTER_KINDS) {
      const steps = partSteps(kind);
      expect(steps[steps.length - 1].step).toBe('extras');
      const names = steps.flatMap((s) => s.parts.map((p) => p.name));
      const known = defaultParts(templateFor(kind, 100, 100)).map((p) => p.name);
      for (const n of names) expect(known).toContain(n);
    }
    expect(partSteps('biped').map((s) => s.step)).toEqual(['body', 'head', 'arms', 'legs', 'extras']);
  });

  it("a guide pose's joints steer the fit of a drawing made over it", () => {
    const s = sample('hero');
    // the guide was 160 x 300 on the sheet; the drawing's box is the whole image
    const t = templateFor('biped', 160, 300);
    const { joints, tips } = templateHints(t, { x: 0, y: 10, w: s.image.width, h: s.image.height - 10 }, { w: 160, h: 300 });
    const r = autoRig(s, 'biped', { hints: joints, tipHints: tips, unsnapped: 'keep' });
    expect(checkTruth(r.rig, s).filter((c) => !c.ok).length).toBeLessThanOrEqual(1);
  }, 60_000);
});

describe('vision hints', () => {
  it('turn a reply in 0..1000 coordinates into joint hints', () => {
    const h = hintsFromVision({
      kind: 'biped', facing: 'viewer',
      joints: [
        { name: 'pelvis', x: 500, y: 600 }, { name: 'neck', x: 500, y: 300 }, { name: 'head_top', x: 500, y: 20 },
        { name: 'shoulder_l', x: 400, y: 320 }, { name: 'elbow_l', x: 300, y: 450 }, { name: 'hand_l', x: 200, y: 560 },
        { name: 'hip_r', x: 560, y: 640 }, { name: 'knee_r', x: 580, y: 800 }, { name: 'foot_r', x: 600, y: 990 },
        { name: 'tail_tip', x: 5000, y: 10 },
      ],
      extras: [],
    }, 'biped', 200, 400);
    expect(h.hints.hips).toEqual([100, 240]);
    expect(h.hints.spine).toEqual([100, 240]);
    expect(h.hints.head).toEqual([100, 120]);
    expect(h.tipHints.head).toEqual([100, 8]);
    expect(h.hints.armL2).toEqual([60, 180]);
    expect(h.tipHints.armL2).toEqual([40, 224]);
    expect(h.tipHints.legR2).toEqual([120, 396]);
    expect(h.tipHints.tail3![0]).toBe(200);
    expect(h.facing).toBe(0);
    const q = hintsFromVision({ joints: [{ name: 'shoulder_l', x: 100, y: 100 }, { name: 'hip_l', x: 800, y: 100 }] }, 'quadruped', 1000, 1000);
    expect(q.hints.legFL1).toEqual([100, 100]);
    expect(q.hints.legBL1).toEqual([800, 100]);
  });

  it('snap like any hints: a vision reply for the hero fits it', () => {
    const s = sample('hero');
    const rig = rigged('hero').rig;
    const k = (x: number, y: number) => ({ x: (x / s.image.width) * 1000, y: (y / s.image.height) * 1000 });
    const b = (role: string) => rig.bones.find((x) => x.role === role)!;
    const reply = {
      joints: [
        { name: 'shoulder_l', ...k(b('armL1').x + 3, b('armL1').y) }, { name: 'elbow_l', ...k(b('armL2').x, b('armL2').y + 4) },
        { name: 'hand_l', ...k(b('armL2').x2, b('armL2').y2) }, { name: 'foot_r', ...k(b('legR2').x2 - 4, b('legR2').y2) },
      ],
    };
    const h = hintsFromVision(reply, 'biped', s.image.width, s.image.height);
    const r = autoRig(s, 'biped', { hints: h.hints, tipHints: h.tipHints });
    expect(r.issues).not.toContain('hint-dropped');
    expect(checkTruth(r.rig, s).every((c) => c.ok)).toBe(true);
  }, 60_000);

  it('only ever send a black-on-white silhouette, at most 256 px', () => {
    const s = sample('dog');
    const sil = visionSilhouette(s);
    expect(Math.max(sil.width, sil.height)).toBe(256);
    expect(sil.width / sil.height).toBeCloseTo(s.image.width / s.image.height, 1);
    for (let i = 0; i < sil.data.length; i += 4) {
      expect(sil.data[i]).toBe(sil.data[i + 1]);
      expect(sil.data[i + 1]).toBe(sil.data[i + 2]);
      expect(sil.data[i + 3]).toBe(255);
    }
    const corner = sil.data[0];
    expect(corner).toBe(255);
  }, 60_000);
});
