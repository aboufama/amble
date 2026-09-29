import { describe, expect, it } from 'vitest';
import { fitModeFor, fitSize } from '../../src/runtime/kit/fit';
import { askOrder, guessFromKey, nameFromKey, normalizeSpec, toArtNeed } from '../../src/runtime/kit/spec';
import { colorInt, cssColor, mix } from '../../src/runtime/kit/color';

describe('art specs', () => {
  it('guesses what a key is', () => {
    expect(guessFromKey('hero')).toMatchObject({ kind: 'character', role: 'hero', rig: 'biped' });
    expect(guessFromKey('dragonBoss')).toMatchObject({ kind: 'character', role: 'boss', rig: 'flyer' });
    expect(guessFromKey('coin')).toMatchObject({ kind: 'item', role: 'item' });
    expect(guessFromKey('lava')).toMatchObject({ role: 'hazard' });
    expect(guessFromKey('nightSky')).toMatchObject({ kind: 'background' });
    expect(nameFromKey('moonKing')).toBe('Moon King');
    expect(nameFromKey('moon_king')).toBe('Moon King');
  });

  it('normalizes whatever a game declared', () => {
    const s = normalizeSpec('boss', { kind: 'character', rig: 'slime', w: 220, h: -3, name: '  The Moon King ', color: '#b69cff' });
    expect(s).toMatchObject({ kind: 'character', rig: 'blob', role: 'boss', w: 220, h: 180, name: 'The Moon King', color: 0xb69cff, declared: true, required: true });
    const item = normalizeSpec('gem', { kind: 'item', rig: 'biped' });
    expect(item.rig).toBe('none');
    expect(item.shape).toBe('diamond');
    const guessed = normalizeSpec('ground');
    expect(guessed).toMatchObject({ kind: 'terrain', shape: 'tile', declared: false, required: false });
    expect(normalizeSpec('x', 'nonsense').kind).toBe('prop');
  });

  it('treats spare art as optional', () => {
    const s = normalizeSpec('pet', { kind: 'character', role: 'npc', spare: true, required: true });
    expect(s.spare).toBe(true);
    expect(s.required).toBe(false);
    expect(toArtNeed(s, { used: false, drawn: false })).toMatchObject({ key: 'pet', spare: true, required: false, color: '#7ddf8c' });
  });

  it('asks for the hero first', () => {
    const specs = [normalizeSpec('coin'), normalizeSpec('boss', { kind: 'character' }), normalizeSpec('hero', { kind: 'character', priority: 1 })];
    expect(specs.sort(askOrder).map((s) => s.key)).toEqual(['hero', 'boss', 'coin']);
  });
});

describe('fitting drawings', () => {
  it('keeps the drawing shape and fills the box by kind', () => {
    expect(fitModeFor('character')).toBe('height');
    expect(fitModeFor('background')).toBe('cover');
    expect(fitModeFor('item')).toBe('contain');
    const near = (a: { w: number; h: number; scale: number }, b: { w: number; h: number; scale: number }) => {
      expect(a.w).toBeCloseTo(b.w);
      expect(a.h).toBeCloseTo(b.h);
      expect(a.scale).toBeCloseTo(b.scale);
    };
    near(fitSize('height', 40, 64, 200, 320), { w: 40, h: 64, scale: 0.2 });
    near(fitSize('contain', 28, 28, 100, 50), { w: 28, h: 14, scale: 0.28 });
    near(fitSize('cover', 960, 540, 480, 480), { w: 960, h: 960, scale: 2 });
    expect(fitSize('contain', 28, 28, 0, 50)).toEqual({ w: 28, h: 28, scale: 1 });
  });
});

describe('colours', () => {
  it('reads every colour form', () => {
    expect(colorInt('#ff00aa')).toBe(0xff00aa);
    expect(colorInt(0x123456)).toBe(0x123456);
    // Colour names are the kit's friendly palette, not CSS's harsh ones.
    expect(colorInt('red')).toBe(0xff4d6d);
    expect(colorInt('#f0a')).toBe(0xff00aa);
    expect(colorInt('rgb(1, 2, 3)')).toBe(0x010203);
    expect(colorInt('not a colour', 0x010203)).toBe(0x010203);
    expect(cssColor(0x0000ff)).toBe('#0000ff');
    expect(mix(0x000000, 0xffffff, 0.5)).toBe(0x808080);
  });
});
