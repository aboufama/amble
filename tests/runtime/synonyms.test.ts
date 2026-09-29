import { describe, expect, it } from 'vitest';
import { editDistance, forgiving, guessSound, resolveClip, suggest } from '../../src/play/kit/synonyms';
import { SOUND_NAMES, parseRecipe } from '../../src/runtime/kit/sounds';
import { isTwistId, TWISTS } from '../../src/play/kit/twistCatalog';

describe('forgiving names', () => {
  it('resolves clip names models invent', () => {
    expect(resolveClip('walk')).toBe('walk');
    expect(resolveClip('victory')).toBe('cheer');
    expect(resolveClip('ko')).toBe('die');
    expect(resolveClip('Wave')).toBe('cheer');
    expect(resolveClip('backflip')).toBeNull();
  });

  it('suggests the closest real name', () => {
    expect(editDistance('shake', 'shaek')).toBe(2);
    expect(suggest('shak', ['shake', 'flash', 'burst'])).toBe('shake');
    expect(suggest('spawnHeroo', ['spawnHero', 'spawnEnemy'])).toBe('spawnHero');
    expect(suggest('xyzzy', ['shake', 'flash'])).toBeNull();
  });

  it('turns unknown namespace calls into warned no-ops and resolves synonyms', () => {
    const calls: string[] = [];
    const warnings: string[] = [];
    const fx = forgiving({ shake: (n: number) => calls.push(`shake ${n}`), flash: () => calls.push('flash') }, 'fx', (m) => warnings.push(m));
    const loose = fx as unknown as Record<string, (...a: unknown[]) => unknown>;
    loose.screenShake(0.02);
    loose.screenShake(0.03);
    expect(calls).toEqual(['shake 0.02', 'shake 0.03']);
    expect(warnings).toEqual(['this.fx.screenShake is called this.fx.shake']);
    expect(loose.sparkleMagic()).toBeUndefined();
    expect(warnings[1]).toMatch(/sparkleMagic\(\) does not exist/);
    // Promise-like probes and JSON must not be faked.
    expect((fx as unknown as { then?: unknown }).then).toBeUndefined();
  });

  it('maps sound names to kit sounds', () => {
    expect(guessSound('explode', SOUND_NAMES)).toBe('explosion');
    expect(guessSound('coin.wav', SOUND_NAMES)).toBe('coin');
    expect(guessSound('gameover', SOUND_NAMES)).toBe('lose');
    expect(guessSound('qwerty', SOUND_NAMES)).toBe('pop');
  });

  it('accepts a game sound recipe and repairs what it can', () => {
    expect(parseRecipe([{ wave: 'sine', startFreq: 440, duration: 0.2 }])).toEqual([{ wave: 'sine', startFreq: 440, endFreq: 440, duration: 0.2, startVolume: 0.6, endVolume: 0 }]);
    expect(parseRecipe({ caption: '[beep]', segments: [{ wave: 'kazoo' }] })?.[0].wave).toBe('square');
    expect(parseRecipe([])).toBeNull();
    expect(parseRecipe('beep')).toBeNull();
  });

  it('knows the twists', () => {
    expect(TWISTS.length).toBe(13);
    expect(isTwistId('moonGravity')).toBe(true);
    expect(isTwistId('rm -rf')).toBe(false);
    expect(new Set(TWISTS.map((t) => t.id)).size).toBe(TWISTS.length);
  });
});
