/**
 * Lossless PNG encode/decode in TypeScript over the platform's native deflate (CompressionStream), so art
 * round-trips exactly (no premultiplied-alpha rounding through a canvas) and works in workers and Node.
 */

export type DeflateFormat = 'deflate' | 'deflate-raw';

async function pump(data: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const writer = stream.writable.getWriter();
  void writer.write(data as Uint8Array<ArrayBuffer>);
  void writer.close();
  return new Uint8Array(await new Response(stream.readable).arrayBuffer());
}

export function deflate(data: Uint8Array, format: DeflateFormat = 'deflate-raw'): Promise<Uint8Array> {
  return pump(data, new CompressionStream(format));
}

export function inflate(data: Uint8Array, format: DeflateFormat = 'deflate-raw'): Promise<Uint8Array> {
  return pump(data, new DecompressionStream(format));
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes: Uint8Array, from: number, to: number): number {
  let c = 0xffffffff;
  for (let i = from; i < to; i++) c = CRC_TABLE[(c ^ bytes[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  dv.setUint32(8 + data.length, crc32(out, 4, 8 + data.length));
  return out;
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/** Filters every row with the filter (None, Sub, Up or Paeth) that gives the smallest absolute sum. */
function filterRows(px: Uint8Array | Uint8ClampedArray, w: number, h: number, bpp: number): Uint8Array {
  const stride = w * bpp;
  const out = new Uint8Array((stride + 1) * h);
  const cand = [new Uint8Array(stride), new Uint8Array(stride), new Uint8Array(stride), new Uint8Array(stride)];
  const types = [0, 1, 2, 4];
  for (let y = 0; y < h; y++) {
    const row = y * stride;
    const prev = row - stride;
    let best = 0;
    let bestSum = Infinity;
    for (let f = 0; f < 4; f++) {
      const c = cand[f];
      let sum = 0;
      for (let i = 0; i < stride; i++) {
        const x = px[row + i];
        const a = i >= bpp ? px[row + i - bpp] : 0;
        const b = y > 0 ? px[prev + i] : 0;
        const cc = i >= bpp && y > 0 ? px[prev + i - bpp] : 0;
        const v = types[f] === 0 ? x : types[f] === 1 ? x - a : types[f] === 2 ? x - b : x - paeth(a, b, cc);
        const byte = v & 255;
        c[i] = byte;
        sum += byte < 128 ? byte : 256 - byte;
        if (sum >= bestSum) break;
      }
      if (sum < bestSum) {
        bestSum = sum;
        best = f;
      }
    }
    // The winner may have been cut short by the early exit only if it was not the best, so recompute it.
    const c = cand[best];
    const t = types[best];
    for (let i = 0; i < stride; i++) {
      const x = px[row + i];
      const a = i >= bpp ? px[row + i - bpp] : 0;
      const b = y > 0 ? px[prev + i] : 0;
      const cc = i >= bpp && y > 0 ? px[prev + i - bpp] : 0;
      c[i] = (t === 0 ? x : t === 1 ? x - a : t === 2 ? x - b : x - paeth(a, b, cc)) & 255;
    }
    out[y * (stride + 1)] = t;
    out.set(c, y * (stride + 1) + 1);
  }
  return out;
}

/** Encodes straight-alpha RGBA8 as a PNG (colour type 6). */
export async function encodePng(rgba: Uint8Array | Uint8ClampedArray, width: number, height: number): Promise<Uint8Array> {
  if (width < 1 || height < 1 || rgba.length < width * height * 4) throw new Error('encodePng: bad size');
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, width);
  dv.setUint32(4, height);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const idat = await deflate(filterRows(rgba, width, height, 4), 'deflate');
  const parts = [new Uint8Array(SIGNATURE), chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', new Uint8Array(0))];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

export interface DecodedImage {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

/** Decodes 8-bit, non-interlaced PNGs (grey, RGB, palette, grey+alpha, RGBA) to straight RGBA8. */
export async function decodePng(bytes: Uint8Array): Promise<DecodedImage> {
  for (let i = 0; i < 8; i++) if (bytes[i] !== SIGNATURE[i]) throw new Error('decodePng: not a PNG');
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let pos = 8;
  let width = 0;
  let height = 0;
  let depth = 0;
  let ctype = 0;
  let interlace = 0;
  let palette: Uint8Array | null = null;
  let trns: Uint8Array | null = null;
  const idat: Uint8Array[] = [];
  while (pos + 8 <= bytes.length) {
    const len = dv.getUint32(pos);
    const type = String.fromCharCode(bytes[pos + 4], bytes[pos + 5], bytes[pos + 6], bytes[pos + 7]);
    const data = bytes.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      width = dv.getUint32(pos + 8);
      height = dv.getUint32(pos + 12);
      depth = bytes[pos + 16];
      ctype = bytes[pos + 17];
      interlace = bytes[pos + 20];
    } else if (type === 'PLTE') palette = data;
    else if (type === 'tRNS') trns = data;
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    pos += 12 + len;
  }
  if (depth !== 8 || interlace !== 0) throw new Error('decodePng: only 8-bit non-interlaced images');
  const bpp = ctype === 6 ? 4 : ctype === 2 ? 3 : ctype === 4 ? 2 : 1;
  if (![0, 2, 3, 4, 6].includes(ctype)) throw new Error('decodePng: unsupported colour type');
  const joined = new Uint8Array(idat.reduce((n, c) => n + c.length, 0));
  let o = 0;
  for (const c of idat) {
    joined.set(c, o);
    o += c.length;
  }
  const raw = await inflate(joined, 'deflate');
  const stride = width * bpp;
  if (raw.length < (stride + 1) * height) throw new Error('decodePng: truncated image data');
  const px = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)];
    const src = y * (stride + 1) + 1;
    const row = y * stride;
    const prev = row - stride;
    for (let i = 0; i < stride; i++) {
      const x = raw[src + i];
      const a = i >= bpp ? px[row + i - bpp] : 0;
      const b = y > 0 ? px[prev + i] : 0;
      const c = i >= bpp && y > 0 ? px[prev + i - bpp] : 0;
      px[row + i] = (f === 0 ? x : f === 1 ? x + a : f === 2 ? x + b : f === 3 ? x + ((a + b) >> 1) : x + paeth(a, b, c)) & 255;
    }
  }
  const out = new Uint8ClampedArray(width * height * 4);
  if (ctype === 6) out.set(px);
  else
    for (let i = 0, j = 0; i < width * height; i++, j += 4) {
      if (ctype === 2) {
        out[j] = px[i * 3];
        out[j + 1] = px[i * 3 + 1];
        out[j + 2] = px[i * 3 + 2];
        out[j + 3] = 255;
      } else if (ctype === 0) {
        out[j] = out[j + 1] = out[j + 2] = px[i];
        out[j + 3] = 255;
      } else if (ctype === 4) {
        out[j] = out[j + 1] = out[j + 2] = px[i * 2];
        out[j + 3] = px[i * 2 + 1];
      } else {
        const k = px[i];
        if (!palette) throw new Error('decodePng: palette missing');
        out[j] = palette[k * 3];
        out[j + 1] = palette[k * 3 + 1];
        out[j + 2] = palette[k * 3 + 2];
        out[j + 3] = trns && k < trns.length ? trns[k] : 255;
      }
    }
  return { width, height, data: out };
}
