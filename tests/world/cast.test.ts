/** The Cast (§2.6, §4.2): statuses, order, spares, resting members and the "4 of 6 drawn" count. */
import { describe, expect, it } from 'vitest';
import { EMPTY_MANIFEST, type ArtNeed } from '../../src/cores/play';
import type { CastSlot, World } from '../../src/model/types';
import { castProgress, deriveCast, nameFromKey, nextNeeded } from '../../src/world/cast';
import { planSize, warmupCode } from '../../src/world/warmup';
import { kitManifest, sourceFilesOf, validateGame } from '../../src/cores/ai';
import { samplePlan, sampleWorld } from '../foundation/samples';

function need(key: string, over: Partial<ArtNeed> = {}): ArtNeed {
  return {
    key, name: nameFromKey(key), kind: 'character', rig: 'biped', role: 'enemy', shape: 'capsule', w: 40, h: 64, color: '#f08aa2', ask: '', about: '',
    pronoun: 'them', facing: 'right', priority: 10, required: true, spare: false, declared: true, used: true, drawn: false, ...over,
  };
}

function slot(key: string, over: Partial<CastSlot> = {}): CastSlot {
  return { key, art: null, madeBy: null, extra: null, laterUntil: 0, ...over };
}

function world(cast: CastSlot[]): World {
  return sampleWorld({ cast: Object.fromEntries(cast.map((c) => [c.key, c])) });
}

describe('deriveCast', () => {
  it('merges the game art needs with the world slots', () => {
    const w = world([slot('hero', { art: 'a_hero000001' }), slot('moonKing'), slot('pal', { extra: { name: 'Pal', role: 'npc', kind: 'character', rig: 'biped', note: '' } })]);
    const cast = deriveCast({ ...EMPTY_MANIFEST, art: [need('hero', { role: 'hero', priority: 1 }), need('moonKing', { role: 'boss', priority: 2 }), need('star', { required: false })] }, w);
    expect(Object.fromEntries(cast.map((c) => [c.key, c.status]))).toEqual({ hero: 'drawn', moonKing: 'needed', star: 'optional', pal: 'resting' });
  });

  it('orders by priority, then role, with resting members last', () => {
    const w = world([slot('old', { art: 'a_old0000001' })]);
    const cast = deriveCast(
      {
        ...EMPTY_MANIFEST,
        art: [need('coin', { role: 'item', priority: 10 }), need('grumble', { role: 'enemy', priority: 10 }), need('boss', { role: 'boss', priority: 2 }), need('hero', { role: 'hero', priority: 1 })],
      },
      w,
    );
    expect(cast.map((c) => c.key)).toEqual(['hero', 'boss', 'grumble', 'coin', 'old']);
  });

  it("marks the game's and the starter's spare members, and keeps a drawn spare drawn", () => {
    const w = world([slot('bubbles'), slot('kite', { art: 'a_kite000001' })]);
    const cast = deriveCast({ ...EMPTY_MANIFEST, art: [need('bubbles'), need('kite'), need('helper', { spare: true })] }, w, { starter: { spare: ['bubbles', 'kite'], yourTurn: null } });
    expect(Object.fromEntries(cast.map((c) => [c.key, [c.status, c.required]]))).toEqual({ bubbles: ['spare', false], kite: ['drawn', false], helper: ['spare', false] });
  });

  it('shows only certain facts before the game reports its needs', () => {
    const w = world([slot('hero', { art: 'a_hero000001' }), slot('boss'), slot('pal', { extra: { name: 'Pal', role: 'npc', kind: 'character', rig: 'biped', note: '' } })]);
    const cast = deriveCast(null, w);
    expect(Object.fromEntries(cast.map((c) => [c.key, c.status]))).toEqual({ hero: 'drawn', pal: 'resting' });
  });

  it('takes live counts from the objects report', () => {
    const cast = deriveCast({ ...EMPTY_MANIFEST, art: [need('grumble')] }, world([]), { counts: { grumble: 3 } });
    expect(cast[0].count).toBe(3);
  });

  it('counts "4 of 6 drawn" over the members the game plays', () => {
    const w = world([slot('a', { art: 'a_a000000001' }), slot('b', { art: 'a_b000000001' })]);
    const cast = deriveCast({ ...EMPTY_MANIFEST, art: [need('a'), need('b'), need('c'), need('d', { required: false }), need('e', { spare: true })] }, w);
    expect(castProgress(cast)).toEqual({ drawn: 2, total: 4, allRequired: false });
    expect(nextNeeded(cast)?.key).toBe('c');
    const done = deriveCast({ ...EMPTY_MANIFEST, art: [need('a'), need('b'), need('d', { required: false })] }, w);
    expect(castProgress(done).allRequired).toBe(true);
    expect(nextNeeded(done)).toBeNull();
  });

  it('names members the code never named', () => {
    expect(nameFromKey('moonKing')).toBe('Moon king');
    expect(nameFromKey('star_shard')).toBe('Star shard');
  });
});

describe('warmupCode', () => {
  it('is a valid kit game with the plan cast declared', () => {
    const code = warmupCode(samplePlan());
    expect(code.map((f) => f.path)).toEqual(['game.js']);
    expect(code[0].source.startsWith('// Warm-up:')).toBe(true);
    const result = validateGame(sourceFilesOf(code), { manifest: kitManifest(), fix: false });
    expect(result.errors).toEqual([]);
    expect(result.art.declared.sort()).toEqual(['hero', 'saltKing']);
  });

  it('sizes plan members relative to the hero', () => {
    expect(planSize({ size: 'hero' })).toEqual({ w: 40, h: 64 });
    expect(planSize({ size: 'huge' })).toEqual({ w: 140, h: 224 });
    expect(planSize({ size: 'screen' })).toEqual({ w: 960, h: 540 });
  });

  it('sizes things without bones by their kind, as the build is told (§5.4)', () => {
    expect(planSize({ size: 'small', kind: 'terrain' })).toEqual({ w: 32, h: 32 });
    expect(planSize({ size: 'small', kind: 'item' })).toEqual({ w: 28, h: 28 });
    expect(planSize({ size: 'tiny', kind: 'projectile' })).toEqual({ w: 16, h: 16 });
    expect(planSize({ size: 'huge', kind: 'background' })).toEqual({ w: 960, h: 540 });
    const plan = samplePlan();
    const item = { ...plan.cast[0], key: 'leaf', kind: 'item' as const, rig: 'none' as const, role: 'item' as const, size: 'small' as const, required: false };
    expect(warmupCode({ ...plan, cast: [...plan.cast, item] })[0].source).toMatch(/leaf: \{ kind: "item", [^}]*w: 28, h: 28,/);
  });
});
