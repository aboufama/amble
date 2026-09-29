/**
 * The two fonts games get as bytes in `init.fonts` (§3.2): Fredoka 600 for name tags and titles, Atkinson
 * Hyperlegible Next 700 for HUDs. Fetched once from the app's own origin (the iframe cannot fetch).
 */
import atkinson700 from '@fontsource/atkinson-hyperlegible-next/files/atkinson-hyperlegible-next-latin-700-normal.woff2?url';
import fredoka600 from '@fontsource/fredoka/files/fredoka-latin-600-normal.woff2?url';
import type { FontAsset } from '../../cores/play';

const GAME_FONTS = [
  { family: 'Fredoka', weight: 600, url: fredoka600 },
  { family: 'Atkinson Hyperlegible Next', weight: 700, url: atkinson700 },
];

let loading: Promise<FontAsset[]> | null = null;

/** The game fonts' bytes (an empty list when they cannot be read; games then use their fallback). */
export function loadGameFonts(): Promise<FontAsset[]> {
  loading ??= Promise.all(
    GAME_FONTS.map(async ({ family, weight, url }) => {
      const res = await fetch(url, { credentials: 'same-origin' });
      if (!res.ok) throw new Error(`Font ${family} ${weight}: ${res.status}`);
      return { family, weight, bytes: await res.arrayBuffer() };
    }),
  ).catch(() => {
    loading = null;
    return [];
  });
  return loading;
}
