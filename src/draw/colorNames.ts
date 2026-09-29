/**
 * Colours with names a kid would say (§2.10: "Moon cream · picked from your coin", "Tomato red"). Every
 * colour gets the name of the nearest named colour (by how different they look: CIE Lab distance), so a
 * picked or mixed colour still reads as words, never only as a hex code.
 */

export type ColorId =
  | 'nightBlack'
  | 'inkBlack'
  | 'charcoal'
  | 'stoneGrey'
  | 'pebbleGrey'
  | 'cloudGrey'
  | 'fogWhite'
  | 'snowWhite'
  | 'paperWhite'
  | 'moonCream'
  | 'moonYellow'
  | 'sunYellow'
  | 'bananaYellow'
  | 'honey'
  | 'mustard'
  | 'apricot'
  | 'pumpkinOrange'
  | 'tangerine'
  | 'foxOrange'
  | 'peach'
  | 'salmon'
  | 'watermelon'
  | 'tomatoRed'
  | 'fireRed'
  | 'cherryRed'
  | 'berryRed'
  | 'plumBrown'
  | 'cottonCandy'
  | 'bubblegumPink'
  | 'flamingoPink'
  | 'raspberry'
  | 'magenta'
  | 'lilac'
  | 'lavender'
  | 'grapePurple'
  | 'violet'
  | 'royalPurple'
  | 'midnightPurple'
  | 'nightBlue'
  | 'navyBlue'
  | 'oceanBlue'
  | 'brightBlue'
  | 'skyBlue'
  | 'poolBlue'
  | 'babyBlue'
  | 'iceBlue'
  | 'teal'
  | 'seaGreen'
  | 'fireflyMint'
  | 'mint'
  | 'lime'
  | 'leafGreen'
  | 'grassGreen'
  | 'frogGreen'
  | 'forestGreen'
  | 'pineGreen'
  | 'olive'
  | 'vanilla'
  | 'sand'
  | 'toast'
  | 'caramel'
  | 'cinnamon'
  | 'clay'
  | 'chocolate'
  | 'cocoa'
  | 'coffee'
  | 'barkBrown'
  | 'darkChocolate';

/** Named colours: [hex, id]; the words are `draw.color_<id>` in the i18n table. */
export const NAMED_COLORS: ReadonlyArray<readonly [string, ColorId]> = [
  ['#000000', 'nightBlack'],
  ['#221b2e', 'inkBlack'],
  ['#3a3542', 'charcoal'],
  ['#5c5866', 'stoneGrey'],
  ['#8e8aa0', 'pebbleGrey'],
  ['#b9b6c4', 'cloudGrey'],
  ['#e4e2ea', 'fogWhite'],
  ['#ffffff', 'snowWhite'],
  ['#fdf8ec', 'paperWhite'],
  ['#fff3c4', 'moonCream'],
  ['#ffe08c', 'moonYellow'],
  ['#ffd23f', 'sunYellow'],
  ['#f2c230', 'bananaYellow'],
  ['#e5b23a', 'honey'],
  ['#c9a227', 'mustard'],
  ['#ffb347', 'apricot'],
  ['#ff9a3c', 'pumpkinOrange'],
  ['#ff7a1a', 'tangerine'],
  ['#e8641c', 'foxOrange'],
  ['#ffc9b0', 'peach'],
  ['#ff8a80', 'salmon'],
  ['#ff5a5f', 'watermelon'],
  ['#e5484d', 'tomatoRed'],
  ['#d62828', 'fireRed'],
  ['#b3263e', 'cherryRed'],
  ['#8c1c2f', 'berryRed'],
  ['#5e1a24', 'plumBrown'],
  ['#ffd1e1', 'cottonCandy'],
  ['#ff9ec7', 'bubblegumPink'],
  ['#ff7eb6', 'flamingoPink'],
  ['#e8456f', 'raspberry'],
  ['#c2185b', 'magenta'],
  ['#e0b6ff', 'lilac'],
  ['#c79bff', 'lavender'],
  ['#9b6bff', 'grapePurple'],
  ['#8e5bd6', 'violet'],
  ['#6a3cb0', 'royalPurple'],
  ['#3f2a6b', 'midnightPurple'],
  ['#1f1a52', 'nightBlue'],
  ['#1e3a8a', 'navyBlue'],
  ['#3f6fd6', 'oceanBlue'],
  ['#4f8bff', 'brightBlue'],
  ['#58c8ff', 'skyBlue'],
  ['#4fc3f7', 'poolBlue'],
  ['#9cd8ff', 'babyBlue'],
  ['#c9eeff', 'iceBlue'],
  ['#2ec4b6', 'teal'],
  ['#20a39e', 'seaGreen'],
  ['#86f3cb', 'fireflyMint'],
  ['#b5f5d9', 'mint'],
  ['#c8f06a', 'lime'],
  ['#9bd65a', 'leafGreen'],
  ['#7bd05a', 'grassGreen'],
  ['#5ccf6a', 'frogGreen'],
  ['#2fa36b', 'forestGreen'],
  ['#1d6b45', 'pineGreen'],
  ['#6b7a3a', 'olive'],
  ['#fde0c5', 'vanilla'],
  ['#f3c796', 'sand'],
  ['#e8b98a', 'toast'],
  ['#d9a066', 'caramel'],
  ['#c68642', 'cinnamon'],
  ['#b0764a', 'clay'],
  ['#8a5530', 'chocolate'],
  ['#6b4226', 'cocoa'],
  ['#5b3a24', 'coffee'],
  ['#4a3222', 'barkBrown'],
  ['#3b2417', 'darkChocolate'],
];

function srgbToLinear(c: number): number {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

/** CIE Lab (D65) of a '#rrggbb' colour. */
export function toLab(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1, 7), 16);
  const r = srgbToLinear((n >> 16) & 255);
  const g = srgbToLinear((n >> 8) & 255);
  const b = srgbToLinear(n & 255);
  const x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047;
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
  const f = (t: number): number => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const fx = f(x);
  const fy = f(y);
  const fz = f(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

const LABS = NAMED_COLORS.map(([hex, id]) => ({ hex, id, lab: toLab(hex) }));

/** Normalises '#RGB', '#RRGGBB' or 'rrggbb' to '#rrggbb' (null when it is not a colour). */
export function normalizeHex(input: string): string | null {
  const s = input.trim().replace(/^#/, '').toLowerCase();
  if (/^[0-9a-f]{3}$/.test(s)) return `#${s[0]}${s[0]}${s[1]}${s[1]}${s[2]}${s[2]}`;
  if (/^[0-9a-f]{6}$/.test(s)) return `#${s}`;
  return null;
}

/** Which named colour a colour is closest to (its words are `draw.color_<id>`). */
export function colorId(hex: string): ColorId {
  const h = normalizeHex(hex);
  if (!h) return NAMED_COLORS[1][1];
  const [L, A, B] = toLab(h);
  let best = LABS[0];
  let bd = Infinity;
  for (const c of LABS) {
    const d = (c.lab[0] - L) ** 2 + (c.lab[1] - A) ** 2 + (c.lab[2] - B) ** 2;
    if (d < bd) {
      bd = d;
      best = c;
    }
  }
  return best.id;
}

/** Relative luminance (WCAG) of a colour, 0..1. */
export function luminance(hex: string): number {
  const h = normalizeHex(hex) ?? '#000000';
  const n = parseInt(h.slice(1), 16);
  return 0.2126 * srgbToLinear((n >> 16) & 255) + 0.7152 * srgbToLinear((n >> 8) & 255) + 0.0722 * srgbToLinear(n & 255);
}

/** HSV (h 0..360, s and v 0..1) → '#rrggbb'. */
export function hsvToHex(h: number, s: number, v: number): string {
  const f = (n: number): number => {
    const k = (n + h / 60) % 6;
    return v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
  };
  const to = (x: number): string => Math.round(Math.max(0, Math.min(1, x)) * 255).toString(16).padStart(2, '0');
  return `#${to(f(5))}${to(f(3))}${to(f(1))}`;
}

/** '#rrggbb' → HSV (h 0..360, s and v 0..1). */
export function hexToHsv(hex: string): { h: number; s: number; v: number } {
  const n = parseInt((normalizeHex(hex) ?? '#000000').slice(1), 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max ? d / max : 0, v: max };
}
