/**
 * Stickers (§3.3, §7.7): a drawing wherever it appears in Amble's UI wears a cream die-cut edge, like a
 * sticker. 256 px: the drawing fitted with room for its edge, its shape grown by 3 px in cream, a soft
 * shadow, the drawing on top. UI only; games get the plain drawing.
 */

const CREAM = '#fdf8ec';
const EDGE = 3;
/**
 * Small canvases drawn once and read back: on the CPU. A GPU canvas would wait for the GPU process to read
 * it back, behind the running game and the Desk (well over a second of Bring to life on a busy GPU).
 */
const ON_CPU: CanvasRenderingContext2DSettings = { willReadFrequently: true };

async function bitmapOf(src: Blob | ImageBitmap): Promise<ImageBitmap> {
  return src instanceof Blob ? createImageBitmap(src) : src;
}

/** The drawing's shape grown by `r` px, in one colour (a ring of offset copies, then filled). */
function grown(img: CanvasImageSource, w: number, h: number, x: number, y: number, dw: number, dh: number, r: number, color: string): OffscreenCanvas {
  const c = new OffscreenCanvas(w, h);
  const ctx = c.getContext('2d', ON_CPU);
  if (!ctx) return c;
  const steps = 16;
  for (let k = 0; k < steps; k++) {
    const a = (k / steps) * Math.PI * 2;
    ctx.drawImage(img, x + Math.cos(a) * r, y + Math.sin(a) * r, dw, dh);
  }
  ctx.drawImage(img, x, y, dw, dh);
  ctx.globalCompositeOperation = 'source-in';
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, w, h);
  return c;
}

/** The sticker PNG of a drawing (its flat image), `size` px square. */
export async function makeSticker(flat: Blob | ImageBitmap, size = 256): Promise<Blob> {
  const img = await bitmapOf(flat);
  const pad = EDGE + 8;
  const k = Math.min((size - pad * 2) / img.width, (size - pad * 2) / img.height, 4);
  const dw = Math.max(1, Math.round(img.width * k));
  const dh = Math.max(1, Math.round(img.height * k));
  const x = Math.round((size - dw) / 2);
  const y = Math.round((size - dh) / 2);
  const c = new OffscreenCanvas(size, size);
  const ctx = c.getContext('2d', ON_CPU);
  if (!ctx) throw new Error('No 2D canvas for the sticker.');
  const edge = grown(img, size, size, x, y, dw, dh, EDGE, CREAM);
  ctx.save();
  ctx.shadowColor = 'rgba(8, 9, 30, 0.35)';
  ctx.shadowBlur = 6;
  ctx.shadowOffsetY = 2;
  ctx.drawImage(edge, 0, 0);
  ctx.restore();
  ctx.drawImage(img, x, y, dw, dh);
  return c.convertToBlob({ type: 'image/png' });
}
