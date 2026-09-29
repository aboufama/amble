/**
 * Colour contrast (§3.1), computed from the real tokens in src/ui/tokens.css and themes.css: every text
 * pair meets 4.5:1 and every control or focus pair 3:1, in Night, Day and High contrast.
 *
 * Pairs the spec's own values fail, and how the design system avoids them (recorded, not tested):
 * - Night `--line-control` #5a61aa is 2.995:1 on `--bg` (the spec rounds it to 3.0): the token is #5b62ab
 *   (3.04:1), one step lighter.
 * - Night `--line-control` is 2.4:1 on `--surface-top`: panels, dialogs, popovers and the complementary
 *   region redefine `--line-control` as `--line-control-panel` #7a82cc (3.14:1 or better).
 * - Day `--accent` #ffc15e is 1.37:1 on `--bg`: lantern buttons carry the 1.5 px #8a6a00 border
 *   (`--accent-border`), and Day's focus ring is #8a6a00, not the accent.
 * - Night `--warn` is 4.49:1 on `--surface-raised` (toasts, menus): words there stay `--text`, with a
 *   `--warn` icon or edge; danger and AI buttons keep `--text` words on their tint for the same reason.
 * - Day `--alive` is 4.49:1 on `--well`, and Day `--ai`/`--alive` fall under 4.5:1 on `--bg-deep`: those
 *   colours are never text on a field or on the letterbox.
 */
import { describe, expect, it } from 'vitest';

const CSS = import.meta.glob<string>(['/src/ui/tokens.css', '/src/ui/themes.css', '/src/ui/components/components.css', '/src/app/frame/frame.css'], {
  query: '?raw',
  import: 'default',
  eager: true,
});

type Tokens = Record<string, string>;

/** The custom properties declared directly in the first block whose selector is exactly `selector`. */
function block(css: string, selector: string): Tokens {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`No block ${selector}`);
  const open = css.indexOf('{', start);
  let depth = 0;
  let end = open;
  for (; end < css.length; end++) {
    if (css[end] === '{') depth++;
    else if (css[end] === '}' && --depth === 0) break;
  }
  const body = css.slice(open + 1, end).replace(/\/\*[\s\S]*?\*\//g, '');
  const out: Tokens = {};
  for (const m of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) out[m[1]] = m[2].trim();
  return out;
}

const night = block(CSS['/src/ui/tokens.css'], ':root');
const THEMES: Record<string, Tokens> = {
  night,
  day: { ...night, ...block(CSS['/src/ui/themes.css'], ":root[data-theme='day']") },
  contrast: { ...night, ...block(CSS['/src/ui/themes.css'], ":root[data-theme='contrast']") },
};

/** A token's colour as #rrggbb, following var() references. */
function colour(theme: Tokens, name: string): string {
  let v = theme[name];
  for (let i = 0; i < 8 && v?.startsWith('var('); i++) v = theme[v.slice(4, -1).trim()];
  if (!v || !/^#[0-9a-f]{6}$/i.test(v)) throw new Error(`${name} is not a plain colour: ${v}`);
  return v.toLowerCase();
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

const SURFACES = ['--bg', '--surface-top', '--surface-bottom', '--surface-raised', '--well'];
const PANELS = ['--surface-top', '--surface-bottom', '--surface-raised'];
const PAPERS = ['--paper', '--paper-2', '--paper-3', '--note'];

/** [foreground, backgrounds, minimum]. */
const PAIRS: Array<[string, string[], number]> = [
  // text (4.5:1)
  ['--text', [...SURFACES, '--bg-deep'], 4.5],
  ['--text-2', SURFACES, 4.5],
  ['--on-accent', ['--accent'], 4.5],
  ['--on-alive', ['--alive'], 4.5],
  ['--ai', ['--bg', '--surface-top', '--surface-bottom', '--surface-raised'], 4.5],
  ['--warn', ['--bg', '--surface-top', '--surface-bottom', '--well'], 4.5],
  ['--alive', ['--bg', '--surface-top', '--surface-bottom', '--surface-raised'], 4.5],
  ['--change', ['--bg', '--surface-top', '--surface-bottom', '--surface-raised'], 4.5],
  ['--ink', PAPERS, 4.5],
  ['--ink-2', PAPERS, 4.5],
  ['--pencil-ink', ['--paper', '--paper-2', '--paper-3'], 4.5],
  ['--on-alive', ['--alive'], 4.5],
  ['--accent-text', ['--bg', '--surface-top', '--surface-bottom', '--surface-raised'], 4.5],
  ['--ink', ['--swash'], 4.5],
  // controls, boundaries and focus (3:1)
  ['--line-control', ['--bg'], 3],
  ['--line-control-panel', PANELS, 3],
  ['--focus-ring', ['--bg', '--bg-deep', '--surface-top', '--surface-bottom', '--surface-raised'], 3],
  ['--alive', SURFACES, 3],
  ['--warn', SURFACES, 3],
  ['--ai', SURFACES, 3],
  ['--change', SURFACES, 3],
  ['--paper-line', ['--paper', '--paper-2'], 3],
];

describe('colour contrast (§3.1)', () => {
  for (const [name, theme] of Object.entries(THEMES)) {
    it(`meets 4.5:1 for text and 3:1 for controls in ${name}`, () => {
      const failures: string[] = [];
      for (const [fg, bgs, min] of PAIRS) {
        for (const bg of bgs) {
          const ratio = contrast(colour(theme, fg), colour(theme, bg));
          if (ratio < min) failures.push(`${fg} on ${bg}: ${ratio.toFixed(2)} < ${min}`);
        }
      }
      expect(failures).toEqual([]);
    });

    it(`gives the lantern button a visible edge in ${name}`, () => {
      const border = theme['--accent-border'];
      const edge = border && border !== 'transparent' ? colour(theme, '--accent-border') : colour(theme, '--accent');
      expect(contrast(edge, colour(theme, '--bg'))).toBeGreaterThanOrEqual(3);
    });
  }

  it('matches the spec values that the spec states', () => {
    expect(contrast(colour(night, '--text'), colour(night, '--bg'))).toBeCloseTo(14.4, 1);
    expect(contrast(colour(night, '--line-control'), colour(night, '--bg'))).toBeGreaterThanOrEqual(3);
    expect(contrast(colour(THEMES.day, '--text'), colour(THEMES.day, '--surface-top'))).toBeGreaterThan(15.5);
    expect(contrast(colour(night, '--on-accent'), colour(night, '--accent'))).toBeCloseTo(10.3, 1);
  });

  it('uses a 4 px focus ring and no glows in High contrast', () => {
    expect(THEMES.contrast['--focus-width']).toBe('4px');
    expect(THEMES.contrast['--glow-lantern']).not.toMatch(/\d+px\s+rgba/);
    expect(colour(THEMES.contrast, '--accent')).toBe('#ffff00');
  });
});

describe('component CSS', () => {
  it('reads tokens only: no literal colours', () => {
    for (const path of ['/src/ui/components/components.css', '/src/app/frame/frame.css']) {
      const css = CSS[path].replace(/\/\*[\s\S]*?\*\//g, '');
      expect(css.match(/#[0-9a-f]{3,8}\b|rgba?\(/gi) ?? [], path).toEqual([]);
    }
  });
});
