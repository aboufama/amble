/**
 * The Trail's walkers (§2.4, §3.6): each character's walk (and idle) move baked into an 8-frame strip in
 * the rig worker, played with CSS `steps(8)`. Strips are made lazily and kept in `Store.cache` under
 * `strip:<artHash>:<rigHash>` (the idle strip adds `:idle`), so a Trail visit after the first costs no
 * rig work at all.
 */
import type { RigData } from '../cores/rig';
import type { BlobRef } from '../model/types';
import type { Store } from '../store/api';

export type StripClip = 'walk' | 'idle';

export interface Strip {
  /** Object URL of the packed strip (frames side by side). */
  url: string;
  frames: number;
  frameW: number;
  frameH: number;
  /** Feet inside a frame (px). */
  footX: number;
  footY: number;
  /** Seconds per loop. */
  dur: number;
}

interface CachedStrip {
  png: Blob;
  frames: number;
  frameW: number;
  frameH: number;
  footX: number;
  footY: number;
  dur: number;
}

export interface StripSource {
  artHash: string;
  /** The flat drawing in the store, or the picture itself (starter drawings are not in the store). */
  flat: BlobRef | Blob | null;
  rig: RigData;
}

export const STRIP_FRAMES = 8;
const STRIP_SIZE = 144;

export function stripKey(artHash: string, rigHash: string, clip: StripClip): string {
  return clip === 'walk' ? `strip:${artHash}:${rigHash}` : `strip:${artHash}:${rigHash}:${clip}`;
}

function isCachedStrip(v: unknown): v is CachedStrip {
  if (!v || typeof v !== 'object') return false;
  const c = v as Partial<CachedStrip>;
  return c.png instanceof Blob && typeof c.frameW === 'number' && typeof c.frameH === 'number' && typeof c.frames === 'number';
}

async function bitmapToPng(bmp: ImageBitmap): Promise<Blob> {
  if (typeof OffscreenCanvas !== 'undefined') {
    const c = new OffscreenCanvas(bmp.width, bmp.height);
    c.getContext('2d')?.drawImage(bmp, 0, 0);
    return c.convertToBlob({ type: 'image/png' });
  }
  const c = document.createElement('canvas');
  c.width = bmp.width;
  c.height = bmp.height;
  c.getContext('2d')?.drawImage(bmp, 0, 0);
  const blob = await new Promise<Blob | null>((resolve) => c.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('The strip could not be saved');
  return blob;
}

const made = new Map<string, Promise<Strip | null>>();

async function makeStrip(store: Store, src: StripSource, clip: StripClip, key: string): Promise<Strip | null> {
  const cached = await store.cache.get<unknown>(key).catch(() => null);
  let entry: CachedStrip | null = isCachedStrip(cached) ? cached : null;
  if (!entry) {
    const flat = src.flat instanceof Blob ? src.flat : src.flat ? await store.blobs.get(src.flat) : null;
    if (!flat) return null;
    const { rigWorker } = await import('../cores/rig');
    const { meta, frames } = await rigWorker.strip({ image: flat }, src.rig, clip, { frames: STRIP_FRAMES, size: STRIP_SIZE, face: 1, packed: true, lane: `strip:${src.artHash}:${clip}` });
    const bmp = frames[0];
    if (!bmp) return null;
    const png = await bitmapToPng(bmp);
    bmp.close();
    entry = { png, frames: STRIP_FRAMES, frameW: meta.width, frameH: meta.height, footX: meta.anchorX, footY: meta.anchorY, dur: meta.dur || 0.8 };
    await store.cache.put(key, entry).catch(() => undefined);
  }
  return { url: URL.createObjectURL(entry.png), frames: entry.frames, frameW: entry.frameW, frameH: entry.frameH, footX: entry.footX, footY: entry.footY, dur: entry.dur };
}

/** A character's strip for a move (made once per page, then from the cache). Null when it cannot be made. */
export async function stripFor(store: Store, src: StripSource, clip: StripClip): Promise<Strip | null> {
  const { hashRig } = await import('../cores/rig');
  const key = stripKey(src.artHash, hashRig(src.rig), clip);
  let strip = made.get(key);
  if (!strip) {
    strip = makeStrip(store, src, clip, key).catch((err: unknown) => {
      console.warn('A walk strip could not be made:', err);
      made.delete(key);
      return null;
    });
    made.set(key, strip);
  }
  return strip;
}
