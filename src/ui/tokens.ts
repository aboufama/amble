/**
 * The design tokens for canvas code (the Desk's paper and guides, rig previews, the Trail, thumbnails),
 * mirroring tokens.css and themes.css. Games are unaffected by themes.
 */
import type { Role } from '../model/types';

export type ThemeName = 'night' | 'day' | 'contrast';

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
  accent: string;
  accentBorder: string | null;
  onAccent: string;
  alive: string;
  ai: string;
  warn: string;
  change: string;
  focusRing: string;
}

export const THEMES: Record<ThemeName, ThemeColors> = {
  night: {
    bg: '#151843',
    bgLift: '#1d2160',
    bgDeep: '#0b0c24',
    surfaceTop: '#232863',
    surfaceBottom: '#1b1f52',
    surfaceRaised: '#2e3478',
    well: '#111338',
    line: '#3d448f',
    lineControl: '#5b62ab',
    lineControlPanel: '#7a82cc',
    text: '#f4ecdc',
    text2: '#a7acdc',
    accent: '#ffc15e',
    accentBorder: null,
    onAccent: '#221b2e',
    alive: '#86f3cb',
    ai: '#9cc3ff',
    warn: '#ff7a8e',
    change: '#c79bff',
    focusRing: '#ffc15e',
  },
  day: {
    bg: '#f4ecdb',
    bgLift: '#efe4cc',
    bgDeep: '#e7dcc4',
    surfaceTop: '#fffaf0',
    surfaceBottom: '#fffaf0',
    surfaceRaised: '#ffffff',
    well: '#ece2cc',
    line: '#d8c9a6',
    lineControl: '#8c7b5a',
    lineControlPanel: '#8c7b5a',
    text: '#221b2e',
    text2: '#4a4058',
    accent: '#ffc15e',
    accentBorder: '#8a6a00',
    onAccent: '#221b2e',
    alive: '#17744a',
    ai: '#2c5fb8',
    warn: '#b3263e',
    change: '#6f3fc0',
    focusRing: '#8a6a00',
  },
  contrast: {
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
    accent: '#ffff00',
    accentBorder: '#ffffff',
    onAccent: '#000000',
    alive: '#86f3cb',
    ai: '#9cc3ff',
    warn: '#ff7a8e',
    change: '#c79bff',
    focusRing: '#ffff00',
  },
};

/** Paper is always light (the Desk sheet, tags, notes, cast cards). */
export const PAPER = {
  paper: '#fdf8ec',
  paper2: '#f6eedb',
  paper3: '#e9dcc0',
  paperLine: '#8c7b5a',
  ink: '#221b2e',
  ink2: '#4a4058',
  pencilInk: '#3f5db0',
  note: '#fff3a8',
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

/** How "just bones" looks (§3.8). */
export const PLACEHOLDER = {
  tintAlpha: 0.55,
  hatchAngleDeg: 38,
  hatchGap: 9,
  hatchAlpha: 0.28,
  dash: '#f4ecdc',
  dashWidth: 2.4,
  dashPattern: [7, 6] as const,
  haloWidth: 5.5,
  halo: 'rgba(8, 9, 30, 0.55)',
  dashSpeedPxPerS: 20,
  bone: '#86f3cb',
  boneWidth: 2,
  jointRadius: 3,
  bonesAlpha: 0.85,
} as const;

/** Bones in the Bones view and guides (§2.11): left side stripes, right side dots. */
export const BONES = {
  left: '#86f3cb',
  right: '#ffc15e',
  spine: '#f4ecdc',
  width: 3.2,
  glow: 7,
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
  display: "'Fredoka', 'Atkinson Hyperlegible Next', system-ui, sans-serif",
  ui: "'Atkinson Hyperlegible Next', system-ui, sans-serif",
  code: "'JetBrains Mono', ui-monospace, monospace",
} as const;
