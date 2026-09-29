/**
 * Student drawings as the runtime keeps them: decoded once (Blobs off the main thread with
 * createImageBitmap, data URLs with Image.decode; never premultiplyAlpha 'none', which broke colours in the
 * probe), with their rig data and part layers for the rigged factory.
 */
import type { DrawnArt, ImageSource } from '../../play/protocol';

export type DrawnPixels = ImageBitmap | HTMLImageElement | HTMLCanvasElement;

export interface DrawnImage {
  key: string;
  image: DrawnPixels;
  rig: unknown;
  layers: Record<string, HTMLCanvasElement | ImageBitmap> | undefined;
  /** Bumps every time this key gets a new drawing. */
  version: number;
}

async function decode(src: ImageSource): Promise<DrawnPixels> {
  if (typeof src === 'string') {
    const img = new Image();
    img.src = src;
    await img.decode();
    return img;
  }
  if (src instanceof Blob) return createImageBitmap(src);
  return src;
}

function toCanvas(src: DrawnPixels): HTMLCanvasElement | ImageBitmap {
  if (!(src instanceof HTMLImageElement)) return src;
  const c = document.createElement('canvas');
  c.width = src.naturalWidth;
  c.height = src.naturalHeight;
  c.getContext('2d')?.drawImage(src, 0, 0);
  return c;
}

export function pixelSize(src: DrawnPixels): { w: number; h: number } {
  if (src instanceof HTMLImageElement) return { w: src.naturalWidth, h: src.naturalHeight };
  return { w: src.width, h: src.height };
}

export class DrawnStore {
  private readonly map = new Map<string, DrawnImage>();
  private versions = 0;

  async decode(art: DrawnArt): Promise<DrawnImage> {
    const image = await decode(art.image);
    let layers: DrawnImage['layers'];
    if (art.layers) {
      layers = {};
      for (const [name, src] of Object.entries(art.layers)) {
        try {
          layers[name] = toCanvas(await decode(src));
        } catch {
          /* a broken layer is skipped; the rig falls back to the flat image */
        }
      }
    }
    return { key: art.key, image, rig: art.rig ?? null, layers, version: ++this.versions };
  }

  set(d: DrawnImage): void {
    this.map.set(d.key, d);
  }

  get(key: string): DrawnImage | undefined {
    return this.map.get(key);
  }

  delete(key: string): boolean {
    return this.map.delete(key);
  }

  keys(): string[] {
    return [...this.map.keys()];
  }
}
