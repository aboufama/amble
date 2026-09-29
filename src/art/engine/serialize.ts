/**
 * Board <-> ArtDoc (cels as trimmed lossless PNGs) and ArtDoc <-> one binary blob (for files, transfer and
 * tests). An ArtDoc can also be stored in IndexedDB as-is: its Blobs are structured-cloneable.
 */
import { Board, celKey } from './board';
import { alphaBounds, copyIn } from './blend';
import { crop, flatten, paletteOf } from './export';
import { type ArtCel, type ArtDoc, type ArtFrame, type ArtKind, type ArtLayer, type RigKind, ART_KINDS, LIMITS, isLayerRole, uid } from './model';
import { decodePng, deflate, encodePng, inflate } from './png';
import { type LogOp, decodeLog, encodeLog } from './log';

export interface DocMeta {
  id: string;
  name: string;
  kind: ArtKind;
  rig?: RigKind;
  anchor: [number, number] | null;
  created: number;
  version: number;
}

/** Encoded cels by (frame/layer) and version, so autosaves re-encode only what changed. */
export type CelCache = Map<string, { version: number; cel: ArtCel | null }>;

export async function encodeCel(board: Board, frame: string, layer: string): Promise<ArtCel | null> {
  await board.ensureFrame(frame);
  const d = board.pixels(frame, layer);
  if (!d) return null;
  const box = alphaBounds(d, board.W, board.H);
  if (!box) return null;
  const w = box.x1 - box.x0;
  const h = box.y1 - box.y0;
  const bytes = await encodePng(crop(d, board.W, box), w, h);
  return { frame, layer, x: box.x0, y: box.y0, w, h, png: new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'image/png' }) };
}

/** Snapshot of the board as an ArtDoc. Unchanged cels come from `cache` when given. */
export async function boardToArtDoc(board: Board, meta: DocMeta, log: readonly LogOp[] | null, cache?: CelCache): Promise<ArtDoc> {
  const cels: ArtCel[] = [];
  for (const f of board.frames)
    for (const l of board.layers) {
      if (!board.hasCel(f.id, l.id)) continue;
      const key = celKey(f.id, l.id);
      const version = board.version(f.id, l.id);
      const hit = cache?.get(key);
      let cel: ArtCel | null;
      if (hit && hit.version === version) cel = hit.cel;
      else {
        cel = await encodeCel(board, f.id, l.id);
        cache?.set(key, { version, cel });
      }
      if (cel) cels.push(cel);
    }
  await board.ensureFrame(board.frames[0].id);
  const palette = paletteOf(flatten(board, board.frames[0].id));
  const strokeLog = log && log.length ? new Blob([(await deflate(encodeLog(log))) as Uint8Array<ArrayBuffer>], { type: 'application/octet-stream' }) : null;
  const now = Date.now();
  return {
    format: 'amble-art',
    v: 1,
    id: meta.id,
    name: meta.name,
    kind: meta.kind,
    ...(meta.rig ? { rig: meta.rig } : {}),
    width: board.W,
    height: board.H,
    pixelArt: board.pixelArt,
    layers: board.layers.map((l) => ({ ...l })),
    frames: board.frames.map((f) => ({ ...f })),
    cels,
    anchor: meta.anchor,
    palette,
    strokeLog,
    created: meta.created,
    updated: now,
    version: meta.version,
  };
}

/** Rebuilds a board from an ArtDoc (decodes every cel). */
export async function artDocToBoard(doc: ArtDoc): Promise<Board> {
  const errors = validateArtDoc(doc);
  if (errors.length) throw new Error(`Invalid ArtDoc: ${errors.join('; ')}`);
  const board = new Board(doc.width, doc.height, doc.pixelArt);
  board.layers = doc.layers.map((l) => ({ ...l }));
  board.frames = doc.frames.map((f) => ({ ...f }));
  for (const c of doc.cels) {
    if (!board.layer(c.layer) || board.frameIndex(c.frame) < 0) continue;
    const img = await decodePng(new Uint8Array(await c.png.arrayBuffer()));
    if (img.width !== c.w || img.height !== c.h) throw new Error(`Cel ${c.frame}/${c.layer}: size mismatch`);
    const x0 = Math.max(0, c.x);
    const y0 = Math.max(0, c.y);
    const x1 = Math.min(board.W, c.x + c.w);
    const y1 = Math.min(board.H, c.y + c.h);
    if (x1 <= x0 || y1 <= y0) continue;
    const data = board.pixels(c.frame, c.layer, true);
    const part = x0 === c.x && y0 === c.y && x1 === c.x + c.w && y1 === c.y + c.h ? img.data : crop(img.data, c.w, { x0: x0 - c.x, y0: y0 - c.y, x1: x1 - c.x, y1: y1 - c.y });
    copyIn(data, board.W, { x0, y0, x1, y1 }, part);
    board.cel(c.frame, c.layer).version = 1;
  }
  return board;
}

export async function readLog(doc: ArtDoc): Promise<LogOp[] | null> {
  if (!doc.strokeLog) return null;
  return decodeLog(await inflate(new Uint8Array(await doc.strokeLog.arrayBuffer())));
}

/** Problems that make an ArtDoc unusable (empty when fine). */
export function validateArtDoc(doc: ArtDoc): string[] {
  const e: string[] = [];
  if (doc.format !== 'amble-art' || doc.v !== 1) e.push('not an amble-art v1 document');
  if (!(doc.width >= 1 && doc.height >= 1 && doc.width <= LIMITS.maxBoard && doc.height <= LIMITS.maxBoard)) e.push(`board must be 1..${LIMITS.maxBoard} px`);
  if (!ART_KINDS.includes(doc.kind)) e.push(`unknown kind ${String(doc.kind)}`);
  if (!Array.isArray(doc.layers) || !doc.layers.length) e.push('no layers');
  if (!Array.isArray(doc.frames) || !doc.frames.length) e.push('no frames');
  const ids = new Set<string>();
  for (const l of doc.layers ?? []) {
    if (!l.id || ids.has(l.id)) e.push(`bad or duplicate layer id ${l.id}`);
    ids.add(l.id);
    if (!isLayerRole(l.role)) e.push(`layer ${l.id}: bad role ${String(l.role)}`);
  }
  if ((doc.layers?.length ?? 0) > LIMITS.maxLayersWithParts) e.push('too many layers');
  if ((doc.frames?.length ?? 0) > LIMITS.maxFrames) e.push('too many frames');
  return e;
}

export function newDocMeta(name: string, kind: ArtKind, rig?: RigKind): DocMeta {
  return { id: uid('art'), name, kind, rig, anchor: null, created: Date.now(), version: 1 };
}

// ------------------------------------------------------------------------------------------ binary container

const MAGIC = [0x41, 0x4d, 0x42, 0x41]; // 'AMBA'

interface Header extends Omit<ArtDoc, 'cels' | 'strokeLog'> {
  cels: Array<Omit<ArtCel, 'png'> & { bytes: number }>;
  strokeLog: number | null;
}

/** Packs an ArtDoc (meta + PNG cels + stroke log) into one byte array. */
export async function serializeArtDoc(doc: ArtDoc): Promise<Uint8Array> {
  const blobs: Uint8Array[] = [];
  const cels = [];
  for (const c of doc.cels) {
    const b = new Uint8Array(await c.png.arrayBuffer());
    blobs.push(b);
    const { png: _png, ...rest } = c;
    void _png;
    cels.push({ ...rest, bytes: b.length });
  }
  let logBytes: number | null = null;
  if (doc.strokeLog) {
    const b = new Uint8Array(await doc.strokeLog.arrayBuffer());
    blobs.push(b);
    logBytes = b.length;
  }
  const { cels: _c, strokeLog: _s, ...rest } = doc;
  void _c;
  void _s;
  const header: Header = { ...rest, cels, strokeLog: logBytes };
  const json = new TextEncoder().encode(JSON.stringify(header));
  const total = 4 + 1 + 4 + json.length + blobs.reduce((n, b) => n + b.length, 0);
  const out = new Uint8Array(total);
  out.set(MAGIC, 0);
  out[4] = 1;
  new DataView(out.buffer).setUint32(5, json.length);
  out.set(json, 9);
  let o = 9 + json.length;
  for (const b of blobs) {
    out.set(b, o);
    o += b.length;
  }
  return out;
}

export async function deserializeArtDoc(bytes: Uint8Array | ArrayBuffer | Blob): Promise<ArtDoc> {
  const buf = bytes instanceof Blob ? new Uint8Array(await bytes.arrayBuffer()) : bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  for (let i = 0; i < 4; i++) if (buf[i] !== MAGIC[i]) throw new Error('Not an Amble drawing');
  if (buf[4] !== 1) throw new Error(`Unsupported drawing format ${buf[4]}`);
  const len = new DataView(buf.buffer, buf.byteOffset, buf.byteLength).getUint32(5);
  const header = JSON.parse(new TextDecoder().decode(buf.subarray(9, 9 + len))) as Header;
  let o = 9 + len;
  const take = (n: number): Uint8Array => {
    if (o + n > buf.length) throw new Error('Drawing file is truncated');
    const b = buf.slice(o, o + n);
    o += n;
    return b;
  };
  const cels: ArtCel[] = header.cels.map(({ bytes, ...c }) => ({ ...c, png: new Blob([take(bytes) as Uint8Array<ArrayBuffer>], { type: 'image/png' }) }));
  const strokeLog = header.strokeLog === null ? null : new Blob([take(header.strokeLog) as Uint8Array<ArrayBuffer>], { type: 'application/octet-stream' });
  const doc: ArtDoc = { ...header, cels, strokeLog };
  const errors = validateArtDoc(doc);
  if (errors.length) throw new Error(`Invalid drawing: ${errors.join('; ')}`);
  return doc;
}

/** Approximate stored size of an ArtDoc, bytes. */
export function artDocBytes(doc: ArtDoc): number {
  return doc.cels.reduce((n, c) => n + c.png.size, 0) + (doc.strokeLog?.size ?? 0) + 2048;
}

export type { ArtFrame, ArtLayer };
