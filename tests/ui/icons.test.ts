/**
 * The icon set (§3.5): exactly the spec's icons minus the sparkle (MAGIC-BRIEF: the AI is never
 * decorated), each drawable on the 24 px grid. Names are the spec's in camelCase (`eye-off` is `eyeOff`).
 */
import { describe, expect, it } from 'vitest';
import { ICONS, RETIRED_ICONS } from '../../src/ui/icons/paths';

const SPEC = [
  'back', 'play', 'change', 'pause', 'restart', 'fullscreen', 'draw', 'ink', 'pencil', 'marker', 'crayon', 'airbrush', 'eraser', 'fill',
  'lasso', 'shapes', 'mirror', 'trace', 'undo', 'redo', 'bones', 'star', 'footprint', 'dial', 'twist', 'eye', 'eye-off', 'plus',
  'close', 'check', 'more', 'file-open', 'file-save', 'drive', 'hand-in', 'sound', 'mic', 'captions', 'lock', 'info', 'warning', 'teacher',
  'settings', 'list', 'trail', 'zoom-in', 'zoom-out', 'pivot', 'layer', 'frame', 'read-aloud',
];

describe('icons (§3.5)', () => {
  it('has exactly the 51 icons of the set, and no sparkle', () => {
    expect(SPEC).toHaveLength(51);
    const camel = SPEC.map((n) => n.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase()));
    expect(Object.keys(ICONS).sort()).toEqual(camel.sort());
    expect(ICONS).not.toHaveProperty('sparkle');
    // The retired name still compiles for screens not yet updated, but it is not drawable.
    for (const name of RETIRED_ICONS) expect(ICONS).not.toHaveProperty(name);
  });

  it('draws every icon with SVG path data inside the 24 px grid', () => {
    for (const [name, icon] of Object.entries(ICONS)) {
      const { paths, dots = [] } = icon as { paths: string[]; dots?: Array<[number, number, number]> };
      expect(paths.length + dots.length, name).toBeGreaterThan(0);
      for (const d of paths) {
        expect(d, name).toMatch(/^[Mm][\d\s.,\-a-zA-Z]+$/);
        // Absolute moves stay on the grid.
        for (const m of d.matchAll(/M(-?[\d.]+)[ ,](-?[\d.]+)/g)) {
          for (const v of [Number(m[1]), Number(m[2])]) {
            expect(v, `${name}: ${d}`).toBeGreaterThanOrEqual(0);
            expect(v, `${name}: ${d}`).toBeLessThanOrEqual(24);
          }
        }
        // No float noise ("2.8000000000000003").
        expect(d, name).not.toMatch(/\d\.\d{4,}/);
      }
      for (const [cx, cy, r] of dots) {
        expect(cx - r, name).toBeGreaterThanOrEqual(0);
        expect(cy + r, name).toBeLessThanOrEqual(24);
      }
    }
  });
});
