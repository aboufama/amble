/** Colours in every form a game might write them: 0xff00aa, '#ff00aa', '#f0a', 'ff00aa', 'red'. Pure. */

export type Color = number | string;

const NAMED: Record<string, number> = {
  red: 0xff4d6d, orange: 0xff8c42, yellow: 0xffd23f, gold: 0xffc300, green: 0x5ad16b, lime: 0xb5e61d, teal: 0x2ec4b6,
  cyan: 0x4cc9f0, blue: 0x4361ee, navy: 0x1d3557, purple: 0x9d4edd, violet: 0x7b2cbf, pink: 0xff70a6, magenta: 0xf72585,
  white: 0xffffff, black: 0x111111, gray: 0x8d99ae, grey: 0x8d99ae, brown: 0x9c6644, tan: 0xd4a373, silver: 0xced4da,
};

export function colorInt(c: unknown, fallback = 0xffffff): number {
  if (typeof c === 'number' && Number.isFinite(c)) return (c >>> 0) & 0xffffff;
  if (typeof c === 'string') {
    const s = c.trim().toLowerCase();
    const named = NAMED[s];
    if (named !== undefined) return named;
    const m = s.replace(/^#|^0x/, '');
    if (/^[0-9a-f]{3}$/.test(m)) return parseInt(m.split('').map((ch) => ch + ch).join(''), 16);
    if (/^[0-9a-f]{6}$/.test(m)) return parseInt(m, 16);
    const rgb = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(s);
    if (rgb) return (Math.min(255, +rgb[1]) << 16) | (Math.min(255, +rgb[2]) << 8) | Math.min(255, +rgb[3]);
  }
  return fallback;
}

export function cssColor(c: unknown, fallback = 0xffffff): string {
  return '#' + colorInt(c, fallback).toString(16).padStart(6, '0');
}

export function rgba(c: unknown, alpha: number): string {
  const n = colorInt(c);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${Math.max(0, Math.min(1, alpha))})`;
}

/** f < 0 darkens toward black, f > 0 lightens toward white. */
export function shade(c: unknown, f: number): number {
  const n = colorInt(c);
  let r = (n >> 16) & 255;
  let g = (n >> 8) & 255;
  let b = n & 255;
  if (f < 0) {
    r *= 1 + f;
    g *= 1 + f;
    b *= 1 + f;
  } else {
    r += (255 - r) * f;
    g += (255 - g) * f;
    b += (255 - b) * f;
  }
  return ((Math.round(r) & 255) << 16) | ((Math.round(g) & 255) << 8) | (Math.round(b) & 255);
}

/** Mixes two colours: t = 0 gives a, t = 1 gives b. */
export function mix(a: unknown, b: unknown, t: number): number {
  const x = colorInt(a);
  const y = colorInt(b);
  const ch = (shift: number) => Math.round(((x >> shift) & 255) + (((y >> shift) & 255) - ((x >> shift) & 255)) * t);
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

/** A colour from hue (0..360), saturation and lightness (0..1). */
export function hsl(h: number, s: number, l: number): number {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return (Math.round(f(0) * 255) << 16) | (Math.round(f(8) * 255) << 8) | Math.round(f(4) * 255);
}
