/**
 * The `.amble` file (§4.6): a zip written and read with fflate. PNG, WAV and WebM are stored as they are
 * (level 0); JSON is deflated.
 *
 *   manifest.json          AmbleManifest
 *   world.json             World (absent for kind 'drawing')
 *   art/<artId>.json       ArtRecord
 *   blobs/<hex>.<ext>      every blob the world, art records and kept steps reference
 *   steps/<stepId>.json    the last 20 StepSnapshots
 *   thumb.png              320x180
 *
 * Never inside: stroke logs, drafts, the AI log, class codes, keys, settings. Collecting reads only the
 * world, its drawings, its footsteps and their blobs, so nothing else can slip in.
 */
import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from 'fflate';
import { BUILD } from '../app/env';
import { t } from '../i18n';
import { hexOfRef, sha256Hex, uid } from '../model/ids';
import { KEEP, LIMITS } from '../model/limits';
import type { AmbleFile, AmbleManifest, ArtId, ArtRecord, BlobRef, StepId, StepSnapshot, World, WorldId } from '../model/types';
import type { Store } from '../store/api';
import { megabytes } from '../store/quota';
import { FileProblem } from './problem';
import {
  artRefs,
  checkBlob,
  checkManifest,
  cleanArtRecord,
  cleanStep,
  cleanWorld,
  entryName,
  MIME_OF,
  sniff,
  soundRefs,
  stepRefs,
  type BlobExt,
} from './validate';

// ------------------------------------------------------------------ collecting what a file holds

export interface FileContents {
  manifest: AmbleManifest;
  world: World | null;
  art: ArtRecord[];
  steps: StepSnapshot[];
  blobs: Map<BlobRef, Blob>;
  thumb: Blob | null;
}

async function getBlobs(store: Store, refs: Iterable<BlobRef>, into: Map<BlobRef, Blob>): Promise<boolean> {
  let all = true;
  for (const ref of refs) {
    if (into.has(ref)) continue;
    const blob = await store.blobs.get(ref);
    if (blob) into.set(ref, blob);
    else all = false;
  }
  return all;
}

function manifestFor(kind: AmbleManifest['kind'], title: string, madeBy: string, assignmentId: string | null, now: number): AmbleManifest {
  return { format: 'amble-file', version: 2, kind, app: `Amble ${BUILD.version}`, title: title.slice(0, 40), savedAt: new Date(now).toISOString(), madeBy: madeBy.slice(0, 20), assignmentId, thumb: 'thumb.png' };
}

/**
 * Everything a world's file holds, read from the store. Anything whose pixels are missing from the store
 * is left out (a drawing becomes just bones, a footstep or a recorded sound is skipped), so every file
 * Amble writes opens again in full.
 */
export async function collectWorld(store: Store, world: World, kind: 'world' | 'assignment', now = Date.now()): Promise<FileContents> {
  if (kind === 'assignment' && !world.assignment) throw new Error('An assignment file needs an assignment.');
  const blobs = new Map<BlobRef, Blob>();
  const out: World = structuredClone(world);

  const art: ArtRecord[] = [];
  const artIds = [...new Set(Object.values(out.cast).flatMap((s) => (s.art ? [s.art] : [])))];
  const kept = new Set<ArtId>();
  for (const id of artIds) {
    const rec = await store.art.get(id);
    if (rec && (await getBlobs(store, artRefs(rec), blobs))) {
      art.push(rec);
      kept.add(id);
    }
  }
  for (const slot of Object.values(out.cast)) {
    if (slot.art && !kept.has(slot.art)) {
      slot.art = null;
      slot.madeBy = null;
    }
  }
  for (const [name, piece] of Object.entries(out.sounds)) {
    if (!(await getBlobs(store, soundRefs({ [name]: piece }), blobs))) delete out.sounds[name];
  }

  const steps: StepSnapshot[] = [];
  if (kind === 'world') {
    const ids = out.steps.map((s) => s.id);
    for (const sid of ids.slice(-KEEP.stepsInFile * 2).reverse()) {
      if (steps.length >= KEEP.stepsInFile) break;
      const snap = await store.steps.get(sid);
      if (snap && snap.worldId === world.id && (await getBlobs(store, stepRefs(snap), blobs))) steps.unshift(snap);
    }
  }

  let thumb: Blob | null = null;
  const meta = (await store.worlds.list()).find((m) => m.id === world.id);
  if (meta?.snapshot) thumb = await store.blobs.get(meta.snapshot);
  if (!thumb) {
    const hero = art.find((a) => a.export && out.cast.hero?.art === a.id) ?? art.find((a) => a.export);
    if (hero?.export) thumb = await store.blobs.get(hero.export.thumb);
  }

  const manifest = manifestFor(kind, out.title, out.credits.madeBy, out.assignment?.id ?? null, now);
  return { manifest, world: out, art, steps, blobs, thumb };
}

/** A kind 'drawing' file: one drawing, no world. */
export async function collectDrawing(store: Store, artId: ArtId, now = Date.now()): Promise<FileContents> {
  const rec = await store.art.get(artId);
  if (!rec) throw new Error('That drawing is not here.');
  const blobs = new Map<BlobRef, Blob>();
  if (!(await getBlobs(store, artRefs(rec), blobs))) throw new Error('Some of that drawing is missing.');
  const thumb = rec.export ? await store.blobs.get(rec.export.thumb) : null;
  return { manifest: manifestFor('drawing', rec.name, '', null, now), world: null, art: [rec], steps: [], blobs, thumb };
}

// ------------------------------------------------------------------ packing

async function bytesOf(blob: Blob): Promise<Uint8Array> {
  return new Uint8Array(await blob.arrayBuffer());
}

const json = (v: unknown) => strToU8(JSON.stringify(v));

/** Zips a file's contents. Only blobs that sniff as PNG, WAV, WebM or JSON go in (never SVG). */
export async function packAmble(c: FileContents): Promise<Blob> {
  const mtime = Date.parse(c.manifest.savedAt) || Date.now();
  const files: Zippable = {};
  files['manifest.json'] = [json(c.manifest), { level: 6 }];
  if (c.world) files['world.json'] = [json(c.world), { level: 6 }];
  for (const a of c.art) files[`art/${a.id}.json`] = [json(a), { level: 6 }];
  for (const s of c.steps) files[`steps/${s.id}.json`] = [json(s), { level: 6 }];
  for (const [ref, blob] of c.blobs) {
    const bytes = await bytesOf(blob);
    const ext = sniff(bytes);
    if (ext === 'svg' || ext === 'unknown') continue;
    files[`blobs/${hexOfRef(ref)}.${ext}`] = [bytes, { level: ext === 'json' ? 6 : 0 }];
  }
  if (c.thumb) {
    const bytes = await bytesOf(c.thumb);
    if (sniff(bytes) === 'png') files['thumb.png'] = [bytes, { level: 0 }];
  }
  const zipped = zipSync(files, { mtime: new Date(Math.max(mtime, Date.UTC(1981, 0, 1))) });
  return new Blob([zipped as Uint8Array<ArrayBuffer>], { type: 'application/x-amble' });
}

// ------------------------------------------------------------------ reading

const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04];
const EMPTY_ZIP = [0x50, 0x4b, 0x05, 0x06];

export function isZip(bytes: Uint8Array): boolean {
  return ZIP_MAGIC.every((b, i) => bytes[i] === b) || EMPTY_ZIP.every((b, i) => bytes[i] === b);
}

function parseJson(bytes: Uint8Array | undefined): unknown {
  if (!bytes) return undefined;
  try {
    return JSON.parse(strFromU8(bytes));
  } catch {
    return undefined;
  }
}

export function tooBig(size: number): FileProblem {
  return new FileProblem('too-big', t('files.tooBig', { mb: megabytes(size) }));
}

/** The ArtDoc JSON's cel refs (they must all be in the file). */
function docCelRefs(bytes: Uint8Array | undefined): BlobRef[] | null {
  const doc = parseJson(bytes) as { format?: unknown; cels?: unknown } | undefined;
  if (!doc || doc.format !== 'amble-art' || !Array.isArray(doc.cels)) return null;
  const refs: BlobRef[] = [];
  for (const c of doc.cels) {
    const ref = (c as { ref?: unknown } | null)?.ref;
    if (typeof ref !== 'string' || !/^sha256:[0-9a-f]{64}$/.test(ref)) return null;
    refs.push(ref as BlobRef);
  }
  return refs;
}

/**
 * Reads and validates a `.amble` file (§4.6). Throws `FileProblem` when it can't be opened at all; a file
 * that is partly damaged opens with what could be read, and says so in `warnings`.
 */
export async function readAmble(file: Blob, o: { manifestOnly?: boolean } = {}): Promise<AmbleFile> {
  if (file.size > LIMITS.ambleFileBytes) throw tooBig(file.size);
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!isZip(bytes)) throw new FileProblem('not-amble', t('files.notAmble'));

  let count = 0;
  let total = 0;
  let unsafe = false;
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(bytes, {
      filter: (info) => {
        if (++count > LIMITS.ambleFileEntries) throw new FileProblem('damaged', t('files.notAmble'));
        total += info.originalSize;
        if (info.originalSize > LIMITS.ambleFileBytes || total > LIMITS.ambleFileBytes) throw tooBig(total);
        const e = entryName(info.name);
        if (e.kind === 'unsafe') {
          unsafe = true;
          return false;
        }
        if (e.kind === 'unknown') return false;
        if (o.manifestOnly) return e.kind === 'manifest' || e.kind === 'thumb';
        return true;
      },
    });
  } catch (err) {
    if (err instanceof FileProblem) throw err;
    throw new FileProblem('damaged', t('files.notAmble'));
  }
  if (unsafe) throw new FileProblem('damaged', t('files.notAmble'));

  const checked = checkManifest(parseJson(entries['manifest.json']));
  if (!checked.ok) throw new FileProblem(checked.kind, checked.kind === 'newer' ? t('files.newer') : t('files.notAmble'));
  const manifest = checked.manifest;

  let thumb: Blob | null = null;
  const thumbBytes = entries['thumb.png'];
  if (thumbBytes && checkBlob('png', thumbBytes).ok) thumb = new Blob([thumbBytes as Uint8Array<ArrayBuffer>], { type: 'image/png' });

  const empty: AmbleFile = { manifest, world: null, art: [], steps: [], blobs: new Map(), thumb, readOnly: false, warnings: [] };
  if (o.manifestOnly) return empty;

  // Blobs: the name must be the SHA-256 of the bytes, and the bytes must be what the name says.
  const blobs = new Map<BlobRef, Blob>();
  const rawBlobs = new Map<BlobRef, Uint8Array>();
  let badBlobs = 0;
  for (const [name, data] of Object.entries(entries)) {
    const e = entryName(name);
    if (e.kind !== 'blob') continue;
    if (!checkBlob(e.ext, data).ok || (await sha256Hex(data)) !== e.hex) {
      badBlobs++;
      continue;
    }
    const ref = `sha256:${e.hex}` as BlobRef;
    rawBlobs.set(ref, data);
    blobs.set(ref, new Blob([data as Uint8Array<ArrayBuffer>], { type: MIME_OF[e.ext as BlobExt] }));
  }
  const has = (r: BlobRef) => blobs.has(r);

  // Drawings: each must clean, and every blob it needs must be here (its doc's cels too).
  const art: ArtRecord[] = [];
  let artEntries = 0;
  for (const [name, data] of Object.entries(entries)) {
    const e = entryName(name);
    if (e.kind !== 'art') continue;
    artEntries++;
    const rec = cleanArtRecord(parseJson(data));
    if (!rec || rec.id !== e.id || !artRefs(rec).every(has)) continue;
    const cels = docCelRefs(rawBlobs.get(rec.doc));
    if (!cels || !cels.every(has)) continue;
    art.push(rec);
  }
  const artOk = new Set(art.map((a) => a.id));

  let world: World | null = null;
  let wanted = artEntries;
  let lostOther = badBlobs > 0;
  if (manifest.kind !== 'drawing') {
    world = cleanWorld(parseJson(entries['world.json']));
    if (!world) throw new FileProblem('damaged', t('files.notAmble'));
    const referenced = new Set(Object.values(world.cast).flatMap((s) => (s.art ? [s.art] : [])));
    wanted = new Set([...referenced, ...art.map((a) => a.id)]).size;
    for (const slot of Object.values(world.cast)) {
      if (slot.art && !artOk.has(slot.art)) {
        slot.art = null;
        slot.madeBy = null;
      }
    }
    for (const [key, piece] of Object.entries(world.sounds)) {
      if (!soundRefs({ [key]: piece }).every(has)) {
        delete world.sounds[key];
        lostOther = true;
      }
    }
  } else if (!art.length) {
    throw new FileProblem('damaged', t('files.notAmble'));
  }

  // Footsteps: each must clean and have every blob; it always belongs to this world.
  const steps: StepSnapshot[] = [];
  for (const [name, data] of Object.entries(entries)) {
    const e = entryName(name);
    if (e.kind !== 'step' || !world) continue;
    const snap = cleanStep(parseJson(data));
    if (!snap || snap.id !== e.id || !stepRefs(snap).every(has)) {
      lostOther = true;
      continue;
    }
    steps.push({ ...snap, worldId: world.id });
  }
  if (world) {
    const order = new Map(world.steps.map((s, i) => [s.id, i]));
    steps.sort((a, b) => (order.get(a.id) ?? -1) - (order.get(b.id) ?? -1));
  }

  // Keep only the blobs something here uses.
  const used = new Set<BlobRef>([...art.flatMap(artRefs), ...art.flatMap((a) => docCelRefs(rawBlobs.get(a.doc)) ?? []), ...steps.flatMap(stepRefs), ...(world ? soundRefs(world.sounds) : [])]);
  for (const s of steps) for (const a of Object.values(s.art)) for (const r of docCelRefs(rawBlobs.get(a.doc)) ?? []) used.add(r);
  for (const ref of [...blobs.keys()]) if (!used.has(ref)) blobs.delete(ref);

  const warnings: string[] = [];
  if (art.length < wanted) warnings.push(t('files.partlyDamaged', { n: art.length, total: wanted }));
  else if (lostOther) warnings.push(t('files.damagedSome'));
  return { manifest, world, art, steps, blobs, thumb, readOnly: false, warnings };
}

// ------------------------------------------------------------------ importing with new ids

export interface Imported {
  world: World | null;
  art: ArtRecord[];
  steps: StepSnapshot[];
  /** Old art id → new art id. */
  artIds: Map<ArtId, ArtId>;
}

/**
 * Gives a file's world, drawings and footsteps fresh ids (a file opened twice never overwrites the
 * first copy), with every reference between them moved along.
 */
export function withNewIds(f: Pick<AmbleFile, 'world' | 'art' | 'steps'>, now = Date.now()): Imported {
  const artIds = new Map<ArtId, ArtId>();
  const artId = (old: ArtId): ArtId => {
    let next = artIds.get(old);
    if (!next) {
      next = uid('a_');
      artIds.set(old, next);
    }
    return next;
  };
  const stepIds = new Map<StepId, StepId>();
  const stepId = (old: StepId): StepId => {
    let next = stepIds.get(old);
    if (!next) {
      next = uid('s_');
      stepIds.set(old, next);
    }
    return next;
  };
  const art = f.art.map((a) => ({ ...structuredClone(a), id: artId(a.id), updatedAt: a.updatedAt || now }));
  let world: World | null = null;
  const worldId: WorldId = uid('w_');
  if (f.world) {
    const w = structuredClone(f.world);
    for (const slot of Object.values(w.cast)) if (slot.art) slot.art = artId(slot.art);
    w.steps = w.steps.map((s) => ({ ...s, id: stepId(s.id) }));
    w.head = w.head ? stepId(w.head) : (w.steps[w.steps.length - 1]?.id ?? '');
    world = { ...w, id: worldId, openedAt: now, createdAt: w.createdAt || now, updatedAt: w.updatedAt || now };
  }
  const steps = f.steps.map((s) => {
    const snap = structuredClone(s);
    const art: StepSnapshot['art'] = {};
    for (const [old, v] of Object.entries(snap.art)) art[artId(old)] = v;
    for (const slot of Object.values(snap.cast)) if (slot.art) slot.art = artId(slot.art);
    return { ...snap, art, id: stepId(s.id), worldId };
  });
  return { world, art, steps, artIds };
}
