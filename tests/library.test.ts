import { describe, expect, it } from 'vitest';
import { BACKDROP_LIBRARY, SPRITE_LIBRARY, libraryCostumes } from '../src/project/library';

const decode = (dataUrl: string) => {
  const [head, body] = dataUrl.split(',');
  if (!head.endsWith(';base64')) return decodeURIComponent(body);
  return new TextDecoder().decode(Uint8Array.from(atob(body), (ch) => ch.charCodeAt(0)));
};

describe('built-in libraries', () => {
  it('offers Amble first, then simple sprites, each with a description', () => {
    expect(SPRITE_LIBRARY[0].name).toBe('Amble');
    expect(SPRITE_LIBRARY.length).toBeGreaterThanOrEqual(8);
    for (const s of SPRITE_LIBRARY) {
      expect(s.description.length).toBeGreaterThan(5);
      expect(s.costumes().length).toBeGreaterThan(0);
    }
    expect(new Set(SPRITE_LIBRARY.map((s) => s.name)).size).toBe(SPRITE_LIBRARY.length);
  });

  it('makes fresh, valid SVG costumes every time', () => {
    const a = libraryCostumes();
    const b = libraryCostumes();
    expect(a.map((c) => c.name)).toEqual(b.map((c) => c.name));
    expect(new Set([...a, ...b].map((c) => c.id)).size).toBe(a.length * 2);
    for (const c of a) {
      expect(c.kind).toBe('image');
      expect(c.mime).toBe('image/svg+xml');
      expect(c.width).toBeGreaterThan(0);
      expect(decode(c.dataUrl)).toMatch(/^<svg [^>]*width="\d+" height="\d+"[\s\S]*<\/svg>$/);
    }
  });

  it('has stage-sized backdrops', () => {
    expect(BACKDROP_LIBRARY.length).toBeGreaterThanOrEqual(5);
    for (const b of BACKDROP_LIBRARY) {
      const img = b.make();
      expect([img.width, img.height, img.centerX, img.centerY]).toEqual([480, 360, 240, 180]);
      expect(img.name).toBe(b.name);
      expect(decode(img.dataUrl)).toContain('viewBox="0 0 480 360"');
    }
  });
});
