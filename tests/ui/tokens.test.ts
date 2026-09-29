/**
 * The look's guard (LOOK-BRIEF.md), computed from the real stylesheets:
 * - colour contrast from the tokens in src/ui/tokens.css and themes.css: every text pair meets 4.5:1 and
 *   every control or focus pair 3:1, in Original (Scratch's palette) and High contrast;
 * - tokens.ts (canvas code) says the same as the CSS;
 * - the shared CSS (src/ui, the app frame) keeps Scratch's shape rules: tokens only, 4 px, 8 px or round
 *   corners, and no glows, gradients, textures or rotation.
 *
 * Scratch's own values that fail, and how the tokens avoid them (recorded, not tested):
 * - White on Scratch blue #4c97ff is 2.9:1 and on Scratch green #0fbd8c 2.4:1, so words sit on the deeper
 *   shades of the same hues (--brand #3373cc, Scratch's motion-tertiary; --alive #0a7a5a) and the bright
 *   values (--brand-bright, --alive-bright) are only for fills without words, rings and illustration.
 * - Scratch purple #855cd6 is 4.05:1 on the page (--bg), so --change is #7c52d0 and #855cd6 stays for
 *   selection borders (--change-bright).
 * - Scratch's 15 % black outline is 1.4:1: it only outlines cards and panels (--line); fields, switches
 *   and sliders take --line-control #7d8399 (3.3:1 on the page).
 */
import { describe, expect, it } from 'vitest';
import { THEMES as CANVAS_THEMES, type ThemeColors } from '../../src/ui/tokens';

const CSS = import.meta.glob<string>(['/src/ui/**/*.css', '/src/app/frame/frame.css'], {
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

const original = block(CSS['/src/ui/tokens.css'], ':root');
const THEMES: Record<string, Tokens> = {
  original,
  contrast: { ...original, ...block(CSS['/src/ui/themes.css'], ":root[data-theme='contrast']") },
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

const SURFACES = ['--bg', '--surface', '--surface-top', '--surface-bottom', '--surface-raised', '--well'];
const PANELS = ['--surface', '--surface-top', '--surface-bottom', '--surface-raised'];
const PAPERS = ['--paper', '--paper-2', '--paper-3', '--note'];

/** [foreground, backgrounds, minimum]. */
const PAIRS: Array<[string, string[], number]> = [
  // text (4.5:1)
  ['--text', [...SURFACES, '--bg-deep'], 4.5],
  ['--text-2', SURFACES, 4.5],
  ['--on-accent', ['--accent'], 4.5],
  ['--on-accent', ['--warn'], 4.5], // destructive buttons
  ['--on-accent', ['--change'], 4.5], // selected buttons, switches that are on
  ['--on-brand', ['--brand', '--brand-hover'], 4.5], // the top bar, and a button hovered on it
  ['--on-alive', ['--alive'], 4.5],
  ['--on-warm', ['--warm'], 4.5],
  ['--ai', ['--bg', ...PANELS], 4.5],
  ['--warn', ['--bg', ...PANELS, '--well'], 4.5],
  ['--alive', ['--bg', ...PANELS], 4.5],
  ['--change', ['--bg', ...PANELS], 4.5],
  ['--ink', PAPERS, 4.5],
  ['--ink-2', PAPERS, 4.5],
  ['--pencil-ink', ['--paper', '--paper-2', '--paper-3'], 4.5],
  ['--accent-text', ['--bg', ...PANELS], 4.5],
  ['--ink', ['--swash'], 4.5],
  ['--on-sheet', ['--sheet'], 4.5],
  ['--on-sheet-2', ['--sheet'], 4.5],
  // controls, boundaries and focus (3:1)
  ['--line-control', ['--bg', '--surface'], 3],
  ['--line-control-panel', PANELS, 3],
  ['--focus-ring', ['--bg', '--bg-deep', ...PANELS], 3],
  ['--alive', SURFACES, 3],
  ['--warn', SURFACES, 3],
  ['--ai', SURFACES, 3],
  ['--change', SURFACES, 3],
  ['--change-bright', ['--bg', ...PANELS], 3], // the selection edge
  ['--paper-line', ['--paper', '--paper-2'], 3],
  ['--bones', ['--sheet'], 3],
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

    it(`gives the primary button a visible edge in ${name}`, () => {
      const border = theme['--accent-border'];
      const edge = border && border !== 'transparent' ? colour(theme, '--accent-border') : colour(theme, '--accent');
      expect(contrast(edge, colour(theme, '--bg'))).toBeGreaterThanOrEqual(3);
    });
  }

  it("uses Scratch's palette for the Original colours", () => {
    expect(colour(original, '--bg')).toBe('#e5f0ff');
    expect(colour(original, '--text')).toBe('#575e75');
    expect(colour(original, '--brand')).toBe('#3373cc');
    expect(colour(original, '--brand-bright')).toBe('#4c97ff');
    expect(colour(original, '--change-bright')).toBe('#855cd6');
    expect(colour(original, '--note')).toBe('#fef49c');
    // The primary button on the top bar: white with blue words, and on hover the page colour.
    expect(contrast(colour(original, '--accent-text'), colour(original, '--on-brand'))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(colour(original, '--accent-text'), colour(original, '--bg'))).toBeGreaterThanOrEqual(4.5);
    // The chosen option of a segmented control: purple words on a white face; the others on the well.
    expect(contrast(colour(original, '--change'), colour(original, '--surface'))).toBeGreaterThanOrEqual(4.5);
  });

  it('keeps drawing surfaces white, with dark ink on them, in every theme', () => {
    for (const theme of Object.values(THEMES)) {
      expect(colour(theme, '--sheet')).toBe('#ffffff');
      expect(contrast(colour(theme, '--on-sheet'), '#ffffff')).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('turns every surface black with white words in High contrast', () => {
    for (const s of [...SURFACES, '--bg-lift', '--bg-deep', '--paper', '--note']) expect(colour(THEMES.contrast, s), s).toBe('#000000');
    for (const w of ['--text', '--text-2', '--ink', '--line', '--line-control']) expect(colour(THEMES.contrast, w), w).toBe('#ffffff');
  });

  it('uses a 4 px focus ring, a yellow accent and no shadows in High contrast', () => {
    expect(THEMES.contrast['--focus-width']).toBe('4px');
    expect(THEMES.contrast['--glow-lantern']).not.toMatch(/\d+px\s+rgba/);
    expect(colour(THEMES.contrast, '--accent')).toBe('#ffff00');
    for (const lift of ['--lift', '--lift-sm', '--lift-paper']) expect(THEMES.contrast[lift]).toBe('none');
  });
});

describe('canvas tokens (tokens.ts)', () => {
  const KEYS: Array<[keyof ThemeColors, string]> = [
    ['bg', '--bg'],
    ['bgDeep', '--bg-deep'],
    ['well', '--well'],
    ['text', '--text'],
    ['text2', '--text-2'],
    ['brand', '--brand'],
    ['onBrand', '--on-brand'],
    ['accent', '--accent'],
    ['onAccent', '--on-accent'],
    ['alive', '--alive'],
    ['warn', '--warn'],
    ['change', '--change'],
    ['lineControl', '--line-control'],
    ['focusRing', '--focus-ring'],
    ['sheet', '--sheet'],
    ['onSheet', '--on-sheet'],
  ];

  it('has the two themes, Original and High contrast, matching the CSS', () => {
    for (const name of ['original', 'contrast'] as const) {
      for (const [key, token] of KEYS) expect(CANVAS_THEMES[name][key], `${name}.${key}`).toBe(colour(THEMES[name], token));
    }
  });

  it('keeps night and day only as names for the Original colours', () => {
    expect(CANVAS_THEMES.night).toBe(CANVAS_THEMES.original);
    expect(CANVAS_THEMES.day).toBe(CANVAS_THEMES.original);
  });
});

describe('shared CSS keeps the shape rules', () => {
  const SHARED = Object.entries(CSS).map(([path, text]) => [path, text.replace(/\/\*[\s\S]*?\*\//g, '')] as const);
  const COMPONENTS = SHARED.filter(([path]) => path.endsWith('components.css') || path.endsWith('frame.css'));

  it('reads tokens only in the components and the frame: no literal colours', () => {
    for (const [path, css] of COMPONENTS) expect(css.match(/#[0-9a-f]{3,8}\b|rgba?\(/gi) ?? [], path).toEqual([]);
  });

  it('uses only the 4 px, 8 px and round corners', () => {
    expect(original['--r-sm']).toBe('4px');
    expect(original['--r-chip']).toBe('4px');
    for (const r of ['--r-md', '--r-btn', '--r-btn-lg', '--r-card', '--r-world', '--r-paper', '--r-cut']) expect(original[r], r).toBe('8px');
    for (const [path, css] of SHARED) {
      for (const m of css.matchAll(/border-radius:\s*([^;]+);/g)) {
        for (const part of m[1].replace(/!important/, '').trim().split(/\s+(?![^(]*\))/)) expect(part, `${path}: ${m[0]}`).toMatch(/^(var\(--r-[a-z-]+\)|0|inherit)$/);
      }
    }
  });

  it('has no glows, gradients, textures or rotation', () => {
    for (const [path, css] of SHARED) {
      expect(css.match(/blur\(|drop-shadow\(|url\(|rotate|skew|radial-gradient|conic-gradient|grain/g) ?? [], path).toEqual([]);
      // The dial's track is the one linear gradient: two flat colours with a hard edge at the value.
      for (const m of css.matchAll(/linear-gradient\(([^;]+)\)\s*;/g)) {
        const stops = [...m[1].matchAll(/var\(--fill, 0%\)/g)];
        expect(stops.length, `${path}: ${m[0]}`).toBe(2);
      }
    }
  });
});
