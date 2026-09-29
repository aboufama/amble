/**
 * The Desk's colours (§2.10): 18 kid swatches, 9 skin tones, the colours already used in this world's other
 * drawings ("From your world"), and the few colours a student picked recently.
 */
import { luminance, normalizeHex } from './colorNames';

/** The rows of swatches on the colour panel. */
export type SwatchGroup = 'box' | 'skin' | 'world' | 'recent';

/** How a name that two swatches share is told apart (the words come from the i18n table). */
export interface SwatchWords {
  lighter(name: string): string;
  darker(name: string): string;
  nth(name: string, n: number): string;
  inGroup(name: string, group: SwatchGroup): string;
}

/**
 * A different name for every swatch on the panel, since a screen reader lists them all ("Pebble grey" three
 * times says nothing): a name two swatches of one row share becomes "…, lighter" and "…, darker" (or a
 * number, light to dark, for three or more), and a name another row has too gets its row's word
 * ("Chocolate, skin tone"). Rows keep their order; the first row with a name keeps it plain.
 */
export function uniqueSwatchNames(groups: ReadonlyArray<{ group: SwatchGroup; colors: readonly string[] }>, nameOf: (hex: string) => string, words: SwatchWords): string[][] {
  const out = groups.map(({ colors }) => colors.map(nameOf));
  // Within a row: light to dark.
  groups.forEach(({ colors }, g) => {
    const byName = new Map<string, number[]>();
    out[g].forEach((n, i) => byName.set(n, [...(byName.get(n) ?? []), i]));
    for (const [name, idx] of byName) {
      if (idx.length < 2) continue;
      const order = [...idx].sort((a, b) => luminance(colors[b]) - luminance(colors[a]));
      order.forEach((i, k) => {
        out[g][i] = idx.length === 2 ? (k === 0 ? words.lighter(name) : words.darker(name)) : words.nth(name, k + 1);
      });
    }
  });
  // Across rows: the row's word on every row after the first that has the name.
  const firstRow = new Map<string, number>();
  out.forEach((row, g) =>
    row.forEach((n, i) => {
      const first = firstRow.get(n);
      if (first === undefined) firstRow.set(n, g);
      else if (first !== g) out[g][i] = words.inGroup(n, groups[g].group);
    }),
  );
  // Anything still the same (the same colour twice in a row): numbered.
  const seen = new Map<string, number>();
  for (const row of out)
    row.forEach((n, i) => {
      const k = (seen.get(n) ?? 0) + 1;
      seen.set(n, k);
      if (k > 1) row[i] = words.nth(n, k);
    });
  return out;
}

/** The 18 kid swatches: two rows of nine, darks and lights of the rainbow. */
export const KID_SWATCHES: readonly string[] = [
  '#221b2e', '#ffffff', '#e5484d', '#ff9a3c', '#ffd23f', '#7bd05a', '#2ec4b6', '#4f8bff', '#8e5bd6',
  '#ff7eb6', '#8a5530', '#8e8aa0', '#fff3c4', '#f2c230', '#c8f06a', '#9cd8ff', '#1e3a8a', '#c79bff',
];

/** Nine skin tones, light to dark. */
export const SKIN_TONES: readonly string[] = ['#fde0c5', '#f3c796', '#e8b98a', '#d9a066', '#c68642', '#b0764a', '#8a5530', '#6b4226', '#3b2417'];

/** The first colour of a new drawing: Ink black. */
export const START_COLOR = '#221b2e';

/**
 * "From your world": colours used in the world's other drawings (their saved palettes), most used first,
 * without near-duplicates of each other or of the kid swatches, at most `max`.
 */
export function worldColors(palettes: ReadonlyArray<readonly string[]>, max = 9): string[] {
  const count = new Map<string, number>();
  for (const p of palettes)
    p.forEach((c, i) => {
      const h = normalizeHex(c);
      if (h) count.set(h, (count.get(h) ?? 0) + (24 - Math.min(23, i)));
    });
  const out: string[] = [];
  for (const [c] of [...count].sort((a, b) => b[1] - a[1])) {
    if (out.length >= max) break;
    if (out.some((o) => close(o, c)) || KID_SWATCHES.some((k) => close(k, c)) || isInk(c)) continue;
    out.push(c);
  }
  return out;
}

/** Remembers a used colour at the front of a short list. */
export function pushRecent(recent: readonly string[], color: string, max = 6): string[] {
  const h = normalizeHex(color);
  if (!h) return recent.slice();
  return [h, ...recent.filter((c) => c !== h)].slice(0, max);
}

function rgb(h: string): [number, number, number] {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Colours this close look the same in a swatch row. */
export function close(a: string, b: string, tol = 18): boolean {
  const [r1, g1, b1] = rgb(a);
  const [r2, g2, b2] = rgb(b);
  return Math.max(Math.abs(r1 - r2), Math.abs(g1 - g2), Math.abs(b1 - b2)) <= tol;
}

/** Near-black outline ink is in every drawing; it is not a "world colour". */
function isInk(c: string): boolean {
  const [r, g, b] = rgb(c);
  return r + g + b < 120;
}
