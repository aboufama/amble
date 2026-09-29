/** Crops a PNG from the output folder and enlarges it. Usage: node dev/rig/node/run.mjs crop in.png x y w h zoom out.png */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { blank, blit } from './draw';
import { decodePng, encodePng } from './png';

const OUT = process.env.RIG_OUT ?? 'out';

export function runCrop(args: string[]): void {
  const [file, xs, ys, ws, hs, zs, outName] = args;
  const src = decodePng(readFileSync(join(OUT, file)));
  const x0 = Number(xs), y0 = Number(ys), w = Number(ws), h = Number(hs), z = Number(zs);
  const crop = blank(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const sx = x0 + x, sy = y0 + y;
    if (sx < 0 || sy < 0 || sx >= src.width || sy >= src.height) continue;
    crop.data.set(src.data.subarray((sy * src.width + sx) * 4, (sy * src.width + sx) * 4 + 4), (y * w + x) * 4);
  }
  const big = blank(w * z, h * z);
  blit(big, crop, 0, 0, z);
  writeFileSync(join(OUT, outName ?? `crop-${file}`), encodePng(big));
}
