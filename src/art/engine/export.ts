/**
 * Export for the game and the rigger: the flattened, trimmed, transparent PNG with an anchor; per-layer
 * PNGs (the rigger's parts); the lines layers alone (the rigger's ink mask); a thumbnail; flipbook frames.
 * Master art is PNG (Chrome's WebP is not lossless). Sketch and trace layers, and the guide, never export.
 */
import type { Rect } from './geom';
import type { Board } from './board';
import { compositeLayer } from './blend';
import { type ArtKind, EXPORTED_ROLES, type LayerRole, partName } from './model';
import { encodePng } from './png';
import { toHex } from './color';

export interface PngImage {
  png: Blob;
  w: number;
  h: number;
}

export interface LayerExport extends PngImage {
  layerId: string;
  name: string;
  role: LayerRole;
  /** Body part name for `part:<name>` layers. */
  part: string | null;
  /** Offset within the flat image, in flat px. */
  x: number;
  y: number;
}

export interface ArtExport {
  /** The flattened, trimmed, transparent image at `scale`. */
  flat: PngImage;
  /** Trim box on the board, board px: [x, y, w, h]. */
  box: [number, number, number, number];
  /** Export px per board px. */
  scale: number;
  /** The anchor (pivot) in flat px, and on the board. */
  anchor: [number, number];
  anchorBoard: [number, number];
  /** Exported layers, each trimmed, placed within the flat image. */
  layers: LayerExport[];
  /** Visible lines layers alone, the same size and place as the flat (null without line art). */
  linesMask: PngImage | null;
  /**
   * The body parts asked for with `pairs` (drawing on the bones): each part's layers composited in order
   * (its colours, then its lines over them), the same size and place as the flat, as the rigger and the
   * game's rigged characters read them.
   */
  parts: Array<PngImage & { name: string }>;
  thumb: PngImage;
}

export interface ExportOptions {
  frame?: string;
  kind?: ArtKind;
  /** Anchor override in board px (the ArtDoc's `anchor`). */
  anchor?: [number, number] | null;
  /** Export px per board px (default 1); ignored when maxSize is smaller. */
  scale?: number;
  /** Longest side of the flat, px (default: no limit). */
  maxSize?: number;
  /** Thumbnail longest side (default 256). */
  thumbSize?: number;
  /** Skip the per-layer images and the mask (faster previews). */
  flatOnly?: boolean;
  /** Body parts to composite (their layer ids, bottom to top), even with `flatOnly`. */
  pairs?: Array<{ name: string; layers: string[] }>;
}

/** Visible, exported layers of a frame composited on transparency (or just the given layers). */
export function flatten(board: Board, frame: string, only?: (id: string, role: LayerRole) => boolean): Uint8ClampedArray {
  const { W, H } = board;
  const out = new Uint8ClampedArray(W * H * 4);
  for (const l of board.layers) {
    const use = only ? only(l.id, l.role) : l.visible && EXPORTED_ROLES(l.role);
    if (!use) continue;
    const d = board.pixels(frame, l.id);
    if (d) compositeLayer(out, d, W, H, null, l.opacity, l.blend);
  }
  return out;
}

/** Box of pixels with alpha above `threshold` (default: ignores dust under 1%). */
export function trimBox(rgba: Uint8ClampedArray, W: number, H: number, threshold = 2): Rect | null {
  let x0 = W;
  let y0 = H;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < H; y++) {
    let j = y * W * 4 + 3;
    for (let x = 0; x < W; x++, j += 4)
      if (rgba[j] > threshold) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        y1 = y;
      }
  }
  return x1 < 0 ? null : { x0, y0, x1: x1 + 1, y1: y1 + 1 };
}

/**
 * The automatic anchor on the board: characters stand on the centre of their feet (the opaque pixels in the
 * bottom 4% of rows); terrain hangs from its top centre; backgrounds and everything else use the centre.
 */
export function autoAnchor(kind: ArtKind, rgba: Uint8ClampedArray, W: number, box: Rect): [number, number] {
  const cx = (box.x0 + box.x1) / 2;
  if (kind === 'character') {
    const h = box.y1 - box.y0;
    const from = Math.max(box.y0, Math.floor(box.y1 - Math.max(1, h * 0.04)));
    let sx = 0;
    let n = 0;
    for (let y = from; y < box.y1; y++)
      for (let x = box.x0; x < box.x1; x++)
        if (rgba[(y * W + x) * 4 + 3] > 128) {
          sx += x + 0.5;
          n++;
        }
    return [n ? sx / n : cx, box.y1];
  }
  if (kind === 'terrain') return [cx, box.y0];
  return [cx, (box.y0 + box.y1) / 2];
}

export function crop(rgba: Uint8ClampedArray, W: number, r: Rect): Uint8ClampedArray {
  const w = r.x1 - r.x0;
  const out = new Uint8ClampedArray(w * (r.y1 - r.y0) * 4);
  for (let y = r.y0; y < r.y1; y++) out.set(rgba.subarray((y * W + r.x0) * 4, (y * W + r.x1) * 4), (y - r.y0) * w * 4);
  return out;
}

/** Resizes by halving steps (premultiplied box filter) then one bilinear pass: crisp, no aliasing. */
export function resize(src: Uint8ClampedArray, w: number, h: number, tw: number, th: number): Uint8ClampedArray {
  let cur = src;
  let cw = w;
  let ch = h;
  while (cw >= tw * 2 && ch >= th * 2) {
    const w2 = cw >> 1;
    const h2 = ch >> 1;
    const out = new Uint8ClampedArray(w2 * h2 * 4);
    for (let y = 0; y < h2; y++)
      for (let x = 0; x < w2; x++) {
        let r = 0;
        let g = 0;
        let b = 0;
        let a = 0;
        for (let d = 0; d < 4; d++) {
          const j = ((y * 2 + (d >> 1)) * cw + x * 2 + (d & 1)) * 4;
          const al = cur[j + 3];
          r += cur[j] * al;
          g += cur[j + 1] * al;
          b += cur[j + 2] * al;
          a += al;
        }
        const o = (y * w2 + x) * 4;
        if (a > 0) {
          out[o] = r / a;
          out[o + 1] = g / a;
          out[o + 2] = b / a;
        }
        out[o + 3] = a / 4;
      }
    cur = out;
    cw = w2;
    ch = h2;
  }
  if (cw === tw && ch === th) return cur === src ? src.slice() : cur;
  const out = new Uint8ClampedArray(tw * th * 4);
  const sx = cw / tw;
  const sy = ch / th;
  for (let y = 0; y < th; y++) {
    const fy = Math.min(ch - 1, Math.max(0, (y + 0.5) * sy - 0.5));
    const y0 = Math.floor(fy);
    const y1 = Math.min(ch - 1, y0 + 1);
    const ty = fy - y0;
    for (let x = 0; x < tw; x++) {
      const fx = Math.min(cw - 1, Math.max(0, (x + 0.5) * sx - 0.5));
      const x0 = Math.floor(fx);
      const x1 = Math.min(cw - 1, x0 + 1);
      const tx = fx - x0;
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (const [xx, yy, wgt] of [
        [x0, y0, (1 - tx) * (1 - ty)],
        [x1, y0, tx * (1 - ty)],
        [x0, y1, (1 - tx) * ty],
        [x1, y1, tx * ty],
      ]) {
        const j = (yy * cw + xx) * 4;
        const al = (cur[j + 3] / 255) * wgt;
        r += cur[j] * al;
        g += cur[j + 1] * al;
        b += cur[j + 2] * al;
        a += al;
      }
      const o = (y * tw + x) * 4;
      if (a > 0) {
        out[o] = r / a;
        out[o + 1] = g / a;
        out[o + 2] = b / a;
      }
      out[o + 3] = a * 255;
    }
  }
  return out;
}

export async function pngBlob(rgba: Uint8ClampedArray, w: number, h: number): Promise<PngImage> {
  const bytes = await encodePng(rgba, w, h);
  return { png: new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'image/png' }), w, h };
}

/** Scales a board-px rect region to export px (rounded outward). */
function scaledSize(w: number, h: number, scale: number): [number, number] {
  return [Math.max(1, Math.round(w * scale)), Math.max(1, Math.round(h * scale))];
}

/** Exports one frame (default: the first). Returns null when there is nothing drawn. */
export async function exportArt(board: Board, o: ExportOptions = {}): Promise<ArtExport | null> {
  const frame = o.frame ?? board.frames[0].id;
  await board.ensureFrame(frame);
  const kind = o.kind ?? 'character';
  const { W, H } = board;
  const flat = flatten(board, frame);
  const box = kind === 'background' ? { x0: 0, y0: 0, x1: W, y1: H } : trimBox(flat, W, H);
  if (!box) return null;
  const bw = box.x1 - box.x0;
  const bh = box.y1 - box.y0;
  let scale = o.scale ?? 1;
  if (o.maxSize && Math.max(bw, bh) * scale > o.maxSize) scale = o.maxSize / Math.max(bw, bh);
  if (board.pixelArt) scale = Math.max(1, Math.round(scale));
  const [fw, fh] = scaledSize(bw, bh, scale);
  const sized = (rgba: Uint8ClampedArray): Uint8ClampedArray => {
    const c = crop(rgba, W, box);
    if (fw === bw && fh === bh) return c;
    return board.pixelArt ? nearestResize(c, bw, bh, fw, fh) : resize(c, bw, bh, fw, fh);
  };
  const flatPx = sized(flat);
  const anchorBoard = o.anchor ?? autoAnchor(kind, flat, W, box);
  const anchor: [number, number] = [(anchorBoard[0] - box.x0) * scale, (anchorBoard[1] - box.y0) * scale];
  const layers: LayerExport[] = [];
  let linesMask: PngImage | null = null;
  if (!o.flatOnly) {
    for (const l of board.layers) {
      if (!l.visible || !EXPORTED_ROLES(l.role)) continue;
      const one = flatten(board, frame, (id) => id === l.id);
      const lb = trimBox(one, W, H);
      if (!lb) continue;
      // Place the layer on the flat's grid: crop to the flat box, scale, then trim again.
      const scaled = sized(one);
      const tb = trimBox(scaled, fw, fh);
      if (!tb) continue;
      const img = await pngBlob(crop(scaled, fw, tb), tb.x1 - tb.x0, tb.y1 - tb.y0);
      layers.push({ ...img, layerId: l.id, name: l.name, role: l.role, part: partName(l.role), x: tb.x0, y: tb.y0 });
    }
    if (board.layers.some((l) => l.role === 'lines' && l.visible && board.hasCel(frame, l.id))) {
      const ink = flatten(board, frame, (id, role) => role === 'lines' && !!board.layer(id)?.visible);
      linesMask = await pngBlob(sized(ink), fw, fh);
    }
  }
  const parts: ArtExport['parts'] = [];
  for (const pr of o.pairs ?? []) {
    const one = flatten(board, frame, (id) => pr.layers.includes(id) && !!board.layer(id)?.visible);
    if (!trimBox(one, W, H)) continue;
    parts.push({ ...(await pngBlob(sized(one), fw, fh)), name: pr.name });
  }
  const ts = o.thumbSize ?? 256;
  const k = Math.min(1, ts / Math.max(fw, fh));
  const [tw, th] = scaledSize(fw, fh, k);
  const thumbPx = tw === fw && th === fh ? flatPx : board.pixelArt ? nearestResize(flatPx, fw, fh, tw, th) : resize(flatPx, fw, fh, tw, th);
  return {
    flat: await pngBlob(flatPx, fw, fh),
    box: [box.x0, box.y0, bw, bh],
    scale,
    anchor,
    anchorBoard: [anchorBoard[0], anchorBoard[1]],
    layers,
    linesMask,
    parts,
    thumb: await pngBlob(thumbPx, tw, th),
  };
}

function nearestResize(src: Uint8ClampedArray, w: number, h: number, tw: number, th: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(tw * th * 4);
  for (let y = 0; y < th; y++) {
    const sy = Math.min(h - 1, Math.floor(((y + 0.5) * h) / th));
    for (let x = 0; x < tw; x++) {
      const sx = Math.min(w - 1, Math.floor(((x + 0.5) * w) / tw));
      out.set(src.subarray((sy * w + sx) * 4, (sy * w + sx) * 4 + 4), (y * tw + x) * 4);
    }
  }
  return out;
}

export interface FrameExport extends PngImage {
  frameId: string;
  hold: number;
  /** Offset within the union box, px. */
  x: number;
  y: number;
}

/** Every frame's flattened image, each trimmed, placed within their common box (for flipbooks and atlases). */
export async function exportFrames(board: Board, o: { scale?: number } = {}): Promise<{ box: [number, number, number, number]; scale: number; frames: FrameExport[] } | null> {
  const { W, H } = board;
  const flats: Array<[string, number, Uint8ClampedArray, Rect]> = [];
  let ux0 = W;
  let uy0 = H;
  let ux1 = 0;
  let uy1 = 0;
  for (const f of board.frames) {
    await board.ensureFrame(f.id);
    const flat = flatten(board, f.id);
    const b = trimBox(flat, W, H);
    if (!b) continue;
    flats.push([f.id, f.hold, flat, b]);
    ux0 = Math.min(ux0, b.x0);
    uy0 = Math.min(uy0, b.y0);
    ux1 = Math.max(ux1, b.x1);
    uy1 = Math.max(uy1, b.y1);
  }
  if (!flats.length) return null;
  const scale = o.scale ?? 1;
  const frames: FrameExport[] = [];
  for (const [id, hold, flat, b] of flats) {
    const bw = b.x1 - b.x0;
    const bh = b.y1 - b.y0;
    const [w, h] = scaledSize(bw, bh, scale);
    const px = crop(flat, W, b);
    const img = await pngBlob(w === bw && h === bh ? px : board.pixelArt ? nearestResize(px, bw, bh, w, h) : resize(px, bw, bh, w, h), w, h);
    frames.push({ ...img, frameId: id, hold, x: Math.round((b.x0 - ux0) * scale), y: Math.round((b.y0 - uy0) * scale) });
  }
  return { box: [ux0, uy0, ux1 - ux0, uy1 - uy0], scale, frames };
}

/** The drawing's colours, most used first (opaque pixels, 5 bits per channel, at most `max`). */
export function paletteOf(rgba: Uint8ClampedArray, max = 24): string[] {
  const counts = new Map<number, [number, number, number, number]>();
  for (let j = 0; j < rgba.length; j += 4) {
    if (rgba[j + 3] < 200) continue;
    const key = ((rgba[j] >> 3) << 10) | ((rgba[j + 1] >> 3) << 5) | (rgba[j + 2] >> 3);
    const c = counts.get(key);
    if (c) {
      c[0]++;
      c[1] += rgba[j];
      c[2] += rgba[j + 1];
      c[3] += rgba[j + 2];
    } else counts.set(key, [1, rgba[j], rgba[j + 1], rgba[j + 2]]);
  }
  const total = [...counts.values()].reduce((n, c) => n + c[0], 0);
  return [...counts.values()]
    .filter((c) => c[0] >= Math.max(4, total * 0.002))
    .sort((a, b) => b[0] - a[0])
    .slice(0, max)
    .map((c) => toHex([c[1] / c[0], c[2] / c[0], c[3] / c[0]]));
}
