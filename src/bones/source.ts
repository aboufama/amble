/**
 * A drawing as the rig worker wants it (§7.9): the exported flat PNG, its lines-only ink mask as
 * `lines` (the exact ink), and the `part:<name>` composites when it was drawn on the bones. Blobs go
 * to the worker as they are (it decodes them off the main thread); a part cut smaller than the drawing
 * is decoded here once, because its offset has to travel with it.
 */
import type { LayerPixels, Pixels, RigSource } from '../cores/rig';
import type { DrawnArt } from '../cores/play';
import type { ArtRecord } from '../model/types';
import type { Store } from '../store/api';

export interface DrawingSource {
  /** For the worker: bind, re-fit, auto-rig. */
  rig: RigSource;
  /** The flat PNG (the image games show). */
  flat: Blob;
  /** The part composites by layer name (`part:head`), for the hot swap. */
  parts: Record<string, Blob>;
  w: number;
  h: number;
}

/** RGBA pixels of an image blob, straight alpha. */
export async function decodePixels(blob: Blob): Promise<Pixels> {
  const bitmap = await createImageBitmap(blob, { premultiplyAlpha: 'none' });
  try {
    const canvas = typeof OffscreenCanvas !== 'undefined'
      ? new OffscreenCanvas(bitmap.width, bitmap.height)
      : Object.assign(document.createElement('canvas'), { width: bitmap.width, height: bitmap.height });
    const ctx = canvas.getContext('2d', { willReadFrequently: true }) as OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null;
    if (!ctx) throw new Error('No 2D canvas to read the drawing.');
    ctx.drawImage(bitmap, 0, 0);
    const d = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
    return { data: d.data, width: d.width, height: d.height };
  } finally {
    bitmap.close();
  }
}

/** A PNG of pixels (the outline the AI helper may see). */
export async function encodePng(p: Pixels): Promise<Blob> {
  const data = new Uint8ClampedArray(p.data.buffer as ArrayBuffer, p.data.byteOffset, p.width * p.height * 4);
  const image = new ImageData(data, p.width, p.height);
  if (typeof OffscreenCanvas !== 'undefined') {
    const c = new OffscreenCanvas(p.width, p.height);
    c.getContext('2d')?.putImageData(image, 0, 0);
    return c.convertToBlob({ type: 'image/png' });
  }
  const c = Object.assign(document.createElement('canvas'), { width: p.width, height: p.height });
  c.getContext('2d')?.putImageData(image, 0, 0);
  return new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error('No PNG'))), 'image/png'));
}

/** The drawing's blobs from the store, or null when it has never been brought to life. */
export async function loadDrawingSource(store: Store, record: ArtRecord): Promise<DrawingSource | null> {
  const ex = record.export;
  if (!ex) return null;
  const flat = await store.blobs.get(ex.flat);
  if (!flat) return null;
  const layers: Record<string, Blob | LayerPixels> = {};
  if (ex.inkMask) {
    const mask = await store.blobs.get(ex.inkMask);
    if (mask) layers.lines = mask;
  }
  const parts: Record<string, Blob> = {};
  for (const [name, part] of Object.entries(ex.parts)) {
    const blob = await store.blobs.get(part.blob);
    if (!blob) continue;
    const key = name.startsWith('part:') ? name : `part:${name}`;
    parts[key] = blob;
    const whole = !part.x && !part.y && part.w === ex.w && part.h === ex.h;
    layers[key] = whole ? blob : { ...(await decodePixels(blob)), x: part.x, y: part.y };
  }
  const rig: RigSource = Object.keys(layers).length ? { image: flat, layers } : { image: flat };
  return { rig, flat, parts, w: ex.w, h: ex.h };
}

/** What the running world gets on Done: the drawing with its new bones (§6.5's hot swap). */
export function drawnArtOf(key: string, source: DrawingSource, rig: DrawnArt['rig']): DrawnArt {
  const art: DrawnArt = { key, image: source.flat, rig };
  if (Object.keys(source.parts).length) art.layers = { ...source.parts };
  return art;
}
