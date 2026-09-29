/**
 * Bakes: a `BoundRig` packed into one ArrayBuffer (a JSON header, then the typed arrays and the atlas,
 * 4-byte aligned), so it can be transferred to or from a worker without copying, cached in IndexedDB,
 * or sent to the player instead of binding there. Unpacking makes views into the buffer (no copy).
 */
import type { BindStats, BoundRig, PartRange, RigData } from './types';

const MAGIC = 0x31425241; // 'ARB1' little-endian
export const BAKE_VERSION = 1;

interface Header {
  v: number;
  rig: RigData;
  width: number;
  height: number;
  flat: boolean;
  partRanges: PartRange[];
  stats: BindStats;
  atlasW: number;
  atlasH: number;
  idx32: boolean;
  /** Byte lengths of rest, uvs, indices, boneIdx, boneW, atlas. */
  sizes: number[];
}

const align4 = (n: number) => (n + 3) & ~3;

/** Packs a bound rig into one transferable buffer. */
export function bakeBound(b: BoundRig): ArrayBuffer {
  const idx32 = b.indices instanceof Uint32Array;
  const parts = [b.rest, b.uvs, b.indices, b.boneIdx, b.boneW, b.atlas.data];
  const header: Header = {
    v: BAKE_VERSION,
    rig: b.rig,
    width: b.width,
    height: b.height,
    flat: b.flat,
    partRanges: b.partRanges,
    stats: b.stats,
    atlasW: b.atlas.width,
    atlasH: b.atlas.height,
    idx32,
    sizes: parts.map((p) => p.byteLength),
  };
  const json = new TextEncoder().encode(JSON.stringify(header));
  let total = 8 + align4(json.byteLength);
  for (const p of parts) total += align4(p.byteLength);
  const buf = new ArrayBuffer(total);
  const dv = new DataView(buf);
  dv.setUint32(0, MAGIC, true);
  dv.setUint32(4, json.byteLength, true);
  const bytes = new Uint8Array(buf);
  bytes.set(json, 8);
  let off = 8 + align4(json.byteLength);
  for (const p of parts) {
    bytes.set(new Uint8Array(p.buffer, p.byteOffset, p.byteLength), off);
    off += align4(p.byteLength);
  }
  return buf;
}

export function isBake(v: unknown): v is ArrayBuffer {
  return v instanceof ArrayBuffer && v.byteLength >= 8 && new DataView(v).getUint32(0, true) === MAGIC;
}

/** Unpacks a bake (views into `buf`; don't transfer it away while the rig is in use). */
export function unbakeBound(buf: ArrayBuffer): BoundRig {
  if (!isBake(buf)) throw new Error('Not a rig bake');
  const dv = new DataView(buf);
  const jl = dv.getUint32(4, true);
  const header = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 8, jl))) as Header;
  if (header.v !== BAKE_VERSION) throw new Error(`Rig bake version ${header.v} is not supported`);
  let off = 8 + align4(jl);
  const take = <T>(k: number, make: (o: number, n: number) => T, bytesPer: number): T => {
    const n = header.sizes[k] / bytesPer;
    const v = make(off, n);
    off += align4(header.sizes[k]);
    return v;
  };
  const rest = take(0, (o, n) => new Float32Array(buf, o, n), 4);
  const uvs = take(1, (o, n) => new Float32Array(buf, o, n), 4);
  const indices = header.idx32 ? take(2, (o, n) => new Uint32Array(buf, o, n), 4) : take(2, (o, n) => new Uint16Array(buf, o, n), 2);
  const boneIdx = take(3, (o, n) => new Uint8Array(buf, o, n), 1);
  const boneW = take(4, (o, n) => new Float32Array(buf, o, n), 4);
  const atlasData = take(5, (o, n) => new Uint8ClampedArray(buf, o, n), 1);
  return {
    rig: header.rig,
    width: header.width,
    height: header.height,
    rest,
    uvs,
    indices,
    boneIdx,
    boneW,
    atlas: { data: atlasData, width: header.atlasW, height: header.atlasH },
    partRanges: header.partRanges,
    flat: header.flat,
    stats: header.stats,
  };
}
