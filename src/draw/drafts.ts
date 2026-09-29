/**
 * Keeping the Desk's drawing safe (§4.4, §7.6): drafts at pen-up (the cels changed since the drawing was
 * last saved, keyed by `ArtId`), a commit of the drawing at checkpoints (leaving the Desk, switching
 * drawings, 20 s idle, the page hidden) that clears its draft in the same transaction, and the stroke log in
 * the device-only `strokes` store (never in files, never sent).
 *
 * A drawing for a cast member has a stable id from its world and key until it is brought to life (then the
 * cast slot holds it), so the Desk finds unfinished work again, and M6's restore finds it after a crash.
 */
import { deserializeArtDoc, newArtDoc, serializeArtDoc, type ArtDoc, type ArtDocJson } from '../cores/art';
import type { ArtId, ArtKind, ArtRecord, BlobRef, CastKey, DeskDraft, PartLayers, RigKind, WorldId } from '../model/types';
import type { Store } from '../store/api';
import type { BoardSpec } from './boards';

export { artIdFor } from './artId';

export interface Opened {
  doc: ArtDoc;
  record: ArtRecord | null;
  /** The draft was newer than the record (work that was never committed). */
  restored: boolean;
  /**
   * The saved drawing's file can't be read (the draft is a new drawing of it). The record stays as it is until
   * Bring to life: the Desk keeps drafts only, and the world keeps playing the record's export.
   */
  damaged?: boolean;
}

/**
 * A drawing whose record is there but whose saved file can't be read (missing or not an Amble drawing). It is
 * never opened as a blank sheet under the same id without saying so: the first save would replace the record
 * and take the drawing the game plays out of the world.
 */
export class DamagedDrawing extends Error {
  constructor(readonly record: ArtRecord, cause?: unknown) {
    super(`The drawing ${record.id} can't be read${cause instanceof Error ? `: ${cause.message}` : '.'}`);
    this.name = 'DamagedDrawing';
  }
}

async function readSaved(store: Store, record: ArtRecord, log: Uint8Array[] | null): Promise<ArtDoc> {
  try {
    const blob = await store.blobs.get(record.doc);
    if (!blob) throw new Error('its file is missing');
    return await deserializeArtDoc(blob, (ref) => store.blobs.get(ref), log);
  } catch (err) {
    throw new DamagedDrawing(record, err);
  }
}

/** Whether a record's saved drawing can be read (its file is there and is an Amble drawing). */
async function savedReadable(store: Store, record: ArtRecord): Promise<boolean> {
  try {
    const blob = await store.blobs.get(record.doc);
    const json = blob ? (JSON.parse(await blob.text()) as Partial<ArtDocJson>) : null;
    return json?.format === 'amble-art' && json.v === 1 && Array.isArray(json.cels);
  } catch {
    return false;
  }
}

/**
 * The newest version of a drawing: its draft when newer than its record, else the record, else null. Throws
 * `DamagedDrawing` when the record is there but its file can't be read (and there is no newer draft).
 */
export async function openDrawing(store: Store, artId: ArtId): Promise<Opened | null> {
  const [record, draft] = await Promise.all([store.art.get(artId).catch(() => null), store.drafts.get(artId).catch(() => null)]);
  const chunks = await store.strokes.read(artId).catch(() => [] as Uint8Array[]);
  const log = chunks.length ? chunks : null;
  if (draft && (!record || draft.at > record.updatedAt)) {
    try {
      const json = JSON.parse(draft.doc) as ArtDocJson;
      const doc = await deserializeArtDoc(json, async (ref) => draft.cels[ref] ?? (await store.blobs.get(ref)), log);
      // Drawing a damaged one again: until it is brought to life, the record still can't be read.
      const damaged = record ? !(await savedReadable(store, record)) : false;
      return { doc, record, restored: true, ...(damaged ? { damaged } : {}) };
    } catch (err) {
      // A draft that can't be read: the saved drawing, when there is one.
      if (!record) throw err;
    }
  }
  if (!record) return null;
  const doc = await readSaved(store, record, log);
  return { doc, record, restored: false };
}

/** A blank drawing on its board: the pairs on the bones, or Sketch, Colours and Lines. */
export function blankDoc(o: { name: string; kind: ArtKind; rig: RigKind; board: BoardSpec; layers: Array<{ id: string; role: ArtDoc['layers'][number]['role']; name: string }> | null }): ArtDoc {
  return newArtDoc({
    name: o.name,
    kind: o.kind,
    ...(o.rig !== 'none' ? { rig: o.rig } : {}),
    width: o.board.w,
    height: o.board.h,
    pixelArt: o.board.pixelArt,
    layers: o.layers ?? (o.board.pixelArt ? undefined : 'freehand'),
  });
}

export interface DraftContext {
  artId: ArtId;
  worldId: WorldId | null;
  castKey: CastKey | null;
  /** Cel refs already in the blobs store (the saved record's): drafts leave them out. */
  saved: ReadonlySet<BlobRef>;
}

/** Writes a draft: the doc's JSON and the cels not saved yet. */
export async function writeDraft(store: Store, doc: ArtDoc, ctx: DraftContext, tool: string): Promise<void> {
  const s = await serializeArtDoc(doc);
  const cels: Record<string, Blob> = {};
  for (const c of s.cels) if (!ctx.saved.has(c.ref)) cels[c.ref] = c.blob;
  const draft: DeskDraft = { artId: ctx.artId, worldId: ctx.worldId, castKey: ctx.castKey, doc: JSON.stringify(s.json), cels, tool, at: Date.now() };
  await store.drafts.put(draft);
  if (s.strokeLog) await keepStrokeLog(store, ctx.artId, s.strokeLog);
}

/** The stroke log stays on this device (time-lapse and recovery). */
export async function keepStrokeLog(store: Store, artId: ArtId, log: Blob): Promise<void> {
  await store.strokes.clear(artId);
  await store.strokes.append(artId, new Uint8Array(await log.arrayBuffer()));
}

export interface SaveInput {
  doc: ArtDoc;
  artId: ArtId;
  previous: ArtRecord | null;
  name: string;
  kind: ArtKind;
  rig: RigKind;
  role: ArtRecord['role'];
  facing: ArtRecord['facing'];
  mode: 'bones' | 'free';
  parts: Record<string, PartLayers>;
  shelf: boolean;
}

/**
 * The drawing's record as saved at a checkpoint: its doc and cels, its parts and mode. What games load (the
 * export, the bones) changes only with Bring to life. Returns the record and the blobs to commit with it.
 */
export async function recordFor(o: SaveInput): Promise<{ record: ArtRecord; blobs: Blob[]; refs: BlobRef[]; strokeLog: Blob | null }> {
  const s = await serializeArtDoc(o.doc);
  const now = Date.now();
  const p = o.previous;
  const record: ArtRecord = {
    id: o.artId,
    name: o.name,
    kind: o.kind,
    rig: o.rig,
    facing: p?.facing ?? o.facing,
    role: p?.role ?? o.role,
    mode: o.mode,
    board: { w: o.doc.width, h: o.doc.height, pixelArt: o.doc.pixelArt },
    doc: s.docRef,
    cels: s.cels.map((c) => c.ref),
    parts: o.parts,
    export: p?.export ?? null,
    rigData: p?.rigData ?? null,
    rigInfo: p?.rigInfo ?? null,
    palette: o.doc.palette.slice(0, 24),
    madeBy: p?.madeBy ?? 'student',
    shelf: p?.shelf ?? o.shelf,
    createdAt: p?.createdAt ?? now,
    updatedAt: now,
    version: p?.version ?? 0,
  };
  return { record, blobs: [s.docBlob, ...s.cels.map((c) => c.blob)], refs: s.cels.map((c) => c.ref), strokeLog: s.strokeLog };
}

/** Saves the drawing (one commit that also clears its draft). */
export async function saveDrawing(store: Store, o: SaveInput): Promise<ArtRecord> {
  const { record, blobs, strokeLog } = await recordFor(o);
  await store.commit({ blobs, art: [record], clearDrafts: [o.artId] });
  if (strokeLog) await keepStrokeLog(store, o.artId, strokeLog).catch(() => undefined);
  return record;
}

/**
 * A checkpoint of the Desk (20 s idle, the page hidden, the Desk closing): the drawing saved in one commit, or,
 * drawing a damaged one again, kept in its draft with every piece, so the damaged record and the drawing the
 * game plays stay until Bring to life replaces them. Returns the saved record (null when kept as a draft).
 */
export async function checkpointDrawing(store: Store, o: SaveInput & { damaged: boolean; worldId: WorldId | null; castKey: CastKey | null; tool: string }): Promise<ArtRecord | null> {
  if (!o.damaged) return saveDrawing(store, o);
  await writeDraft(store, o.doc, { artId: o.artId, worldId: o.worldId, castKey: o.castKey, saved: new Set() }, o.tool);
  return null;
}
