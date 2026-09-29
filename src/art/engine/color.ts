/** Colour parsing and formatting. Colours are '#rrggbb' strings at the API and [r, g, b] (0..255) inside. */
export type RGB = [number, number, number];

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

/** Parses '#rgb', '#rgba', '#rrggbb' or '#rrggbbaa' (alpha is ignored). Returns null when invalid. */
export function parseColor(s: string): RGB | null {
  const m = HEX.exec(s.trim());
  if (!m) return null;
  let h = m[1];
  if (h.length <= 4) h = [...h.slice(0, 3)].map((c) => c + c).join('');
  const n = parseInt(h.slice(0, 6), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function isColor(s: unknown): s is string {
  return typeof s === 'string' && HEX.test(s.trim());
}

export function toHex(c: RGB): string {
  return `#${c.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')}`;
}

/** Normalises any accepted colour string to lowercase '#rrggbb' (black when invalid). */
export function normalizeColor(s: string): string {
  return toHex(parseColor(s) ?? [0, 0, 0]);
}
