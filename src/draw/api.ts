/**
 * Bring to life (§2.10, §7.7, §8.4; M3 owns): export → rig → one commit → footstep → hot swap. Used by the
 * Desk and by M1's First page.
 * - Export: the trimmed flat PNG at twice the in-game size, the lines-only ink mask, one image per body part
 *   drawn on the bones (lines over colours), the 256 px sticker and the 128 px thumbnail. The Desk exports
 *   in the engine worker and passes the result; otherwise it is made here.
 * - Rig (characters): on the bones, the template's joints are the hints and the part layers the parts
 *   ("parts"); over the star-pose guide, the guide's joints ("guide"); otherwise the kind's template fit
 *   ("auto"). When no limbs are found the drawing moves as one piece (a blob when round, else a thing).
 * - One commit: the blobs, the drawing's record and the world's cast slot, clearing the drawing's draft;
 *   then the footstep ("You drew the Moon King"), then the hot swap into the running world. Reading the world
 *   through its footstep takes turns with the world's other writes (`writeWorld`: a build landing meanwhile).
 */
import { getServices } from '../app/services';
import type { PlayerHost } from '../app/player/host';
import { exportArt, serializeArtDoc, type ArtDoc, type ArtExportResult } from '../cores/art';
import type { DrawnArt } from '../cores/play';
import { rigWorker, type AutoRigRequest, type CharacterKind, type JointHints, type Pixels, type RigData, type RigSource } from '../cores/rig';
import type { HistoryApi } from '../history/api';
import { t } from '../i18n';
import { blobRefOf, hexOfRef, uid } from '../model/ids';
import type { ArtExport, ArtId, ArtKind, ArtRecord, BlobRef, CastKey, Facing, PartLayers, RigKind, Role, World, WorldId } from '../model/types';
import { adoptWorld } from '../state/session';
import { getState } from '../state/store';
import type { Store } from '../store/api';
import { writeWorld } from '../store/worldWrites';
import { keepStrokeLog } from './drafts';
import type { PackedFlipbook } from './flipbook';
import { rigFacing } from './parts';
import { makeSticker } from './sticker';

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
  /** The star-pose guide's joints when drawn over it (board px). */
  guideHints: JointHints | null;
  /** The export, made in the engine worker by the Desk (with `pairs` for the parts). Made here when absent. */
  exported?: ArtExportResult | null;
  /** The longest side of the export (default 1024; backgrounds 1920). */
  exportMax?: number;
  /** Which way the request says it faces, and its role in the game. */
  facing?: Facing;
  role?: Role | null;
  /** On the bones: the template's joints and tips (board px), the hints the parts are fitted with. */
  partHints?: { joints: JointHints; tips: JointHints } | null;
  /** A flipbook that replaces one move (§7.12), packed by the Desk; undefined keeps the saved one. */
  frames?: PackedFlipbook | null;
}

export interface BringToLifeResult {
  record: ArtRecord;
  /** What was hot-swapped into the running world (null for a free drawing). */
  drawn: DrawnArt | null;
  /** Object URL of the sticker. */
  sticker: string;
  lowConfidence: boolean;
  /** No limbs were found: it moves as one piece (the note says so). */
  onePiece: boolean;
  /** The world with its new footstep (null for a free drawing). */
  world: World | null;
}

/** What Bring to life talks to (the services; tests pass fakes). */
export interface BringDeps {
  store: Store;
  history: HistoryApi;
  player: Pick<PlayerHost, 'swapArt'> | null;
  rig(source: RigSource, req: AutoRigRequest & { lane?: string }): Promise<{ rig: RigData; confidence: number; notes: string[]; issues: string[] }>;
  sticker(flat: Blob): Promise<Blob>;
  export(doc: ArtDoc, maxSide: number, pairs: Array<{ name: string; layers: string[] }>): Promise<ArtExportResult | null>;
  /**
   * The world open in the session, when it is this one: its copy is the newest (the autosave may not have
   * written it yet), and the committed world goes back into it, or that copy would later be saved over it.
   */
  session?: SessionLink;
}

export interface SessionLink {
  world(id: WorldId): World | null;
  adopt(world: World, key: CastKey): void;
}

/** The app's session: the open world's copy, and the drawing's slot and footstep back into it. */
export function sessionLink(): SessionLink {
  return {
    world: (id) => {
      const open = getState().session.world;
      return open?.id === id ? open : null;
    },
    adopt: (world, key) =>
      void adoptWorld(world, (w, committed) => {
        w.cast[key] = committed.cast[key];
      }),
  };
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

/** Board px → the export's px (trimmed and scaled). */
export function toExportPx(e: Pick<ArtExportResult, 'box' | 'scale'>, hints: JointHints): JointHints {
  const out: JointHints = {};
  for (const [role, p] of Object.entries(hints)) if (p) out[role as keyof JointHints] = [(p[0] - e.box[0]) * e.scale, (p[1] - e.box[1]) * e.scale];
  return out;
}

/** The part layers of a pair map, for the export's composites. */
export function pairsOf(parts: Record<string, PartLayers>): Array<{ name: string; layers: string[] }> {
  return Object.entries(parts).map(([name, p]) => ({ name, layers: [p.colors, p.lines] }));
}

function defaultDeps(): BringDeps {
  const s = getServices();
  return {
    store: s.store,
    history: s.history,
    player: s.player,
    rig: (source, req) => rigWorker.autoRig(source, req),
    sticker: (flat) => makeSticker(flat),
    session: sessionLink(),
    // The Desk usually hands in its own export (made in the worker); this one makes the same part composites.
    export: (doc, maxSide, pairs) => exportArt(doc, { maxSide, scale: 1, thumbSize: 128, ...(pairs.length ? { pairs } : {}) }),
  };
}

/** Rigs a drawing for its kind; falls back to moving as one piece when no limbs are found. */
async function rigDrawing(
  deps: BringDeps,
  input: BringToLifeInput,
  e: ArtExportResult,
  previous: RigData | null,
): Promise<{ rig: RigData; confidence: number; notes: string[]; made: 'auto' | 'guide' | 'parts'; onePiece: boolean } | null> {
  const kind = characterKind(input.rig);
  if (input.kind !== 'character' || !kind) return null;
  const layers: Record<string, Blob> = {};
  if (e.linesMask) layers.lines = e.linesMask.png;
  for (const p of e.parts ?? []) layers[`part:${p.name}`] = p.png;
  const source: RigSource = { image: e.flat.png, ...(Object.keys(layers).length ? { layers } : {}) };
  const facing = input.facing ? rigFacing(input.facing) : undefined;
  const lane = `bring:${input.artId ?? 'new'}`;
  const parts = input.mode === 'bones' && (e.parts?.length ?? 0) > 0;
  const hints = parts && input.partHints ? input.partHints : input.guideHints ? { joints: input.guideHints, tips: {} } : null;
  const made: 'auto' | 'guide' | 'parts' = parts ? 'parts' : input.guideHints ? 'guide' : 'auto';
  const req: AutoRigRequest & { lane?: string } = { kind, lane, ...(facing !== undefined ? { facing } : {}) };
  // A redraw keeps the bones the student placed (the same box keeps them; otherwise they become hints).
  if (previous && previous.kind === kind && !parts) req.previous = previous;
  if (hints) {
    req.hints = toExportPx(e, hints.joints);
    if (Object.keys(hints.tips).length) req.tipHints = toExportPx(e, hints.tips);
    req.unsnapped = 'keep';
  }
  const r = await deps.rig(source, req);
  const limbless = (kind === 'biped' || kind === 'quadruped') && r.issues.includes('no-legs') && (kind === 'quadruped' || r.issues.includes('no-arms'));
  if (limbless && made !== 'parts') {
    const round = e.flat.w / e.flat.h > 0.75 && e.flat.w / e.flat.h < 1.33;
    const one = await deps.rig(source, { kind: round ? 'blob' : 'object', lane });
    return { rig: one.rig, confidence: 1, notes: one.notes, made, onePiece: true };
  }
  // Parts drawn on their bones are placed where they were drawn: no guessing.
  return { rig: r.rig, confidence: parts ? Math.max(r.confidence, 0.95) : r.confidence, notes: r.notes, made, onePiece: false };
}

export async function bringToLife(input: BringToLifeInput, deps: BringDeps = defaultDeps()): Promise<BringToLifeResult> {
  const { store } = deps;
  const maxSide = input.exportMax ?? (input.kind === 'background' ? 1920 : 1024);
  const exported = input.exported ?? (await deps.export(input.doc, maxSide, input.mode === 'bones' ? pairsOf(input.parts) : []));
  if (!exported) throw new Error(t('draw.drawFirst'));

  const artId = input.artId ?? uid('a_');
  const prev = await store.art.get(artId).catch(() => null);
  const rigged = await rigDrawing(deps, input, exported, prev?.rigData ?? null);

  const serialized = await serializeArtDoc(input.doc);
  const sticker = await deps.sticker(exported.flat.png).catch(() => exported.thumb.png);
  const flatRef = await blobRefOf(exported.flat.png);
  const thumbRef = await blobRefOf(exported.thumb.png);
  const stickerRef = await blobRefOf(sticker);
  const maskRef = exported.linesMask ? await blobRefOf(exported.linesMask.png) : null;
  const flip = input.frames ?? null;
  const flipRef = flip ? await blobRefOf(flip.atlas) : null;
  const frames: ArtExport['frames'] = flip && flipRef ? { atlas: flipRef, json: flip.json, move: flip.move, fps: flip.fps } : input.frames === null ? null : (prev?.export?.frames ?? null);
  const partBlobs: Blob[] = [];
  const parts: ArtExport['parts'] = {};
  for (const p of exported.parts ?? []) {
    parts[p.name] = { blob: await blobRefOf(p.png), x: 0, y: 0, w: p.w, h: p.h };
    partBlobs.push(p.png);
  }
  const now = Date.now();
  const record: ArtRecord = {
    id: artId,
    name: input.name,
    kind: input.kind,
    rig: rigged?.onePiece ? (rigged.rig.kind === 'blob' ? 'blob' : 'object') : input.rig,
    facing: input.facing ?? facingOf(rigged?.rig ?? null, prev?.facing ?? 'viewer'),
    role: input.role ?? prev?.role ?? null,
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
      parts,
      sticker: stickerRef,
      thumb: thumbRef,
      frames,
    },
    rigData: rigged?.rig ?? null,
    rigInfo: rigged ? { made: rigged.made, confidence: rigged.confidence, notes: rigged.notes } : null,
    palette: input.doc.palette.slice(0, 24),
    madeBy: 'student',
    shelf: input.shelf || (prev?.shelf ?? false),
    createdAt: prev?.createdAt ?? now,
    updatedAt: now,
    version: (prev?.version ?? 0) + 1,
  };

  // One commit: every blob first, then the JSON that points at them, and the draft goes in the same step.
  const blobs: Blob[] = [serialized.docBlob, ...serialized.cels.map((c) => c.blob), exported.flat.png, exported.thumb.png, sticker, ...partBlobs];
  if (exported.linesMask) blobs.push(exported.linesMask.png);
  if (flip) blobs.push(flip.atlas);
  const key = input.castKey;
  /** Reads the world, commits the drawing with its cast slot, then the footstep. */
  const commitAll = async (): Promise<World | null> => {
    let world: World | null = null;
    if (input.worldId && key) {
      const stored = await store.worlds.get(input.worldId);
      const open = deps.session?.world(input.worldId) ?? null;
      const w = open && (!stored || open.updatedAt >= stored.updatedAt) ? open : stored;
      if (w) {
        const slot = w.cast[key] ?? { key, art: null, madeBy: null, extra: null, laterUntil: 0 };
        world = { ...w, cast: { ...w.cast, [key]: { ...slot, art: record.id, madeBy: 'student' } }, updatedAt: now };
      }
    }
    await store.commit({ blobs, art: [record], worlds: world ? [world] : [], clearDrafts: [record.id] });
    // The footstep, after the drawing is safe.
    if (world && key) {
      const text = t(prev?.export ? 'draw.youRedrew' : 'draw.youDrew', { name: input.name });
      try {
        const stepped = await deps.history.record(world, { kind: prev?.export ? 'redraw' : 'draw', by: 'student', text, cast: key });
        if (stepped !== world) {
          await store.commit({ worlds: [stepped] });
          world = stepped;
        }
      } catch (err) {
        console.warn('The footstep was not recorded:', err);
      }
      deps.session?.adopt(world, key);
    }
    return world;
  };
  // A build landing meanwhile (or another change to a world that is not open) reads and writes the same stored
  // world: they take turns, so neither drops the other's change.
  const world = input.worldId && key ? await writeWorld(input.worldId, commitAll) : await commitAll();
  // The stroke log stays on this device ("Watch it drawn"): never in files, never sent.
  if (serialized.strokeLog) await keepStrokeLog(store, record.id, serialized.strokeLog).catch(() => undefined);

  let drawn: DrawnArt | null = null;
  if (world && key) {
    drawn = { key, image: exported.flat.png };
    if (record.rigData) drawn.rig = record.rigData;
    if (partBlobs.length) drawn.layers = Object.fromEntries((exported.parts ?? []).map((p) => [`part:${p.name}`, p.png]));
    if (frames) {
      const atlas = flip?.atlas ?? (await store.blobs.get(frames.atlas).catch(() => null));
      if (atlas) drawn.frames = { atlas, json: frames.json, move: frames.move, fps: frames.fps };
    }
    deps.player?.swapArt(drawn);
  }
  return {
    record,
    drawn,
    sticker: await store.blobs.url(stickerRef).catch(() => URL.createObjectURL(sticker)),
    lowConfidence: rigged !== null && rigged.made !== 'parts' && !rigged.onePiece && rigged.confidence < 0.6,
    onePiece: rigged?.onePiece ?? false,
    world,
  };
}

/** Refs a record's export needs (for tests and checks). */
export function exportRefs(e: ArtExport): BlobRef[] {
  return [e.flat, e.thumb, e.sticker, ...(e.inkMask ? [e.inkMask] : []), ...Object.values(e.parts).map((p) => p.blob), ...(e.frames ? [e.frames.atlas] : [])];
}
