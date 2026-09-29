import { del, get } from 'idb-keyval';
import type { LegacyProject } from './types';

/** The old editor autosaved its one project under this key, in idb-keyval's default store. */
export const LEGACY_AUTOSAVE_KEY = 'amble:project';

/** idb-keyval's default database. */
const LEGACY_DATABASE = 'keyval-store';

/** A drawing from an old project: a sprite's costume or a stage backdrop. */
export interface LegacyDrawing {
  /** The old asset id. */
  id: string;
  name: string;
  /** The sprite it belonged to, or "Stage" for a backdrop. */
  owner: string;
  backdrop: boolean;
  /** A data:image/ URL. Painted art is PNG; the old starter art and blank backdrops are SVG. */
  dataUrl: string;
  mime: string;
  /** Natural size in pixels (0 when the save doesn't say). */
  width: number;
  height: number;
  /** Image pixels per old stage unit: 2 for painted bitmaps, 1 for SVG. */
  resolution: number;
  /** The rotation center (pivot) in image pixels. */
  centerX: number;
  centerY: number;
}

/** A sound from an old project. */
export interface LegacySound {
  /** The old asset id. */
  id: string;
  name: string;
  /** The sprite it belonged to, or "Stage". */
  owner: string;
  /** A data: URL. */
  dataUrl: string;
  mime: string;
  /** Seconds (0 when the save doesn't say). */
  duration: number;
}

/** What an old project brings into the new Amble: its drawings and sounds. */
export interface LegacyImport {
  title: string;
  /** The game's description in the author's words. */
  notes: string;
  /** The sprites' drawings first, in sprite order, then the backdrops. */
  drawings: LegacyDrawing[];
  sounds: LegacySound[];
}

type Loose = Record<string, unknown>;

const isRecord = (value: unknown): value is Loose => typeof value === 'object' && value !== null;
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const text = (value: unknown, fallback: string): string => (typeof value === 'string' && value.trim() ? value : fallback);
const finite = (value: unknown, fallback: number): number => (typeof value === 'number' && Number.isFinite(value) ? value : fallback);
const positive = (value: unknown, fallback: number): number => (finite(value, 0) > 0 ? (value as number) : fallback);

/** The media type in a data: URL's header ("data:image/png;base64,…" is image/png). */
function dataUrlMime(url: string): string {
  return /^data:([^;,]+)/i.exec(url)?.[1].toLowerCase() ?? 'application/octet-stream';
}

/** The old editor's own test for a saved project. */
export function isLegacyProject(value: unknown): value is LegacyProject {
  return isRecord(value) && value.format === 'amble' && isRecord(value.stage) && Array.isArray(value.sprites) && (value.mode === '2d' || value.mode === '3d');
}

function drawingFrom(asset: unknown, owner: string, backdrop: boolean, index: number): LegacyDrawing | null {
  if (!isRecord(asset) || asset.kind !== 'image' || typeof asset.dataUrl !== 'string' || !/^data:image\//i.test(asset.dataUrl)) return null;
  const width = positive(asset.width, 0);
  const height = positive(asset.height, 0);
  return {
    id: text(asset.id, `drawing-${index + 1}`),
    name: text(asset.name, backdrop ? 'backdrop' : 'drawing'),
    owner,
    backdrop,
    dataUrl: asset.dataUrl,
    mime: text(asset.mime, dataUrlMime(asset.dataUrl)),
    width,
    height,
    resolution: positive(asset.resolution, 1),
    centerX: finite(asset.centerX, width / 2),
    centerY: finite(asset.centerY, height / 2),
  };
}

function soundFrom(asset: unknown, owner: string, index: number): LegacySound | null {
  if (!isRecord(asset) || asset.kind !== 'sound' || typeof asset.dataUrl !== 'string' || !/^data:/i.test(asset.dataUrl)) return null;
  return {
    id: text(asset.id, `sound-${index + 1}`),
    name: text(asset.name, 'sound'),
    owner,
    dataUrl: asset.dataUrl,
    mime: text(asset.mime, dataUrlMime(asset.dataUrl)),
    duration: positive(asset.duration, 0),
  };
}

/**
 * The drawings and sounds in an old project (the autosave, or a parsed old .amble file), or null
 * when the value isn't one. Only what the student made or added comes along: 3D models, blocks
 * and everything the AI compiler made (its art included) stay behind, anything that isn't a
 * data: URL is skipped, and exact copies (duplicated sprites and costumes share their images)
 * come once.
 */
export function legacyImportFrom(value: unknown): LegacyImport | null {
  if (!isLegacyProject(value)) return null;
  const targets: Array<{ target: unknown; stage: boolean }> = [
    ...list(value.sprites).map((target) => ({ target, stage: false })),
    { target: value.stage, stage: true },
  ];
  const seen = new Set<string>();
  const firstTime = (dataUrl: string): boolean => {
    if (seen.has(dataUrl)) return false;
    seen.add(dataUrl);
    return true;
  };
  const drawings: LegacyDrawing[] = [];
  const sounds: LegacySound[] = [];
  for (const { target, stage } of targets) {
    if (!isRecord(target)) continue;
    const owner = stage ? 'Stage' : text(target.name, 'Unnamed');
    for (const asset of list(target.costumes)) {
      const drawing = drawingFrom(asset, owner, stage, drawings.length);
      if (drawing && firstTime(drawing.dataUrl)) drawings.push(drawing);
    }
    for (const asset of list(target.sounds)) {
      const sound = soundFrom(asset, owner, sounds.length);
      if (sound && firstTime(sound.dataUrl)) sounds.push(sound);
    }
  }
  return {
    title: text(value.title, 'Untitled game'),
    notes: typeof value.notes === 'string' ? value.notes : '',
    drawings,
    sounds,
  };
}

/** Opening a database creates it, so where the browser can list its databases, look first. */
async function readOldStore(key: string): Promise<unknown> {
  if (typeof indexedDB.databases === 'function') {
    const databases = await indexedDB.databases();
    if (!databases.some((db) => db.name === LEGACY_DATABASE)) return undefined;
  }
  return get(key);
}

/**
 * Forgets the old editor's autosave, for "Delete everything Amble keeps on this Chromebook": after it, the
 * next student on a shared Chromebook is not offered the last one's old drawings. Only its one key goes,
 * never the database, which idb-keyval shares with anything else on this origin; and where the browser
 * can list its databases, a missing one is not created. `remove` replaces the IndexedDB delete in tests.
 */
export async function forgetLegacyAutosave(remove: (key: string) => Promise<void> = removeFromOldStore): Promise<void> {
  try {
    await remove(LEGACY_AUTOSAVE_KEY);
  } catch {
    // Storage blocked or no old store: nothing is kept there.
  }
}

async function removeFromOldStore(key: string): Promise<void> {
  if (typeof indexedDB === 'undefined') return;
  if (typeof indexedDB.databases === 'function') {
    const databases = await indexedDB.databases();
    if (!databases.some((db) => db.name === LEGACY_DATABASE)) return;
  }
  await del(key);
}

/**
 * The drawings and sounds of the old editor's autosave in this browser, or null when there is
 * none or it can't be read. It only reads: the old save is never changed or removed, so nothing
 * is lost if an import fails. `read` replaces the IndexedDB read in tests.
 */
export async function readLegacyAutosave(read: (key: string) => Promise<unknown> = readOldStore): Promise<LegacyImport | null> {
  try {
    return legacyImportFrom(await read(LEGACY_AUTOSAVE_KEY));
  } catch {
    return null;
  }
}
