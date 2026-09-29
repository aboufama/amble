/**
 * Pictures and sounds from outside Amble, made into what Amble keeps (§4.7): any image (PNG, JPEG, GIF,
 * WebP; SVG rasterized, never kept as SVG) becomes a trimmed PNG with its thumbnail and sticker; any
 * sound becomes WAV or WebM. Canvas and audio decoding happen here, behind small interfaces, so the
 * import logic is testable without a browser.
 */
import { PAPER } from '../ui/tokens';

/** The bytes of a `data:` URL (base64 or percent-encoded), without any network request. */
export function dataUrlBytes(url: string): { bytes: Uint8Array; mime: string } {
  const m = /^data:([^,]*?),(.*)$/s.exec(url);
  if (!m) throw new Error('Not a data URL.');
  const meta = m[1].split(';');
  const mime = (meta[0] || 'application/octet-stream').toLowerCase();
  const body = m[2];
  if (meta.includes('base64')) {
    const bin = atob(body.replace(/\s+/g, ''));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return { bytes, mime };
  }
  return { bytes: new TextEncoder().encode(decodeURIComponent(body)), mime };
}

export interface PreparedPicture {
  /** The whole picture on its board (the drawing's one paint layer). */
  board: { png: Blob; w: number; h: number };
  /** The trimmed picture (what games load) and where it sits on the board. */
  flat: { png: Blob; w: number; h: number; x: number; y: number };
  /** RGBA pixels of the flat (for the auto-rig). */
  pixels: { data: Uint8ClampedArray; width: number; height: number } | null;
  thumb: Blob;
  sticker: Blob;
}

export interface PictureMaker {
  /** `scale` enlarges small pictures (old SVGs at 2x); the board never passes `maxSide`. Null when the picture is empty. */
  prepare(bytes: Uint8Array, mime: string, o: { scale: number; maxSide: number; width?: number; height?: number }): Promise<PreparedPicture | null>;
}

export interface SoundMaker {
  /** WAV or WebM bytes for any sound the browser can decode (MP3, OGG...); null when it can't. */
  toKept(bytes: Uint8Array): Promise<{ bytes: Uint8Array; mime: 'audio/wav' | 'audio/webm'; duration: number } | null>;
}

// ------------------------------------------------------------------ the browser's picture maker

type Canvas2D = OffscreenCanvasRenderingContext2D;

function canvas(w: number, h: number): { c: OffscreenCanvas; g: Canvas2D } {
  const c = new OffscreenCanvas(Math.max(1, Math.round(w)), Math.max(1, Math.round(h)));
  const g = c.getContext('2d');
  if (!g) throw new Error('No 2D canvas here.');
  return { c, g };
}

async function decode(bytes: Uint8Array, mime: string, width?: number, height?: number): Promise<{ source: CanvasImageSource; w: number; h: number; done(): void }> {
  const blob = new Blob([bytes as Uint8Array<ArrayBuffer>], { type: mime });
  if (mime !== 'image/svg+xml') {
    const bmp = await createImageBitmap(blob);
    return { source: bmp, w: bmp.width, h: bmp.height, done: () => bmp.close() };
  }
  // SVG only decodes through an <img>; it is drawn once onto a canvas and never kept.
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    const w = img.naturalWidth || width || 480;
    const h = img.naturalHeight || height || 360;
    return { source: img, w, h, done: () => URL.revokeObjectURL(url) };
  } catch (err) {
    URL.revokeObjectURL(url);
    throw err;
  }
}

function alphaBox(data: Uint8ClampedArray, w: number, h: number): { x: number; y: number; w: number; h: number } | null {
  let x0 = w;
  let y0 = h;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] > 8) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

const png = (c: OffscreenCanvas) => c.convertToBlob({ type: 'image/png' });

/** A 256 px sticker: the drawing on a 3 px cream die-cut edge with a soft shadow (UI only). */
async function sticker(src: OffscreenCanvas): Promise<Blob> {
  const S = 256;
  const pad = 12;
  const k = Math.min((S - 2 * pad) / src.width, (S - 2 * pad) / src.height, 4);
  const w = src.width * k;
  const h = src.height * k;
  const x = (S - w) / 2;
  const y = (S - h) / 2;
  const edge = canvas(S, S);
  for (let a = 0; a < 16; a++) {
    const t = (a / 16) * Math.PI * 2;
    edge.g.drawImage(src, x + Math.cos(t) * 3, y + Math.sin(t) * 3, w, h);
  }
  edge.g.globalCompositeOperation = 'source-in';
  edge.g.fillStyle = PAPER.paper;
  edge.g.fillRect(0, 0, S, S);
  const out = canvas(S, S);
  out.g.shadowColor = 'rgba(4, 5, 20, 0.35)';
  out.g.shadowBlur = 6;
  out.g.shadowOffsetY = 2;
  out.g.drawImage(edge.c, 0, 0);
  out.g.shadowColor = 'transparent';
  out.g.drawImage(src, x, y, w, h);
  return png(out.c);
}

export const browserPictures: PictureMaker = {
  async prepare(bytes, mime, o) {
    const img = await decode(bytes, mime, o.width, o.height);
    try {
      const k = Math.min(o.scale, o.maxSide / img.w, o.maxSide / img.h);
      const board = canvas(img.w * k, img.h * k);
      board.g.imageSmoothingQuality = 'high';
      board.g.drawImage(img.source, 0, 0, board.c.width, board.c.height);
      const data = board.g.getImageData(0, 0, board.c.width, board.c.height).data;
      const box = alphaBox(data, board.c.width, board.c.height);
      if (!box) return null;
      const flat = canvas(box.w, box.h);
      flat.g.drawImage(board.c, box.x, box.y, box.w, box.h, 0, 0, box.w, box.h);
      const tk = Math.min(1, 128 / Math.max(box.w, box.h));
      const thumb = canvas(box.w * tk, box.h * tk);
      thumb.g.imageSmoothingQuality = 'high';
      thumb.g.drawImage(flat.c, 0, 0, thumb.c.width, thumb.c.height);
      return {
        board: { png: await png(board.c), w: board.c.width, h: board.c.height },
        flat: { png: await png(flat.c), w: box.w, h: box.h, x: box.x, y: box.y },
        pixels: flat.g.getImageData(0, 0, box.w, box.h),
        thumb: await png(thumb.c),
        sticker: await sticker(flat.c),
      };
    } finally {
      img.done();
    }
  },
};

// ------------------------------------------------------------------ the browser's sound maker

/** 16-bit mono PCM WAV. */
export function encodeWav(samples: Float32Array, sampleRate: number): Uint8Array {
  const out = new Uint8Array(44 + samples.length * 2);
  const v = new DataView(out.buffer);
  const str = (at: number, s: string) => [...s].forEach((c, i) => v.setUint8(at + i, c.charCodeAt(0)));
  str(0, 'RIFF');
  v.setUint32(4, 36 + samples.length * 2, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, 'data');
  v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) v.setInt16(44 + i * 2, Math.round(Math.max(-1, Math.min(1, samples[i])) * 0x7fff), true);
  return out;
}

const MAX_SOUND_S = 60;

export const browserSounds: SoundMaker = {
  async toKept(bytes) {
    const isWav = bytes.length > 12 && String.fromCharCode(...bytes.subarray(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.subarray(8, 12)) === 'WAVE';
    const isWebm = bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3;
    const Ctx = (globalThis as { OfflineAudioContext?: typeof OfflineAudioContext }).OfflineAudioContext;
    if (!Ctx) return isWav ? { bytes, mime: 'audio/wav', duration: 0 } : isWebm ? { bytes, mime: 'audio/webm', duration: 0 } : null;
    try {
      const ctx = new Ctx(1, 1, 22050);
      const buf = await ctx.decodeAudioData(bytes.slice().buffer);
      if (isWav || isWebm) return { bytes, mime: isWav ? 'audio/wav' : 'audio/webm', duration: Math.min(MAX_SOUND_S, buf.duration) };
      const frames = Math.min(buf.length, Math.round(buf.sampleRate * MAX_SOUND_S));
      const mono = new Float32Array(frames);
      for (let ch = 0; ch < buf.numberOfChannels; ch++) {
        const data = buf.getChannelData(ch);
        for (let i = 0; i < frames; i++) mono[i] += data[i] / buf.numberOfChannels;
      }
      return { bytes: encodeWav(mono, buf.sampleRate), mime: 'audio/wav', duration: frames / buf.sampleRate };
    } catch {
      return isWav ? { bytes, mime: 'audio/wav', duration: 0 } : isWebm ? { bytes, mime: 'audio/webm', duration: 0 } : null;
    }
  },
};
