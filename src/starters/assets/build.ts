/**
 * Build time only (tools/starters/build.mjs runs this in Node; the app never imports it): turns one
 * starter drawing's ArtScript into what the app stores, by replaying it through the real brush engine.
 * Out come the serialized ArtDoc and its cels, the flat, the lines-only ink mask, one composite per body
 * part (lines over colours, the flat's size, so the rig reads them as they are), the sticker, the
 * thumbnail, the rig in the flat's pixels, and the `art.json` that `open()` reads.
 */
import { decodePng, encodePng, exportArt, replayArtScript, serializeArtDoc, type ArtScript } from '../../cores/art';
import { artSizeOf, cloneRig, hashPixels, parseRig, type RigData } from '../../cores/rig';
import { blobRefOf } from '../../model/ids';
import type { ArtExport, BlobRef, PartLayers } from '../../model/types';
import type { StarterArtJson, StarterCast } from '../types';
import { blank, over, sticker, type Rgba } from './pixels';

export interface BuildArtInput {
  cast: StarterCast;
  script: ArtScript;
  /** The committed rig (`<key>.rig.json`, the flat's pixels), if there is one yet. */
  rig: unknown;
  /** The art department's tested starting rig (board pixels), used until a rig is committed. */
  startRig: unknown;
}

export interface BuiltArt {
  json: StarterArtJson;
  /** Paths relative to the drawing's folder, with their bytes. */
  files: Array<{ path: string; bytes: Uint8Array }>;
  rig: RigData | null;
  /** The committed rig was missing, or had to move (the drawing's trimmed box changed): commit this one. */
  rigUpdated: boolean;
  flat: Rgba;
  /** The part composites by rig layer key (`part:armL`), the flat's size. */
  parts: Record<string, Rgba>;
  /** The trimmed box on the board: [x, y, w, h]. */
  box: [number, number, number, number];
}

async function png(p: Rgba): Promise<Uint8Array> {
  return encodePng(p.data, p.width, p.height);
}

async function bytesOf(b: Blob): Promise<Uint8Array> {
  return new Uint8Array(await b.arrayBuffer());
}

async function refOf(bytes: Uint8Array): Promise<BlobRef> {
  return blobRefOf(new Blob([bytes as Uint8Array<ArrayBuffer>]));
}

/** The pairs drawn on the bones: `part:<name>` layer → its lines layer (`<id>-lines`, right above it). */
export function partPairs(script: ArtScript): Record<string, PartLayers> {
  const out: Record<string, PartLayers> = {};
  for (const l of script.layers) {
    if (!l.role.startsWith('part:')) continue;
    const lines = `${l.id}-lines`;
    if (script.layers.some((m) => m.id === lines && m.role === 'lines')) out[l.role.slice(5)] = { lines, colors: l.id };
  }
  return out;
}

/** The art department's rig (board px, part layers by layer id) moved onto the trimmed drawing. */
export function rigOnFlat(start: RigData, box: [number, number, number, number], parts: Record<string, PartLayers>, artHash: string): RigData {
  const r = cloneRig(start);
  const [bx, by] = box;
  for (const b of r.bones) {
    b.x -= bx;
    b.y -= by;
    b.x2 -= bx;
    b.y2 -= by;
  }
  r.anchor = [r.anchor[0] - bx, r.anchor[1] - by];
  const byLayerId = new Map(Object.entries(parts).map(([name, p]) => [p.colors, name]));
  if (r.parts) r.parts = r.parts.map((p) => ({ ...p, layer: `part:${byLayerId.get(p.layer ?? '') ?? p.name}` }));
  r.artHash = artHash;
  return r;
}

export async function buildArt(input: BuildArtInput): Promise<BuiltArt> {
  const { cast, script } = input;
  const doc = await replayArtScript(script);
  const ex = await exportArt(doc, { scale: 1, maxSide: script.kind === 'background' ? 1920 : 1024, thumbSize: 128 });
  if (!ex) throw new Error(`${cast.key}: the drawing is empty`);
  const fw = ex.flat.w;
  const fh = ex.flat.h;
  const files: BuiltArt['files'] = [];
  const index: Record<BlobRef, string> = {};
  const add = async (path: string, bytes: Uint8Array): Promise<BlobRef> => {
    const ref = await refOf(bytes);
    files.push({ path, bytes });
    index[ref] = path;
    return ref;
  };

  const flatBytes = await bytesOf(ex.flat.png);
  const flat: Rgba = await decodePng(flatBytes);
  const flatRef = await add('flat.png', flatBytes);
  const inkRef = ex.linesMask ? await add('ink.png', await bytesOf(ex.linesMask.png)) : null;

  // One composite per body part, the flat's size: exactly what the game's rig binds per part.
  const pairs = partPairs(script);
  const layerPx = new Map<string, { px: Rgba; x: number; y: number }>();
  for (const l of ex.layers) layerPx.set(l.layerId, { px: await decodePng(await bytesOf(l.png)), x: l.x, y: l.y });
  const partImages: Record<string, Rgba> = {};
  const exportParts: ArtExport['parts'] = {};
  for (const [name, pair] of Object.entries(pairs)) {
    const canvas = blank(fw, fh);
    for (const id of [pair.colors, pair.lines]) {
      const l = layerPx.get(id);
      if (l) over(canvas, l.px, l.x, l.y);
    }
    const key = `part:${name}`;
    partImages[key] = canvas;
    const ref = await add(`parts/${name}.png`, await png(canvas));
    exportParts[key] = { blob: ref, x: 0, y: 0, w: fw, h: fh };
  }

  const stickerRef = await add('sticker.png', await png(sticker(flat)));
  const thumbRef = await add('thumb.png', await bytesOf(ex.thumb.png));

  const serialized = await serializeArtDoc(doc);
  const docBytes = await bytesOf(serialized.docBlob);
  const docRef = await add('doc.json', docBytes);
  const celRefs: BlobRef[] = [];
  const layerOf = new Map(serialized.json.cels.map((c) => [c.ref, c.layer]));
  for (const c of serialized.cels) {
    const ref = await add(`cels/${layerOf.get(c.ref) ?? c.ref.slice(7, 19)}.png`, await bytesOf(c.blob));
    celRefs.push(ref);
  }

  const box = ex.box;
  const artHash = hashPixels(flat);
  let rig: RigData | null = null;
  let rigUpdated = false;
  if (cast.kind === 'character' && cast.rig !== 'none') {
    const committed = input.rig ? parseRig(input.rig) : null;
    const size = committed ? artSizeOf(committed) : null;
    if (committed && size && size[0] === fw && size[1] === fh) {
      rig = committed.artHash === artHash ? committed : { ...committed, artHash };
      rigUpdated = rig !== committed;
    } else if (input.startRig) {
      rig = rigOnFlat(parseRig(input.startRig), box, pairs, artHash);
      rigUpdated = true;
    }
  }

  const exported: ArtExport = {
    hash: flatRef.slice('sha256:'.length),
    flat: flatRef,
    w: fw,
    h: fh,
    anchor: [Math.round(ex.anchor[0] * 100) / 100, Math.round(ex.anchor[1] * 100) / 100],
    inkMask: inkRef,
    parts: exportParts,
    sticker: stickerRef,
    thumb: thumbRef,
    frames: null,
  };
  const json: StarterArtJson = {
    v: 1,
    key: cast.key,
    script: script.name,
    name: cast.name,
    kind: cast.kind,
    rig: cast.rig,
    facing: cast.facing,
    role: cast.role,
    mode: Object.keys(pairs).length ? 'bones' : 'free',
    board: { w: script.width, h: script.height, pixelArt: false },
    doc: docRef,
    cels: celRefs,
    parts: pairs,
    export: exported,
    rigData: rig,
    rigInfo: rig ? { made: rig.made === 'hand' ? 'hand' : 'parts', confidence: 1, notes: [] } : null,
    palette: doc.palette.slice(0, 24),
    files: index,
  };
  return { json, files, rig, rigUpdated, flat, parts: partImages, box };
}
