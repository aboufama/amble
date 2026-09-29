/**
 * The icon set (§3.5): exactly the 52 hand-inked icons, each drawable on the 24 px grid. Names are the
 * spec's in camelCase (`eye-off` is `eyeOff`).
 */
import { describe, expect, it } from 'vitest';
import { ICONS } from '../../src/ui/icons/paths';

const SPEC = [
  'back', 'play', 'change', 'pause', 'restart', 'fullscreen', 'draw', 'ink', 'pencil', 'marker', 'crayon', 'airbrush', 'eraser', 'fill',
  'lasso', 'shapes', 'mirror', 'trace', 'undo', 'redo', 'bones', 'star', 'sparkle', 'footprint', 'dial', 'twist', 'eye', 'eye-off', 'plus',
  'close', 'check', 'more', 'file-open', 'file-save', 'drive', 'hand-in', 'sound', 'mic', 'captions', 'lock', 'info', 'warning', 'teacher',
  'settings', 'list', 'trail', 'zoom-in', 'zoom-out', 'pivot', 'layer', 'frame', 'read-aloud',
];

describe('icons (§3.5)', () => {
  it('has exactly the 52 icons of the spec', () => {
    expect(SPEC).toHaveLength(52);
    const camel = SPEC.map((n) => n.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase()));
    expect(Object.keys(ICONS).sort()).toEqual(camel.sort());
  });

  it('draws every icon with SVG path data', () => {
    for (const [name, icon] of Object.entries(ICONS)) {
      const { paths, dots = [] } = icon as { paths: string[]; dots?: unknown[] };
      expect(paths.length + dots.length, name).toBeGreaterThan(0);
      for (const d of paths) expect(d, name).toMatch(/^[Mm][\d\s.,\-a-zA-Z]+$/);
    }
  });
});
