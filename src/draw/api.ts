/**
 * Bring to life (§2.10, §8.4; M3 owns): export → rig → one commit → (in a world) hot swap. Used by the
 * Desk and by M1's First page. A working minimal version: it exports with `exportArt`, rigs characters
 * with `rigWorker.autoRig` (kind from the input, `blob` when none), uses the thumbnail as the sticker and
 * commits drawing, blobs and cast slot together. M3 adds parts, guide hints, real stickers, worker
 * offloading, the stroke log and the footstep.
 */
import { getServices } from '../app/services';
import { exportArt, serializeArtDoc, type ArtDoc } from '../cores/art';
import type { DrawnArt } from '../cores/play';
import { rigWorker, type CharacterKind, type JointHints, type Pixels, type RigData } from '../cores/rig';
import { blobRefOf, hexOfRef, uid } from '../model/ids';
import type { ArtId, ArtKind, ArtRecord, CastKey, Facing, PartLayers, RigKind, World, WorldId } from '../model/types';

export interface BringToLifeInput {
  doc: ArtDoc;
  artId: ArtId | null;
  name: string;
  kind: ArtKind;
  rig: RigKind;
  mode: 'bones' | 'free';
  parts: Record<string, PartLayers>;
  worldId: WorldId | null;
  castKey: CastKey | null;
  shelf: boolean;
  /** The star-pose guide's joints when drawn over it. */
  guideHints: JointHints | null;
}

export interface BringToLifeResult {
  record: ArtRecord;
  /** What was hot-swapped into the running world (null for a free drawing). */
  drawn: DrawnArt | null;
  /** Object URL of the sticker. */
  sticker: string;
  lowConfidence: boolean;
}

/** The rig kind a drawing gets bones for; null for 'none' (not rigged). */
export function characterKind(rig: RigKind): CharacterKind | null {
  return rig === 'none' ? null : rig;
}

function facingOf(rig: RigData | null, fallback: Facing): Facing {
  if (!rig) return fallback;
  return rig.facing === 1 ? 'right' : rig.facing === -1 ? 'left' : 'viewer';
}

/** RGBA pixels of a PNG (for the rig). */
export async function decodePixels(png: Blob): Promise<Pixels> {
  const bitmap = await createImageBitmap(png);
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('No 2D canvas for the rig.');
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

export async function bringToLife(input: BringToLifeInput): Promise<BringToLifeResult> {
  const { store, player } = getServices();
  const exported = await exportArt(input.doc, { maxSide: input.kind === 'background' ? 1920 : 1024, scale: 1 });

  let rigData: RigData | null = null;
  let confidence = 1;
  let notes: string[] = [];
  const kind = characterKind(input.rig);
  if (input.kind === 'character' && kind) {
    const result = await rigWorker.autoRig({ image: await decodePixels(exported.flat.png) }, { kind, hints: input.guideHints ?? undefined });
    rigData = result.rig;
    confidence = result.confidence;
    notes = result.notes;
  }

  const serialized = await serializeArtDoc(input.doc);
  const flatRef = await blobRefOf(exported.flat.png);
  const thumbRef = await blobRefOf(exported.thumb.png);
  const maskRef = exported.linesMask ? await blobRefOf(exported.linesMask.png) : null;
  const prev = input.artId ? await store.art.get(input.artId) : null;
  const now = Date.now();
  const record: ArtRecord = {
    id: input.artId ?? uid('a_'),
    name: input.name,
    kind: input.kind,
    rig: input.rig,
    facing: facingOf(rigData, prev?.facing ?? 'viewer'),
    role: prev?.role ?? null,
    mode: input.mode,
    board: { w: input.doc.width, h: input.doc.height, pixelArt: input.doc.pixelArt },
    doc: serialized.docRef,
    cels: serialized.cels.map((c) => c.ref),
    parts: input.parts,
    export: {
      hash: hexOfRef(flatRef),
      flat: flatRef,
      w: exported.flat.w,
      h: exported.flat.h,
      anchor: exported.anchor,
      inkMask: maskRef,
      parts: {},
      sticker: thumbRef,
      thumb: thumbRef,
      frames: null,
    },
    rigData,
    rigInfo: rigData ? { made: input.guideHints ? 'guide' : 'auto', confidence, notes } : null,
    palette: input.doc.palette.slice(0, 24),
    madeBy: 'student',
    shelf: input.shelf,
    createdAt: prev?.createdAt ?? now,
    updatedAt: now,
    version: (prev?.version ?? 0) + 1,
  };

  let world: World | null = null;
  const key = input.castKey;
  if (input.worldId && key) {
    const w = await store.worlds.get(input.worldId);
    if (w) {
      const slot = w.cast[key] ?? { key, art: null, madeBy: null, extra: null, laterUntil: 0 };
      world = { ...w, cast: { ...w.cast, [key]: { ...slot, art: record.id, madeBy: 'student' } }, updatedAt: now };
    }
  }

  const blobs = [serialized.docBlob, ...serialized.cels.map((c) => c.blob), exported.flat.png, exported.thumb.png];
  if (exported.linesMask) blobs.push(exported.linesMask.png);
  await store.commit({ blobs, art: [record], worlds: world ? [world] : [], clearDrafts: [record.id] });

  let drawn: DrawnArt | null = null;
  if (world && key) {
    drawn = { key, image: exported.flat.png };
    if (rigData) drawn.rig = rigData;
    player.swapArt(drawn);
  }
  return { record, drawn, sticker: await store.blobs.url(thumbRef), lowConfidence: confidence < 0.6 };
}
