/**
 * Pixel compositing on straight-alpha RGBA8 buffers (the layers' source of truth lives on the CPU, so a
 * stroke commit, a fill, an undo or an export never waits on a GPU readback, and replay runs in Node).
 * The live preview and the commit use the same functions, so what you see while drawing is the result.
 */
import type { Rect } from './geom';
import type { RGB } from './color';

/** Stroke blend: normal paint, multiply (marker), erase, and paint only where the layer has pixels (alpha lock). */
export type BlendMode = 'over' | 'multiply' | 'erase' | 'atop';

export type LayerBlend = 'normal' | 'multiply';

/**
 * Blends a solid colour with coverage max(prefix, tail) * opacity into `src` over rect r, writing to `out`
 * (which may be `src` itself). Buffers are W pixels wide; coverage buffers are one float per pixel.
 */
export function blendCoverage(
  src: Uint8ClampedArray,
  out: Uint8ClampedArray,
  W: number,
  r: Rect,
  prefix: Float32Array,
  tail: Float32Array | null,
  rgb: RGB,
  opacity: number,
  mode: BlendMode,
): void {
  const [R, G, B] = rgb;
  const copy = out !== src;
  for (let y = r.y0; y < r.y1; y++) {
    let i = y * W + r.x0;
    let j = i * 4;
    for (let x = r.x0; x < r.x1; x++, i++, j += 4) {
      let c = prefix[i];
      if (tail !== null) {
        const t = tail[i];
        if (t > c) c = t;
      }
      const a = c * opacity;
      if (a <= 0) {
        if (copy) {
          out[j] = src[j];
          out[j + 1] = src[j + 1];
          out[j + 2] = src[j + 2];
          out[j + 3] = src[j + 3];
        }
        continue;
      }
      const ad = src[j + 3] / 255;
      if (mode === 'over') {
        const ao = a + ad * (1 - a);
        const kd = (ad * (1 - a)) / ao;
        const ks = a / ao;
        out[j] = R * ks + src[j] * kd;
        out[j + 1] = G * ks + src[j + 1] * kd;
        out[j + 2] = B * ks + src[j + 2] * kd;
        out[j + 3] = ao * 255;
      } else if (mode === 'erase') {
        if (copy) {
          out[j] = src[j];
          out[j + 1] = src[j + 1];
          out[j + 2] = src[j + 2];
        }
        out[j + 3] = ad * (1 - a) * 255;
        // Fully erased pixels become all zero (smaller PNGs, canonical pixels).
        if (out[j + 3] === 0) out[j] = out[j + 1] = out[j + 2] = 0;
      } else if (mode === 'atop') {
        if (ad <= 0) {
          if (copy) out[j] = out[j + 1] = out[j + 2] = out[j + 3] = 0;
          continue;
        }
        out[j] = R * a + src[j] * (1 - a);
        out[j + 1] = G * a + src[j + 1] * (1 - a);
        out[j + 2] = B * a + src[j + 2] * (1 - a);
        out[j + 3] = src[j + 3];
      } else {
        // multiply (W3C separable blend, then source-over)
        const ao = a + ad * (1 - a);
        const s1 = a * (1 - ad);
        const s2 = a * ad;
        const s3 = (1 - a) * ad;
        const inv = 1 / ao;
        out[j] = (s1 * R + (s2 * R * src[j]) / 255 + s3 * src[j]) * inv;
        out[j + 1] = (s1 * G + (s2 * G * src[j + 1]) / 255 + s3 * src[j + 1]) * inv;
        out[j + 2] = (s1 * B + (s2 * B * src[j + 2]) / 255 + s3 * src[j + 2]) * inv;
        out[j + 3] = ao * 255;
      }
    }
  }
}

/**
 * Composites layer pixels `src` onto `dst` (both W wide, straight RGBA) over rect r (or everything) with
 * the layer's opacity and blend.
 */
export function compositeLayer(dst: Uint8ClampedArray, src: Uint8ClampedArray, W: number, H: number, r: Rect | null, opacity: number, blend: LayerBlend): void {
  const x0 = r ? r.x0 : 0;
  const y0 = r ? r.y0 : 0;
  const x1 = r ? r.x1 : W;
  const y1 = r ? r.y1 : H;
  const mul = blend === 'multiply';
  for (let y = y0; y < y1; y++) {
    let j = (y * W + x0) * 4;
    for (let x = x0; x < x1; x++, j += 4) {
      const sa = src[j + 3];
      if (sa === 0) continue;
      const a = (sa / 255) * opacity;
      const ad = dst[j + 3] / 255;
      const ao = a + ad * (1 - a);
      if (ao <= 0) continue;
      const inv = 1 / ao;
      if (mul) {
        const s1 = a * (1 - ad);
        const s2 = a * ad;
        const s3 = (1 - a) * ad;
        for (let k = 0; k < 3; k++) dst[j + k] = (s1 * src[j + k] + (s2 * src[j + k] * dst[j + k]) / 255 + s3 * dst[j + k]) * inv;
      } else {
        const ks = a * inv;
        const kd = ad * (1 - a) * inv;
        dst[j] = src[j] * ks + dst[j] * kd;
        dst[j + 1] = src[j + 1] * ks + dst[j + 1] * kd;
        dst[j + 2] = src[j + 2] * ks + dst[j + 2] * kd;
      }
      dst[j + 3] = ao * 255;
    }
  }
}

/** Copies rect r of an RGBA buffer W wide into a new tightly packed buffer. */
export function copyOut(src: Uint8ClampedArray, W: number, r: Rect): Uint8ClampedArray {
  const w = r.x1 - r.x0;
  const out = new Uint8ClampedArray(w * (r.y1 - r.y0) * 4);
  for (let y = r.y0; y < r.y1; y++) out.set(src.subarray((y * W + r.x0) * 4, (y * W + r.x1) * 4), (y - r.y0) * w * 4);
  return out;
}

/** Writes a tightly packed rect (from copyOut) back into an RGBA buffer W wide; null clears the rect. */
export function copyIn(dst: Uint8ClampedArray, W: number, r: Rect, data: Uint8ClampedArray | null): void {
  const w = r.x1 - r.x0;
  for (let y = r.y0; y < r.y1; y++) {
    if (data) dst.set(data.subarray((y - r.y0) * w * 4, (y - r.y0 + 1) * w * 4), (y * W + r.x0) * 4);
    else dst.fill(0, (y * W + r.x0) * 4, (y * W + r.x1) * 4);
  }
}

/**
 * True when every byte of rect r is zero: such a tile can be stored as null and restored exactly (a
 * transparent tile may still hold colour bytes, which replays reproduce).
 */
export function isZero(src: Uint8ClampedArray, W: number, r: Rect): boolean {
  if (src.byteOffset % 4 === 0) {
    const u32 = new Uint32Array(src.buffer, src.byteOffset, src.length >> 2);
    for (let y = r.y0; y < r.y1; y++) {
      const end = y * W + r.x1;
      for (let i = y * W + r.x0; i < end; i++) if (u32[i] !== 0) return false;
    }
    return true;
  }
  for (let y = r.y0; y < r.y1; y++) {
    const end = (y * W + r.x1) * 4;
    for (let j = (y * W + r.x0) * 4; j < end; j++) if (src[j] !== 0) return false;
  }
  return true;
}

/** Bounding box of pixels with alpha > threshold, or null when there are none. */
export function alphaBounds(src: Uint8ClampedArray, W: number, H: number, threshold = 0): Rect | null {
  let x0 = W;
  let y0 = H;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < H; y++) {
    let j = y * W * 4 + 3;
    let first = -1;
    let last = -1;
    for (let x = 0; x < W; x++, j += 4) {
      if (src[j] > threshold) {
        if (first < 0) first = x;
        last = x;
      }
    }
    if (first < 0) continue;
    if (first < x0) x0 = first;
    if (last > x1) x1 = last;
    if (y < y0) y0 = y;
    y1 = y;
  }
  return x1 < 0 ? null : { x0, y0, x1: x1 + 1, y1: y1 + 1 };
}

/**
 * Paints a solid colour through a fill mask (coverage 0..255 over `box`, row-major) into dst (W wide).
 * `behind`: the whole fill goes under existing pixels (filling empty space never covers what is there).
 * Otherwise pixels flagged in `under` go behind (the fill tucked under same-layer ink) and the rest are
 * painted over (recolouring).
 */
export function blendMask(dst: Uint8ClampedArray, W: number, box: Rect, mask: Uint8Array, under: Uint8Array | null, rgb: RGB, behind: boolean): void {
  const [R, G, B] = rgb;
  const bw = box.x1 - box.x0;
  for (let y = box.y0; y < box.y1; y++) {
    let k = (y - box.y0) * bw;
    let j = (y * W + box.x0) * 4;
    for (let x = box.x0; x < box.x1; x++, k++, j += 4) {
      const m = mask[k];
      if (m === 0) continue;
      const a = m / 255;
      const ad = dst[j + 3] / 255;
      if (behind || (under !== null && under[k] === 1)) {
        // destination-over: existing pixels stay on top.
        const ao = ad + a * (1 - ad);
        if (ao <= 0) continue;
        const ks = (a * (1 - ad)) / ao;
        const kd = ad / ao;
        dst[j] = dst[j] * kd + R * ks;
        dst[j + 1] = dst[j + 1] * kd + G * ks;
        dst[j + 2] = dst[j + 2] * kd + B * ks;
        dst[j + 3] = ao * 255;
      } else {
        const ao = a + ad * (1 - a);
        const ks = a / ao;
        const kd = (ad * (1 - a)) / ao;
        dst[j] = R * ks + dst[j] * kd;
        dst[j + 1] = G * ks + dst[j + 1] * kd;
        dst[j + 2] = B * ks + dst[j + 2] * kd;
        dst[j + 3] = ao * 255;
      }
    }
  }
}
