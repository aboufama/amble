/**
 * Flipbook moves (§7.12): the Desk's pages packed into one atlas (≤ 2048 px a side) with the sheet that
 * says where each page is and where the feet are, so the game plays them instead of one move. The pages are
 * exported at the flat picture's scale; when they do not fit, the atlas is made smaller and says by how
 * much (`k`).
 */
import type { FrameExport } from '../cores/art';
import { FLIPBOOK_ATLAS_MAX, type FlipbookSheet } from '../cores/play';

/** Page sizes → where each goes in the atlas (rows, tallest first), or null when they cannot fit. */
export function layoutAtlas(sizes: ReadonlyArray<{ w: number; h: number }>, max = FLIPBOOK_ATLAS_MAX, pad = 2): { rects: Array<{ x: number; y: number }>; w: number; h: number } | null {
  const order = sizes.map((s, i) => ({ ...s, i })).sort((a, b) => b.h - a.h || b.w - a.w);
  const rects: Array<{ x: number; y: number }> = new Array(sizes.length);
  let x = 0;
  let y = 0;
  let row = 0;
  let width = 0;
  for (const s of order) {
    if (s.w > max || s.h > max) return null;
    if (x > 0 && x + s.w > max) {
      y += row + pad;
      x = 0;
      row = 0;
    }
    if (y + s.h > max) return null;
    rects[s.i] = { x, y };
    x += s.w + pad;
    row = Math.max(row, s.h);
    width = Math.max(width, x - pad);
  }
  return { rects, w: Math.max(1, width), h: Math.max(1, y + row) };
}

export interface PackedFlipbook {
  atlas: Blob;
  json: string;
  move: string;
  fps: number;
}

/**
 * Packs exported pages (placed in their shared box at `scale`) into an atlas and its sheet. `anchor` is
 * where the feet are in that box (the flat picture's anchor), in the pages' pixels.
 */
export async function packFlipbook(frames: readonly FrameExport[], anchor: [number, number], move: string, fps: number): Promise<PackedFlipbook | null> {
  if (frames.length < 2) return null;
  const bitmaps = await Promise.all(frames.map((f) => createImageBitmap(f.png)));
  try {
    const boxW = Math.max(...frames.map((f) => f.x + f.w));
    const boxH = Math.max(...frames.map((f) => f.y + f.h));
    for (let k = 1; k > 0.05; k *= 0.8) {
      const sizes = frames.map((f) => ({ w: Math.max(1, Math.round(f.w * k)), h: Math.max(1, Math.round(f.h * k)) }));
      const layout = layoutAtlas(sizes);
      if (!layout) continue;
      const canvas = new OffscreenCanvas(layout.w, layout.h);
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      frames.forEach((_, i) => ctx.drawImage(bitmaps[i], layout.rects[i].x, layout.rects[i].y, sizes[i].w, sizes[i].h));
      const sheet: FlipbookSheet & { k: number } = {
        v: 1,
        w: Math.round(boxW * k),
        h: Math.round(boxH * k),
        anchor: [anchor[0] * k, anchor[1] * k],
        k,
        frames: frames.map((f, i) => ({ x: layout.rects[i].x, y: layout.rects[i].y, w: sizes[i].w, h: sizes[i].h, ox: Math.round(f.x * k), oy: Math.round(f.y * k), hold: Math.max(1, f.hold) })),
      };
      return { atlas: await canvas.convertToBlob({ type: 'image/png' }), json: JSON.stringify(sheet), move, fps: Math.max(4, Math.min(12, Math.round(fps))) };
    }
    return null;
  } finally {
    for (const b of bitmaps) b.close();
  }
}
