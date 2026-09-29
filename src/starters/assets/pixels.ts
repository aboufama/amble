/**
 * Pixel helpers for building the starter assets at build time (Node or a browser; straight alpha RGBA):
 * compositing a part's lines over its colours, resizing, and the sticker's cream die-cut edge.
 */
export interface Rgba {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

export function blank(width: number, height: number): Rgba {
  return { data: new Uint8ClampedArray(width * height * 4), width, height };
}

/** Draws `src` over `dst` at (dx, dy) (source-over, straight alpha). */
export function over(dst: Rgba, src: Rgba, dx = 0, dy = 0): void {
  for (let y = 0; y < src.height; y++) {
    const ty = y + dy;
    if (ty < 0 || ty >= dst.height) continue;
    for (let x = 0; x < src.width; x++) {
      const tx = x + dx;
      if (tx < 0 || tx >= dst.width) continue;
      const s = (y * src.width + x) * 4;
      const sa = src.data[s + 3] / 255;
      if (sa <= 0) continue;
      const d = (ty * dst.width + tx) * 4;
      const da = dst.data[d + 3] / 255;
      const oa = sa + da * (1 - sa);
      for (let c = 0; c < 3; c++) dst.data[d + c] = Math.round((src.data[s + c] * sa + dst.data[d + c] * da * (1 - sa)) / oa);
      dst.data[d + 3] = Math.round(oa * 255);
    }
  }
}

/** Area-average resize (premultiplied, so edges never go dark). */
export function resize(src: Rgba, tw: number, th: number): Rgba {
  const out = blank(tw, th);
  const sx = src.width / tw;
  const sy = src.height / th;
  for (let y = 0; y < th; y++) {
    const y0 = y * sy;
    const y1 = Math.min(src.height, (y + 1) * sy);
    for (let x = 0; x < tw; x++) {
      const x0 = x * sx;
      const x1 = Math.min(src.width, (x + 1) * sx);
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let area = 0;
      for (let yy = Math.floor(y0); yy < Math.ceil(y1); yy++) {
        const wy = Math.min(y1, yy + 1) - Math.max(y0, yy);
        for (let xx = Math.floor(x0); xx < Math.ceil(x1); xx++) {
          const w = (Math.min(x1, xx + 1) - Math.max(x0, xx)) * wy;
          const i = (yy * src.width + xx) * 4;
          const al = (src.data[i + 3] / 255) * w;
          r += src.data[i] * al;
          g += src.data[i + 1] * al;
          b += src.data[i + 2] * al;
          a += al;
          area += w;
        }
      }
      const o = (y * tw + x) * 4;
      if (a > 0) {
        out.data[o] = r / a;
        out.data[o + 1] = g / a;
        out.data[o + 2] = b / a;
      }
      out.data[o + 3] = area > 0 ? (a / area) * 255 : 0;
    }
  }
  return out;
}

/** The smallest box around pixels whose alpha is above `threshold`, or null for an empty image. */
export function opaqueBox(p: Rgba, threshold = 8): { x: number; y: number; w: number; h: number } | null {
  let x0 = p.width;
  let y0 = p.height;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < p.height; y++) {
    for (let x = 0; x < p.width; x++) {
      if (p.data[(y * p.width + x) * 4 + 3] <= threshold) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      y1 = y;
    }
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/** Parses '#rrggbb'. */
export function hexRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * The UI sticker (§1.1): the drawing fitted into a `size` square with a cream die-cut edge `edge` px wide
 * (the alpha grown by a disc, softened by half a pixel), the drawing on top. Never used in games.
 */
export function sticker(flat: Rgba, size = 256, edge = 3, cream = '#fdf8ec'): Rgba {
  const inner = size - 2 * (edge + 2);
  const k = Math.min(1, inner / Math.max(flat.width, flat.height));
  const w = Math.max(1, Math.round(flat.width * k));
  const h = Math.max(1, Math.round(flat.height * k));
  const art = k === 1 ? flat : resize(flat, w, h);
  const out = blank(size, size);
  const ox = Math.round((size - w) / 2);
  const oy = Math.round((size - h) / 2);
  const [cr, cg, cb] = hexRgb(cream);
  const r2 = (edge + 0.5) * (edge + 0.5);
  const reach = Math.ceil(edge + 1);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let best = 0;
      for (let dy = -reach; dy <= reach && best < 255; dy++) {
        const sy = y - oy + dy;
        if (sy < 0 || sy >= h) continue;
        for (let dx = -reach; dx <= reach; dx++) {
          const d2 = dx * dx + dy * dy;
          if (d2 > r2 + reach) continue;
          const sx = x - ox + dx;
          if (sx < 0 || sx >= w) continue;
          const a = art.data[(sy * w + sx) * 4 + 3];
          // Full strength inside the disc, fading over the last pixel: a smooth die-cut line.
          const fall = d2 <= r2 ? 1 : Math.max(0, 1 - (Math.sqrt(d2) - Math.sqrt(r2)));
          const v = a * fall;
          if (v > best) best = v;
        }
      }
      if (best <= 0) continue;
      const o = (y * size + x) * 4;
      out.data[o] = cr;
      out.data[o + 1] = cg;
      out.data[o + 2] = cb;
      out.data[o + 3] = Math.min(255, best * 1.6);
    }
  }
  over(out, art, ox, oy);
  return out;
}
