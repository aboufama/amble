/** Every swatch on the Desk's colour panel has a name of its own (a screen reader lists them all). */
import { describe, expect, it } from 'vitest';
import { colorId } from '../../src/draw/colorNames';
import { KID_SWATCHES, SKIN_TONES, uniqueSwatchNames, type SwatchWords } from '../../src/draw/palette';

const WORDS: SwatchWords = {
  lighter: (n) => `${n}, lighter`,
  darker: (n) => `${n}, darker`,
  nth: (n, k) => `${n} ${k}`,
  inGroup: (n, g) => `${n}, ${g}`,
};

describe('uniqueSwatchNames', () => {
  it('tells apart two colours of one row that share a name, light to dark', () => {
    // Two greys that both read as "Pebble grey".
    const [row] = uniqueSwatchNames([{ group: 'world', colors: ['#8a8698', '#94909f'] }], colorId, WORDS);
    expect(colorId('#8a8698')).toBe('pebbleGrey');
    expect(colorId('#94909f')).toBe('pebbleGrey');
    expect(row).toEqual(['pebbleGrey, darker', 'pebbleGrey, lighter']);
  });

  it("numbers three or more, and adds the row's word when another row has the name", () => {
    const names = uniqueSwatchNames(
      [
        { group: 'box', colors: ['#8e8aa0'] },
        { group: 'world', colors: ['#8a8698', '#94909f', '#908ca2'] },
      ],
      colorId,
      WORDS,
    );
    expect(names[0]).toEqual(['pebbleGrey']);
    expect(new Set(names[1]).size).toBe(3);
    for (const n of names[1]) expect(n).toMatch(/^pebbleGrey \d$/);
  });

  it('gives the whole panel (box, skin tones, world, recent) no name twice', () => {
    const world = ['#1f1a52', '#e8b98a', '#3f2a6b', '#3f6fd6', '#8a8698', '#6b4226', '#ff9ec7', '#94909f', '#43306f'];
    const recent = ['#221b2e', '#8a5530', '#fde0c5'];
    const all = uniqueSwatchNames(
      [
        { group: 'box', colors: KID_SWATCHES },
        { group: 'skin', colors: SKIN_TONES },
        { group: 'world', colors: world },
        { group: 'recent', colors: recent },
      ],
      colorId,
      WORDS,
    ).flat();
    expect(new Set(all).size).toBe(all.length);
    // The same colour in the box and the skin tones: plain in the box, with its row's word after.
    expect(all).toContain('chocolate');
    expect(all).toContain('chocolate, skin');
  });
});
