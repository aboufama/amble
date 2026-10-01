import type * as Phaser from 'phaser';
import type { RunCostume } from '../player/protocol';

/** A costume (or backdrop) as a texture, with its size and rotation center in stage pixels. */
export interface Costume {
  name: string;
  /** Key in Phaser's texture manager. */
  key: string;
  /** Size in stage pixels. */
  width: number;
  height: number;
  /** The rotation center as a fraction of the size, from the top left (Phaser's origin). */
  originX: number;
  originY: number;
  /** Texture pixels per stage pixel (vector costumes are drawn at extra resolution so they stay sharp). */
  density: number;
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not load image'));
    img.src = url;
  });
}

let nextKey = 0;

async function loadCostume(c: RunCostume, textures: Phaser.Textures.TextureManager, prefix: string): Promise<Costume> {
  const img = await loadImage(c.url);
  const res = c.resolution || 1;
  const width = Math.max(1, (c.width || img.naturalWidth || 100) / res);
  const height = Math.max(1, (c.height || img.naturalHeight || 100) / res);
  const cx = (c.centerX ?? (c.width || width * res) / 2) / res;
  const cy = (c.centerY ?? (c.height || height * res) / 2) / res;
  const key = `${prefix}${nextKey++}`;
  let density: number;
  if (c.isVector) {
    // Drawn at up to 3x (at most 2048 pixels across), so it stays sharp when the stage is big or zoomed in.
    density = Math.max(1, Math.min(3, 2048 / Math.max(width, height)));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width * density));
    canvas.height = Math.max(1, Math.round(height * density));
    canvas.getContext('2d')?.drawImage(img, 0, 0, canvas.width, canvas.height);
    textures.addCanvas(key, canvas);
  } else {
    density = (img.naturalWidth || width) / width;
    textures.addImage(key, img);
  }
  return { name: c.name, key, width, height, originX: width ? cx / width : 0.5, originY: height ? cy / height : 0.5, density };
}

/** Loads every costume of one sprite (or the stage's backdrops). Broken costumes are skipped with a warning. */
export async function loadCostumes(costumes: RunCostume[], textures: Phaser.Textures.TextureManager, prefix: string): Promise<Costume[]> {
  const loaded = await Promise.all(
    costumes.map(async (c) => {
      if (c.kind !== 'image') return null;
      try {
        return await loadCostume(c, textures, prefix);
      } catch (err) {
        console.warn(`Could not load costume "${c.name}": ${(err as Error).message}`);
        return null;
      }
    }),
  );
  return loaded.filter((c): c is Costume => c !== null);
}

/** A color name or "#rgb" / "#rrggbb" as a number (0xrrggbb). */
export function parseColor(color: string | number | undefined | null, fallback = 0xffffff): number {
  if (typeof color === 'number' && Number.isFinite(color)) return color;
  const s = String(color ?? '').trim();
  if (!s) return fallback;
  const hex = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(s);
  if (hex) {
    const h = hex[1].length === 3 ? [...hex[1]].map((c) => c + c).join('') : hex[1];
    return parseInt(h, 16);
  }
  try {
    const ctx = document.createElement('canvas').getContext('2d');
    if (ctx) {
      ctx.fillStyle = '#010203';
      ctx.fillStyle = s;
      const parsed = String(ctx.fillStyle);
      if (parsed !== '#010203' || /^(#010203|rgb\(1, 2, 3\))$/i.test(s)) return parseColor(parsed, fallback);
    }
  } catch {
    /* not a color */
  }
  return fallback;
}
