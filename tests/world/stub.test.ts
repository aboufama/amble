/** M2's starting point (FOUNDATION-STUB test; M2 replaces it): the Warm-up game and the Cast. */
import { describe, expect, it } from 'vitest';
import { sourceFilesOf, validateGame, kitManifest } from '../../src/cores/ai';
import { EMPTY_MANIFEST, type ArtNeed } from '../../src/cores/play';
import { deriveCast } from '../../src/world/cast';
import { planSize, warmupCode } from '../../src/world/warmup';
import { samplePlan, sampleWorld } from '../foundation/samples';

describe('world (stub)', () => {
  it('warmupCode(plan) is a valid kit game with the plan cast declared', () => {
    const code = warmupCode(samplePlan());
    expect(code.map((f) => f.path)).toEqual(['game.js']);
    const result = validateGame(sourceFilesOf(code), { manifest: kitManifest(), fix: false });
    expect(result.errors).toEqual([]);
    expect(result.art.declared.sort()).toEqual(['hero', 'saltKing']);
  });

  it('sizes plan members relative to the hero', () => {
    expect(planSize({ size: 'hero' })).toEqual({ w: 40, h: 64 });
    expect(planSize({ size: 'screen' })).toEqual({ w: 960, h: 540 });
  });

  it('deriveCast merges the game art needs with the world slots', () => {
    const need = (key: string, required: boolean): ArtNeed => ({
      key, name: key, kind: 'character', rig: 'biped', role: 'hero', shape: 'capsule', w: 40, h: 64, color: '#7cc7ef', ask: '', about: '',
      pronoun: 'them', facing: 'right', priority: 1, required, spare: false, declared: true, used: true, drawn: false,
    });
    const cast = deriveCast({ ...EMPTY_MANIFEST, art: [need('hero', true), need('moonKing', true), need('star', false)] }, sampleWorld());
    expect(Object.fromEntries(cast.map((c) => [c.key, c.status]))).toEqual({ hero: 'drawn', moonKing: 'needed', star: 'optional', pal: 'resting' });
  });
});
