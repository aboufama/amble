/**
 * Old Amble projects (§4.7): a clean break for games (block programs cannot become kit code) and a
 * one-way rescue of the student's own drawings and sounds.
 * - `find`: at first boot, the old editor's autosave, unless `settings.legacy` says it was already
 *   brought in or dismissed.
 * - `bring`: a Parade world titled "{title} (old)". Each drawing becomes an `ArtRecord` with one `paint`
 *   layer (SVGs rasterized at 2x), `madeBy: 'import'`, its pivot from the old rotation centre; costumes
 *   become characters (rig `blob`, which always hops), backdrops become backgrounds. Each sound becomes a
 *   recording. Blocks, compiled code, AI-made art and 3D models are dropped (the reader never returns
 *   them). The old save is only ever read; `settings.legacy` stores its hash.
 */
import { newArtDoc, serializeArtDoc } from '../cores/art';
import { rigWorker, templateFor, type RigData } from '../cores/rig';
import type { HistoryApi } from '../history/api';
import { t } from '../i18n';
import { legacyImportFrom, readLegacyAutosave, type LegacyDrawing, type LegacyImport, type LegacySound } from '../legacy/reader';
import { blobRefOf, CAST_KEY_RE, hexOfRef, sha256Hex, uid } from '../model/ids';
import { LIMITS, TEXT_LIMITS } from '../model/limits';
import type { ArtRecord, CastSlot, SoundPiece, World, WorldId } from '../model/types';
import type { StarterCatalog } from '../starters/api';
import type { Store } from '../store/api';
import { dataUrlBytes, type PictureMaker, type SoundMaker } from './media';

export interface LegacyDeps {
  store: Store;
  starters: StarterCatalog;
  history: HistoryApi | null;
  pictures: PictureMaker;
  sounds: SoundMaker;
  /** Replaces the old IndexedDB read (tests). */
  read?: (key: string) => Promise<unknown>;
  now?: () => number;
}

/** A stable fingerprint of an old project's drawings and sounds (what `settings.legacy.hash` keeps). */
export async function legacyHash(l: LegacyImport): Promise<string> {
  const text = JSON.stringify([l.title, l.drawings.map((d) => d.dataUrl), l.sounds.map((s) => s.dataUrl)]);
  return sha256Hex(new TextEncoder().encode(text));
}

export async function findLegacy(deps: Pick<LegacyDeps, 'store' | 'read'>): Promise<LegacyImport | null> {
  try {
    if (await deps.store.settings.get('legacy')) return null;
  } catch {
    return null;
  }
  const found = await readLegacyAutosave(deps.read);
  return found && (found.drawings.length || found.sounds.length) ? found : null;
}

export async function dismissLegacy(deps: Pick<LegacyDeps, 'store' | 'now'>, l: LegacyImport | null): Promise<void> {
  const hash = l ? await legacyHash(l) : '';
  await deps.store.settings.put('legacy', { hash, at: (deps.now ?? Date.now)(), choice: 'dismissed' });
}

/** A cast key from a name ("cat walk" → "catWalk"), unique in `taken`. */
export function castKeyFrom(text: string, taken: Set<string>, fallback = 'drawing'): string {
  const words = text
    .normalize('NFKD')
    .replace(/[^A-Za-z0-9 ]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  let key = words.map((w, i) => (i === 0 ? w.toLowerCase() : w[0].toUpperCase() + w.slice(1).toLowerCase())).join('');
  key = key.replace(/^[^a-z]+/, '');
  if (!key) key = fallback;
  key = key.slice(0, 20);
  let out = key;
  for (let n = 2; taken.has(out) || !CAST_KEY_RE.test(out); n++) out = `${key.slice(0, 20)}${n}`;
  taken.add(out);
  return out;
}

interface MadeDrawing {
  record: ArtRecord;
  blobs: Blob[];
}

async function drawingFrom(d: LegacyDrawing, deps: LegacyDeps, now: number): Promise<MadeDrawing | null> {
  const { bytes, mime } = dataUrlBytes(d.dataUrl);
  const svg = mime === 'image/svg+xml' || d.mime === 'image/svg+xml';
  const kind = d.backdrop ? 'background' : 'character';
  const maxSide = d.backdrop ? LIMITS.backgroundWidth : LIMITS.boardMaxSide;
  // SVGs are drawn at 2x; painted bitmaps already are (resolution 2).
  const scale = svg ? 2 : 1;
  const pic = await deps.pictures.prepare(bytes, svg ? 'image/svg+xml' : mime, { scale, maxSide, width: d.width || undefined, height: d.height || undefined });
  if (!pic) return null;
  const k = pic.board.w / Math.max(1, d.width || pic.board.w / scale);
  const pivot: [number, number] = [d.centerX * k, d.centerY * k];

  const doc = newArtDoc({
    name: d.name.slice(0, TEXT_LIMITS.artName),
    kind,
    rig: d.backdrop ? undefined : 'blob',
    width: pic.board.w,
    height: pic.board.h,
    layers: [{ id: 'paint', role: 'paint', name: 'Paint' }],
    anchor: d.backdrop ? null : pivot,
  });
  doc.cels = [{ frame: doc.frames[0].id, layer: 'paint', x: 0, y: 0, w: pic.board.w, h: pic.board.h, png: pic.board.png }];
  const serialized = await serializeArtDoc(doc);

  const flatRef = await blobRefOf(pic.flat.png);
  const anchor: [number, number] = d.backdrop ? [pic.flat.w / 2, pic.flat.h / 2] : [pivot[0] - pic.flat.x, pivot[1] - pic.flat.y];
  let rigData: RigData | null = null;
  let confidence = 0;
  let notes: string[] = [];
  if (!d.backdrop) {
    try {
      if (!pic.pixels) throw new Error('no pixels');
      const r = await rigWorker.autoRig({ image: pic.pixels }, { kind: 'blob' });
      rigData = r.rig;
      confidence = r.confidence;
      notes = r.notes;
    } catch {
      rigData = templateFor('blob', pic.flat.w, pic.flat.h);
      confidence = 0.3;
    }
    rigData = { ...rigData, artHash: hexOfRef(flatRef) };
  }
  const [stickerRef, thumbRef] = await Promise.all([blobRefOf(pic.sticker), blobRefOf(pic.thumb)]);
  const record: ArtRecord = {
    id: uid('a_'),
    name: d.name.slice(0, TEXT_LIMITS.artName) || (d.backdrop ? 'Sky' : 'Drawing'),
    kind,
    rig: d.backdrop ? 'none' : 'blob',
    facing: 'viewer',
    role: d.backdrop ? 'background' : null,
    mode: 'free',
    board: { w: pic.board.w, h: pic.board.h, pixelArt: false },
    doc: serialized.docRef,
    cels: serialized.cels.map((c) => c.ref),
    parts: {},
    export: { hash: hexOfRef(flatRef), flat: flatRef, w: pic.flat.w, h: pic.flat.h, anchor, inkMask: null, parts: {}, sticker: stickerRef, thumb: thumbRef, frames: null },
    rigData,
    rigInfo: rigData ? { made: 'auto', confidence, notes } : null,
    palette: [],
    madeBy: 'import',
    shelf: !d.backdrop,
    createdAt: now,
    updatedAt: now,
    version: 1,
  };
  return { record, blobs: [serialized.docBlob, ...serialized.cels.map((c) => c.blob), pic.flat.png, pic.thumb, pic.sticker] };
}

async function soundFrom(s: LegacySound, deps: LegacyDeps, name: string): Promise<{ piece: SoundPiece; blob: Blob } | null> {
  const { bytes } = dataUrlBytes(s.dataUrl);
  const kept = await deps.sounds.toKept(bytes);
  if (!kept) return null;
  const blob = new Blob([kept.bytes as Uint8Array<ArrayBuffer>], { type: kept.mime });
  const duration = Math.min(60, Math.max(0, kept.duration || s.duration || 0));
  return {
    piece: { name, source: { kind: 'recording', blob: await blobRefOf(blob), mime: kept.mime, duration }, effects: [], caption: `[${s.name.slice(0, 70)}]`, madeBy: 'student' },
    blob,
  };
}

function uniqueSoundName(name: string, taken: Set<string>): string {
  const base = name.trim().slice(0, 36) || 'sound';
  let out = base;
  for (let n = 2; taken.has(out.toLowerCase()); n++) out = `${base} ${n}`;
  taken.add(out.toLowerCase());
  return out;
}

export interface BringResult {
  worldId: WorldId;
  title: string;
  drawings: number;
  sounds: number;
}

/** Brings an old project's drawings and sounds into a new world. The old save is never touched. */
export async function bringLegacy(deps: LegacyDeps, l: LegacyImport): Promise<BringResult> {
  const now = (deps.now ?? Date.now)();
  const opened = await deps.starters.open('parade', { withArt: false });
  const base = opened.world;
  const title = t('files.legacy_title', { title: l.title.trim().slice(0, TEXT_LIMITS.worldTitle - 6) || 'My game' }).slice(0, TEXT_LIMITS.worldTitle);

  const art: ArtRecord[] = [...opened.art];
  const blobs: Blob[] = [...opened.blobs];
  const cast: Record<string, CastSlot> = { ...base.cast };
  const taken = new Set(Object.keys(cast));
  const heroFree = cast.hero && cast.hero.art === null && cast.hero.extra === null;
  let heroTaken = false;
  for (const d of l.drawings) {
    let made: MadeDrawing | null = null;
    try {
      made = await drawingFrom(d, deps, now);
    } catch (err) {
      console.warn('An old drawing could not be brought in:', err);
    }
    if (!made) continue;
    art.push(made.record);
    blobs.push(...made.blobs);
    if (!d.backdrop && heroFree && !heroTaken) {
      heroTaken = true;
      cast.hero = { ...cast.hero, art: made.record.id, madeBy: 'import' };
      continue;
    }
    const key = castKeyFrom(d.backdrop ? `sky ${d.name}` : `${d.owner} ${d.name}`, taken);
    cast[key] = {
      key,
      art: made.record.id,
      madeBy: 'import',
      extra: { name: made.record.name, role: d.backdrop ? 'background' : 'npc', kind: made.record.kind, rig: made.record.rig, note: d.owner === 'Stage' ? '' : d.owner.slice(0, 300) },
      laterUntil: 0,
    };
  }

  const sounds: Record<string, SoundPiece> = { ...base.sounds };
  const names = new Set(Object.keys(sounds).map((n) => n.toLowerCase()));
  let soundCount = 0;
  for (const s of l.sounds) {
    try {
      const made = await soundFrom(s, deps, uniqueSoundName(s.name, names));
      if (!made) continue;
      sounds[made.piece.name] = made.piece;
      blobs.push(made.blob);
      soundCount++;
    } catch (err) {
      console.warn('An old sound could not be brought in:', err);
    }
  }

  let world: World = {
    ...base,
    title,
    pitch: l.notes.slice(0, TEXT_LIMITS.worldPitch),
    origin: { kind: 'import-v1', title: l.title.slice(0, 200) },
    cast,
    sounds,
    createdAt: now,
    updatedAt: now,
    openedAt: now,
  };
  await deps.store.commit({ blobs, art, worlds: [world] });
  if (deps.history) {
    try {
      world = await deps.history.record(world, { kind: 'import', by: 'student', text: t('files.stepBrought') });
      await deps.store.commit({ worlds: [world] });
    } catch (err) {
      console.warn('The import footstep was not recorded:', err);
    }
  }
  await deps.store.settings.put('legacy', { hash: await legacyHash(l), at: now, choice: 'brought' });
  return { worldId: world.id, title, drawings: art.length - opened.art.length, sounds: soundCount };
}

/** An old `.amble` JSON file (format 'amble', version 1) goes through the same rescue. */
export function legacyFromFileText(text: string): LegacyImport | null {
  try {
    return legacyImportFrom(JSON.parse(text));
  } catch {
    return null;
  }
}
