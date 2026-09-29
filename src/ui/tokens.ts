/**
 * The design tokens for canvas code (the Desk's paper and guides, rig previews, the Trail, thumbnails),
 * mirroring tokens.css and themes.css. Games are unaffected by themes.
 */
import type { Prefs, Role } from '../model/types';

/** The colour themes (Settings → Reading → Colours): Scratch's Original colours, or High contrast. */
export type ThemeName = Prefs['theme'];

export interface ThemeColors {
  bg: string;
  bgLift: string;
  bgDeep: string;
  surfaceTop: string;
  surfaceBottom: string;
  surfaceRaised: string;
  well: string;
  line: string;
  lineControl: string;
  lineControlPanel: string;
  text: string;
  text2: string;
  brand: string;
  onBrand: string;
  accent: string;
  accentBorder: string | null;
  onAccent: string;
  alive: string;
  onAlive: string;
  ai: string;
  warn: string;
  change: string;
  focusRing: string;
  /** Drawing surfaces: white in every theme, so the dark default pen always shows. */
  sheet: string;
  /** Words, guides and marks on the sheet: dark in every theme. */
  onSheet: string;
}

/** Original: Scratch 3's palette, with AA-safe shades of the same hues wherever words appear. */
const ORIGINAL: ThemeColors = {
  bg: '#e5f0ff',
  bgLift: '#e9f1fc',
  bgDeep: '#d9e3f2',
  surfaceTop: '#ffffff',
  surfaceBottom: '#ffffff',
  surfaceRaised: '#ffffff',
  well: '#f9f9f9',
  line: '#d9d9d9',
  lineControl: '#7d8399',
  lineControlPanel: '#7d8399',
  text: '#575e75',
  text2: '#646a80',
  brand: '#3373cc',
  onBrand: '#ffffff',
  accent: '#3373cc',
  accentBorder: null,
  onAccent: '#ffffff',
  alive: '#0a7a5a',
  onAlive: '#ffffff',
  ai: '#2b63b1',
  warn: '#c8302a',
  change: '#7c52d0',
  focusRing: '#3373cc',
  sheet: '#ffffff',
  onSheet: '#575e75',
};

/** High contrast: black, white and yellow, with the drawing sheet still white. */
const CONTRAST: ThemeColors = {
  bg: '#000000',
  bgLift: '#000000',
  bgDeep: '#000000',
  surfaceTop: '#000000',
  surfaceBottom: '#000000',
  surfaceRaised: '#000000',
  well: '#000000',
  line: '#ffffff',
  lineControl: '#ffffff',
  lineControlPanel: '#ffffff',
  text: '#ffffff',
  text2: '#ffffff',
  brand: '#000000',
  onBrand: '#ffffff',
  accent: '#ffff00',
  accentBorder: '#ffffff',
  onAccent: '#000000',
  alive: '#86f3cb',
  onAlive: '#000000',
  ai: '#9cc3ff',
  warn: '#ff7a8e',
  change: '#c79bff',
  focusRing: '#ffff00',
  sheet: '#ffffff',
  onSheet: '#000000',
};

/**
 * Each theme's colours. `night` and `day` are the names earlier builds used; both are the Original
 * colours and stay only so older callers compile: read `THEMES.original` or `THEMES[prefs.theme]`.
 */
export const THEMES: Record<ThemeName, ThemeColors> & {
  /** @deprecated Night is the Original colours now: use `THEMES.original`. */
  night: ThemeColors;
  /** @deprecated Day is the Original colours now: use `THEMES.original`. */
  day: ThemeColors;
} = {
  original: ORIGINAL,
  contrast: CONTRAST,
  night: ORIGINAL,
  day: ORIGINAL,
};

/** Paper is always light (the Desk sheet, tags, notes, cast cards): Scratch white, with its comment-note yellow. */
export const PAPER = {
  paper: '#ffffff',
  paper2: '#f9f9f9',
  paper3: '#e9f1fc',
  paperLine: '#7d8399',
  ink: '#575e75',
  ink2: '#646a80',
  pencilInk: '#2b63b1',
  note: '#fef49c',
} as const;

/** Placeholder role tints (§3.8), drawn at 55 % under hatching. */
export const ROLE_TINTS: Record<Role | 'friend', string> = {
  hero: '#7cc7ef',
  friend: '#8fe3b0',
  enemy: '#f08aa2',
  boss: '#a993ee',
  npc: '#c9b6f2',
  item: '#f2cf5e',
  hazard: '#f4a261',
  projectile: '#9cc3ff',
  enemyShot: '#9cc3ff',
  terrain: '#d9b98c',
  prop: '#c9c2b2',
  decor: '#bfc6e0',
  background: '#bfc6e0',
};

/** How "just bones" looks in the app's own pictures (§3.8), flat: no halo under the dashed outline. */
export const PLACEHOLDER = {
  tintAlpha: 0.55,
  hatchAngleDeg: 38,
  hatchGap: 9,
  hatchAlpha: 0.28,
  dash: '#7d8399',
  dashWidth: 2,
  dashPattern: [6, 5] as const,
  haloWidth: 0,
  halo: 'transparent',
  dashSpeedPxPerS: 20,
  bone: '#0b8e69',
  boneWidth: 2,
  jointRadius: 3,
  bonesAlpha: 0.85,
} as const;

/**
 * Bones in the Bones view and guides (§2.11), over the white sheet: the left side green (--bones) in
 * stripes, the right side purple (--change) in dots, the spine in --on-sheet.
 */
export const BONES = {
  left: '#0b8e69',
  right: '#7c52d0',
  spine: '#575e75',
  width: 3.2,
  joint: 24,
  jointHit: 44,
} as const;

export const MOTION = {
  easeAmble: 'cubic-bezier(.3,.7,.2,1)',
  easePop: 'cubic-bezier(.34,1.56,.64,1)',
  easeSoft: 'cubic-bezier(.45,0,.2,1)',
  easeLift: 'cubic-bezier(.2,.9,.25,1.15)',
  micro: 120,
  ui: 200,
  move: 360,
  lift: 320,
  page: 480,
  world: 600,
  alive: 900,
} as const;

export const FONTS = {
  /** Headings: the UI font, bold. */
  display: "'Atkinson Hyperlegible Next', system-ui, sans-serif",
  /** The amble wordmark only. */
  wordmark: "'Fredoka', 'Atkinson Hyperlegible Next', system-ui, sans-serif",
  ui: "'Atkinson Hyperlegible Next', system-ui, sans-serif",
  code: "'JetBrains Mono', ui-monospace, monospace",
} as const;
