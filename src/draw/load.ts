/**
 * Opening the Desk (§2.10): from a route to everything the Desk needs. A cast member's request (from the
 * running game or the world's code), its board, the drawing (its draft when newer than its record), the
 * mode (characters open On the bones), the hero for scale and the world's colours.
 */
import { partSteps, type CharacterKind } from '../cores/rig';
import type { ArtDoc } from '../cores/art';
import { t } from '../i18n';
import { uid } from '../model/ids';
import type { ArtId, ArtRecord, BlobRef, CastKey, CastMember, PartLayers, World, WorldId } from '../model/types';
import type { Store } from '../store/api';
import { measureWorld } from '../store/quota';
import { boardFor, freeBoard, type BoardSpec } from './boards';
import { artIdFor, blankDoc, openDrawing } from './drafts';
import { worldColors } from './palette';
import { bonesLayout, rigFacing, type BonesStep } from './parts';
import { freeRequest, hasBones, resolveRequest, type DeskRequest } from './request';

export interface DeskSetup {
  artId: ArtId;
  world: World | null;
  request: DeskRequest;
  board: BoardSpec;
  doc: ArtDoc;
  record: ArtRecord | null;
  /** The draft was newer than the saved drawing (restored after a crash or a closed lid). */
  restored: boolean;
  mode: 'bones' | 'free';
  parts: Record<string, PartLayers>;
  steps: BonesStep[];
  /** Part name → the bones it is drawn on. */
  partBones: Record<string, string[]>;
  heroImage: ImageBitmap | null;
  colors: string[];
  /** Cel refs already saved (drafts leave them out). */
  saved: Set<BlobRef>;
}

export type DeskLoad = { ok: true; setup: DeskSetup } | { ok: false; reason: 'notFound' | 'tooBig'; worldId: WorldId | null };

/** Ids of free drawings made this session (a new drawing has no record or draft until the first stroke). */
const fresh = new Set<ArtId>();

/** A new free drawing's id (the route then points at it, so a reload comes back to the same drawing). */
export function newFreeId(): ArtId {
  const id = uid('a_');
  fresh.add(id);
  return id;
}

/** Whether a kind is drawn on the bones by default (things with one piece are drawn freehand). */
export function drawsOnBones(r: Pick<DeskRequest, 'kind' | 'rig'>): boolean {
  return hasBones(r) && r.rig !== 'object';
}

function stepsFor(kind: CharacterKind, facing: DeskRequest['facing']): { steps: BonesStep[]; partBones: Record<string, string[]> } {
  const ps = partSteps(kind, rigFacing(facing));
  const partBones: Record<string, string[]> = {};
  for (const s of ps) for (const p of s.parts) partBones[p.name] = p.bones;
  return { steps: ps.map((s) => ({ step: s.step, parts: s.parts.map((p) => p.name) })), partBones };
}

async function heroImageOf(store: Store, world: World, request: DeskRequest): Promise<ImageBitmap | null> {
  const key = request.hero?.key;
  const art = key ? world.cast[key]?.art : null;
  if (!art) return null;
  const rec = await store.art.get(art).catch(() => null);
  const blob = rec?.export ? await store.blobs.get(rec.export.flat).catch(() => null) : null;
  return blob ? createImageBitmap(blob).catch(() => null) : null;
}

async function colorsOf(store: Store, world: World, except: ArtId): Promise<string[]> {
  const ids = Object.values(world.cast)
    .map((s) => s.art)
    .filter((a): a is ArtId => !!a && a !== except);
  const recs = await Promise.all(ids.map((id) => store.art.get(id).catch(() => null)));
  return worldColors(recs.filter((r): r is ArtRecord => !!r).map((r) => r.palette));
}

/** The pairs of a drawing made on the bones (its record's, or found by the layers' ids). */
function partsOfDoc(doc: ArtDoc, record: ArtRecord | null): Record<string, PartLayers> {
  if (record && Object.keys(record.parts).length) return record.parts;
  const out: Record<string, PartLayers> = {};
  for (const l of doc.layers) {
    if (!l.role.startsWith('part:')) continue;
    const lines = doc.layers.find((x) => x.id === `${l.id}-lines`);
    if (lines) out[l.role.slice(5)] = { colors: l.id, lines: lines.id };
  }
  return out;
}

/** Everything the Desk needs for a cast member of a world. */
export async function loadRequestDesk(store: Store, worldId: WorldId, key: CastKey, cast: readonly CastMember[]): Promise<DeskLoad> {
  const world = await store.worlds.get(worldId).catch(() => null);
  if (!world) return { ok: false, reason: 'notFound', worldId: null };
  const request = resolveRequest(world, key, cast);
  if (!request) return { ok: false, reason: 'notFound', worldId };
  const artId = world.cast[key]?.art ?? (await artIdFor(worldId, key));
  const opened = await openDrawing(store, artId).catch(() => null);
  if (!opened && (await measureWorld(store, world).catch(() => null))?.refuse) return { ok: false, reason: 'tooBig', worldId };
  const setup = await finish(store, { artId, world, request, opened, board: boardFor(request) });
  return { ok: true, setup };
}

/** Everything the Desk needs for a free drawing (`#/draw/<artId>`). */
export async function loadFreeDesk(store: Store, artId: ArtId): Promise<DeskLoad> {
  const opened = await openDrawing(store, artId).catch(() => null);
  if (!opened && !fresh.has(artId)) return { ok: false, reason: 'notFound', worldId: null };
  const rec = opened?.record ?? null;
  const request: DeskRequest = { ...freeRequest(rec?.name ?? opened?.doc.name ?? t('draw.newDrawingName')), ...(rec ? { kind: rec.kind, rig: rec.rig } : {}) };
  const board = opened ? { ...freeBoard('square'), w: opened.doc.width, h: opened.doc.height, pixelArt: opened.doc.pixelArt } : freeBoard('square');
  const setup = await finish(store, { artId, world: null, request, opened, board });
  return { ok: true, setup };
}

async function finish(
  store: Store,
  o: { artId: ArtId; world: World | null; request: DeskRequest; opened: Awaited<ReturnType<typeof openDrawing>>; board: BoardSpec },
): Promise<DeskSetup> {
  const { request, opened, world } = o;
  const kind = (request.rig === 'none' ? 'object' : request.rig) as CharacterKind;
  const { steps, partBones } = stepsFor(kind, request.facing);
  let doc: ArtDoc;
  let mode: 'bones' | 'free';
  let parts: Record<string, PartLayers>;
  if (opened) {
    doc = opened.doc;
    parts = partsOfDoc(doc, opened.record);
    mode = opened.record?.mode ?? (Object.keys(parts).length ? 'bones' : 'free');
    // Extras drawn earlier join the Extras step.
    for (const name of Object.keys(parts)) if (!steps.some((s) => s.parts.includes(name))) steps.find((s) => s.step === 'extras')?.parts.push(name);
  } else {
    // Requested characters open On the bones; free drawings open Freehand (the star pose to draw over).
    const bones = world !== null && drawsOnBones(request);
    const layout = bones ? bonesLayout(kind, rigFacing(request.facing)) : null;
    parts = layout?.parts ?? {};
    mode = bones ? 'bones' : 'free';
    doc = blankDoc({ name: request.name, kind: request.kind, rig: request.rig, board: o.board, layers: layout?.layers ?? null });
  }
  const board: BoardSpec = { ...o.board, w: doc.width, h: doc.height, pixelArt: doc.pixelArt };
  const [heroImage, colors] = await Promise.all([world ? heroImageOf(store, world, request) : Promise.resolve(null), world ? colorsOf(store, world, o.artId) : Promise.resolve([])]);
  return {
    artId: o.artId,
    world,
    request,
    board,
    doc,
    record: opened?.record ?? null,
    restored: opened?.restored ?? false,
    mode,
    parts,
    steps,
    partBones,
    heroImage,
    colors,
    saved: new Set(opened?.record?.cels ?? []),
  };
}
