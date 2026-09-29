/**
 * "Use a photo of my drawing" (§2.10): a photo or scan of a paper drawing becomes a Lines layer on the
 * device, nothing sent anywhere. Auto-levels stretch the photo's own range (a grey, shadowed page becomes
 * white paper), then a luminance threshold keeps the ink and drops the paper, with a 2 px feathered edge so
 * the lines stay smooth.
 */

/** Paper is anything at least this bright after levelling (0..1); the ink fades in below it. */
export const PAPER_LEVEL = 0.72;
/** How far below the paper level the ink is fully opaque. */
export const INK_RAMP = 0.22;

function lum(r: number, g: number, b: number): number {
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

/** The darkest and brightest luminance after dropping the 2 % extremes (dust, glare). */
export function levels(rgba: Uint8ClampedArray, W: number, H: number): { lo: number; hi: number } {
  const hist = new Uint32Array(256);
  const n = W * H;
  for (let i = 0; i < n; i++) hist[Math.round(lum(rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]) * 255)]++;
  const cut = n * 0.02;
  let lo = 0;
  let acc = 0;
  while (lo < 255 && acc + hist[lo] <= cut) acc += hist[lo++];
  let hi = 255;
  acc = 0;
  while (hi > 0 && acc + hist[hi] <= cut) acc += hist[hi--];
  if (hi - lo < 16) return { lo: 0, hi: 1 };
  return { lo: lo / 255, hi: hi / 255 };
}

/**
 * Ink from a photo: straight RGBA the same size, the paper transparent, the ink kept in its own (levelled)
 * colour, its alpha from how dark it is, feathered over 2 px.
 */
export function removePaper(rgba: Uint8ClampedArray, W: number, H: number): Uint8ClampedArray {
  const { lo, hi } = levels(rgba, W, H);
  const span = Math.max(1e-3, hi - lo);
  const n = W * H;
  const alpha = new Float32Array(n);
  const out = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < n; i++) {
    const j = i * 4;
    const l = Math.min(1, Math.max(0, (lum(rgba[j], rgba[j + 1], rgba[j + 2]) - lo) / span));
    const t = Math.min(1, Math.max(0, (PAPER_LEVEL - l) / INK_RAMP));
    alpha[i] = t * t * (3 - 2 * t);
    for (let k = 0; k < 3; k++) out[j + k] = Math.min(255, Math.max(0, ((rgba[j + k] / 255 - lo) / span) * 255));
  }
  // Feather: a 3 x 3 box twice (about 2 px), so the edge is smooth but the ink keeps its body.
  let a = alpha;
  for (let pass = 0; pass < 2; pass++) {
    const b = new Float32Array(n);
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        let s = 0;
        let c = 0;
        for (let dy = -1; dy <= 1; dy++) {
          const yy = y + dy;
          if (yy < 0 || yy >= H) continue;
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx;
            if (xx < 0 || xx >= W) continue;
            s += a[yy * W + xx];
            c++;
          }
        }
        // Solid ink stays solid; only its edge softens.
        b[y * W + x] = Math.max(a[y * W + x] >= 0.999 ? 1 : 0, s / c);
      }
    a = b;
  }
  for (let i = 0; i < n; i++) {
    const v = a[i];
    out[i * 4 + 3] = v < 0.02 ? 0 : Math.round(v * 255);
    if (!out[i * 4 + 3]) out[i * 4] = out[i * 4 + 1] = out[i * 4 + 2] = 0;
  }
  return out;
}

/** The size a photo is brought in at: fitted inside the board, never enlarged past it. */
export function fitPhoto(w: number, h: number, boardW: number, boardH: number): { w: number; h: number; x: number; y: number } {
  const k = Math.min(boardW / w, boardH / h);
  const fw = Math.round(w * k);
  const fh = Math.round(h * k);
  return { w: fw, h: fh, x: Math.round((boardW - fw) / 2), y: Math.round((boardH - fh) / 2) };
}
