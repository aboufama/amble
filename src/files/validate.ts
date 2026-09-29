/**
 * Validation of `.amble` files (§4.6), hand-written, no dependency. Everything in a file is untrusted:
 * - the manifest's shape and version (a newer file says so; an unknown kind is not an Amble file);
 * - at most 2,000 entries and 60 MB in total, and only safe entry names;
 * - every JSON cleaned to the §4.2 shapes (unknown fields dropped, strings capped, ids re-checked), then
 *   checked again with the model's own guards;
 * - blobs by magic bytes (PNG, WAV, WebM, JSON), PNG sizes read from the header before any decoding,
 *   and SVG never accepted as art.
 * Strings are only ever rendered as text; code only ever runs in the sandbox.
 */
import { SOUND_EFFECTS, type SoundEffect } from '../audio/effects';
import type { SynthSegment } from '../audio/synth';
import { ACTIONS, ART_KINDS, RIG_KINDS, ROLES } from '../cores/play';
import { CHARACTER_KINDS, parseRig, type CharacterKind, type RigBone, type RigData } from '../cores/rig';
import { isArtRecord, isRigData, isStepSnapshot, isWorld, STARTER_IDS, STEP_KINDS } from '../model/guards';
import { BLOB_REF_RE, CAST_KEY_RE, CODE_PATH_RE } from '../model/ids';
import { KEEP, LIMITS, TEXT_LIMITS } from '../model/limits';
import type * as M from '../model/types';
import { arr, arrLoose, bool, FAIL, int, lit, nullable, num, obj, oneOf, opt, orElse, pattern, rec, str, tagged, tuple, type Cleaner } from './clean';

// ------------------------------------------------------------------ small pieces

/** Ids inside a file: safe characters only (they become entry names). New ids are given on import. */
export const SAFE_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const id = pattern(SAFE_ID_RE);
const castKey = pattern(CAST_KEY_RE);
const blobRef = pattern(BLOB_REF_RE) as Cleaner<M.BlobRef>;
const isCastKeyText = (k: string) => CAST_KEY_RE.test(k);
const isSafeId = (k: string) => SAFE_ID_RE.test(k);

const role = oneOf<M.Role>(ROLES);
const artKind = oneOf<M.ArtKind>(ART_KINDS);
const rigKind = oneOf<M.RigKind>(RIG_KINDS);
const facing = oneOf<M.Facing>(['viewer', 'right', 'left']);
const pronoun = oneOf<M.Pronoun>(['him', 'her', 'them', 'it']);
const level = oneOf<M.Level>(['elementary', 'middle', 'high']);
const aiMode = oneOf<M.AiMode>(['on', 'explain', 'off']);
const author = oneOf<M.Author>(['starter', 'ai', 'student', 'teacher']);
const starterId = oneOf<M.StarterId>(STARTER_IDS);
const point = tuple(num(), num());
const lineRange = tuple(int(1), int(1)) as Cleaner<M.LineRange>;

// ------------------------------------------------------------------ code

/** Code files as kept in a world: a real path, the source, provenance runs that add up, locked lines in range. */
const MAX_SOURCE = 64 * 1024;

function lineCount(source: string): number {
  return source === '' ? 0 : source.split('\n').length;
}

/** Provenance runs cut or stretched to the file's line count (M9's gutter relies on the sum). */
export function fitAuthors(runs: M.AuthorRun[], lines: number): M.AuthorRun[] {
  const out: M.AuthorRun[] = [];
  let left = lines;
  for (const [who, n] of runs) {
    if (left <= 0) break;
    const take = Math.min(n, left);
    if (take > 0) out.push([who, take]);
    left -= take;
  }
  if (left > 0) {
    const last = out[out.length - 1];
    if (last) last[1] += left;
    else out.push(['student', left]);
  }
  return out;
}

const codeFile: Cleaner<M.CodeFile> = (v) => {
  const base = obj<M.CodeFile>({
    path: pattern(CODE_PATH_RE),
    source: (s) => (typeof s === 'string' && s.length <= MAX_SOURCE ? s : FAIL),
    authors: arr(tuple(author, int(0)) as Cleaner<M.AuthorRun>, 10_000),
    locked: arrLoose(lineRange, 200),
  })(v);
  if (base === FAIL) return FAIL;
  const lines = lineCount(base.source);
  return {
    ...base,
    authors: fitAuthors(base.authors, lines),
    locked: base.locked.filter(([a, b]) => a <= b && b <= Math.max(lines, 1)),
  };
};

const code: Cleaner<M.CodeFile[]> = (v) => {
  const files = arr(codeFile, LIMITS.codeFiles)(v);
  if (files === FAIL) return FAIL;
  const paths = new Set(files.map((f) => f.path));
  return paths.size === files.length && paths.has('game.js') ? files : FAIL;
};

// ------------------------------------------------------------------ cast, sounds, steps

const castExtra = obj<M.CastExtra>({ name: str(80), role, kind: artKind, rig: rigKind, note: str(300) });

const castSlot = obj<M.CastSlot>({
  key: castKey,
  art: nullable(id),
  madeBy: nullable(oneOf(['student', 'example', 'teacher', 'import'])),
  extra: nullable(castExtra),
  laterUntil: orElse(num(0), 0),
});

/** The cast: each slot keyed by its own key (a mismatch is mended from the record's key). */
const cast: Cleaner<Record<M.CastKey, M.CastSlot>> = (v) => {
  const slots = rec(castSlot, isCastKeyText, 64)(v);
  if (slots === FAIL) return FAIL;
  for (const [k, s] of Object.entries(slots)) s.key = k;
  return slots;
};

const synthSegment = obj<SynthSegment>({
  wave: oneOf(['sine', 'square', 'triangle', 'sawtooth', 'noise']),
  startFreq: num(0, 40000),
  endFreq: num(0, 40000),
  duration: num(0, 60),
  startVolume: num(0, 1),
  endVolume: num(0, 1),
});

const soundSource = tagged<M.SoundPiece['source']>('kind', {
  preset: obj<Extract<M.SoundPiece['source'], { kind: 'preset' }>>({ kind: lit('preset'), preset: str(40, 1), variation: lit(0, 1, 2) }),
  synth: obj<Extract<M.SoundPiece['source'], { kind: 'synth' }>>({ kind: lit('synth'), recipe: obj({ segments: arr(synthSegment, 64) }) }),
  recording: obj<Extract<M.SoundPiece['source'], { kind: 'recording' }>>({
    kind: lit('recording'),
    blob: blobRef,
    mime: lit('audio/wav', 'audio/webm'),
    duration: num(0, 60),
  }),
});

const soundPiece = obj<M.SoundPiece>({
  name: str(40, 1),
  source: soundSource,
  effects: arrLoose(oneOf<SoundEffect>(SOUND_EFFECTS.map((e) => e.id)), 16),
  caption: str(80),
  madeBy: oneOf(['student', 'example']),
});

const sounds = rec(soundPiece, (k) => k.length > 0 && k.length <= 40, LIMITS.sounds * 2);

const stepSummary = obj<M.StepSummary>({
  id,
  at: num(0),
  by: oneOf(['student', 'ai', 'auto', 'teacher']),
  kind: oneOf<M.StepKind>(STEP_KINDS),
  text: str(300),
  request: opt(str(2000)),
  files: opt(arrLoose(str(40), 16)),
  cast: opt(castKey),
  lines: opt(int(0)),
  tested: opt(bool),
  handEdits: opt(bool),
});

const dials = rec(num(), (k) => k.length > 0 && k.length <= 64, 64);
const twists = arrLoose(str(40, 1), 32);
const controls = rec(arrLoose(str(32), 8), (k) => (ACTIONS as readonly string[]).includes(k));
const gameStorage: Cleaner<Record<string, string>> = (v) => {
  const out = rec(str(KEEP.gameStorageBytes), (k) => k.length <= 200, 500)(v);
  if (out === FAIL) return {};
  let bytes = 0;
  const kept: Record<string, string> = {};
  for (const [k, x] of Object.entries(out)) {
    bytes += k.length + x.length;
    if (bytes > KEEP.gameStorageBytes) break;
    kept[k] = x;
  }
  return kept;
};

// ------------------------------------------------------------------ school and plans

const goalId = pattern(/^[A-Za-z0-9_-]{1,64}$/);

const autoCheck = tagged<M.AutoCheck>('type', {
  drawn: obj({ type: lit('drawn'), key: castKey }),
  'min-drawings': obj({ type: lit('min-drawings'), n: int(0, 64) }),
  'runs-clean': obj({ type: lit('runs-clean') }),
  'boss-attacks': obj({ type: lit('boss-attacks'), min: int(0, 64) }),
  'uses-dials': obj({ type: lit('uses-dials'), min: int(0, 64) }),
  'has-win-and-lose': obj({ type: lit('has-win-and-lose') }),
  'brain-states': obj({ type: lit('brain-states'), min: int(0, 64) }),
  captions: obj({ type: lit('captions') }),
});

const goal = tagged<M.Goal>('kind', {
  teacher: obj<Extract<M.Goal, { kind: 'teacher' }>>({ id: goalId, label: str(120), kind: lit('teacher') }),
  auto: obj<Extract<M.Goal, { kind: 'auto' }>>({ id: goalId, label: str(120), kind: lit('auto'), check: autoCheck }),
});

export const assignment = obj<M.Assignment>({
  id: goalId,
  title: str(TEXT_LIMITS.assignmentTitle),
  text: str(TEXT_LIMITS.assignmentText),
  starter: nullable(starterId),
  require: arrLoose(castKey, 16),
  goals: arrLoose(goal, 24),
  ai: aiMode,
  level: nullable(level),
  due: str(40),
  locked: rec(arrLoose(lineRange, 200), (k) => CODE_PATH_RE.test(k), 8),
});

const handIn = obj<M.HandInState>({
  fileName: nullable(str(255)),
  savedAt: nullable(num(0)),
  method: nullable(oneOf(['fs-access', 'download'])),
  turnedInAt: nullable(num(0)),
});

const planCastItem = obj<M.PlanCastItem>({
  key: castKey,
  name: str(60),
  ask: str(TEXT_LIMITS.planAsk),
  about: str(TEXT_LIMITS.planAbout),
  role,
  kind: artKind,
  rig: rigKind,
  facing,
  pronoun,
  size: oneOf(['tiny', 'small', 'hero', 'big', 'huge', 'screen']),
  required: bool,
  mapsTo: str(24),
});

const plan = obj<M.PlanReply>({
  status: oneOf(['ok', 'toned_down', 'refused', 'crisis']),
  safetyNote: str(300),
  title: str(TEXT_LIMITS.planTitle),
  pitch: str(TEXT_LIMITS.planPitch),
  starter: starterId,
  twist: obj({ name: str(40), does: str(140) }),
  controls: arrLoose(obj({ keys: str(40), does: str(80) }), TEXT_LIMITS.planControls),
  cast: arrLoose(planCastItem, TEXT_LIMITS.planCastMax),
  builds: arrLoose(str(160), TEXT_LIMITS.planBuildsMax),
  dials: arrLoose(obj({ key: str(24, 1), label: str(24) }), TEXT_LIMITS.planDialsMax),
});

const origin = tagged<M.WorldOrigin>('kind', {
  starter: obj<Extract<M.WorldOrigin, { kind: 'starter' }>>({ kind: lit('starter'), starter: starterId, withArt: bool }),
  plan: obj<Extract<M.WorldOrigin, { kind: 'plan' }>>({ kind: lit('plan'), starter: starterId, planTitle: str(80) }),
  assignment: obj<Extract<M.WorldOrigin, { kind: 'assignment' }>>({ kind: lit('assignment'), assignmentId: goalId, starter: nullable(starterId) }),
  file: obj<Extract<M.WorldOrigin, { kind: 'file' }>>({ kind: lit('file'), fileName: str(255) }),
  parade: obj<Extract<M.WorldOrigin, { kind: 'parade' }>>({ kind: lit('parade') }),
  'import-v1': obj<Extract<M.WorldOrigin, { kind: 'import-v1' }>>({ kind: lit('import-v1'), title: str(200) }),
});

// ------------------------------------------------------------------ the world

const worldShape = obj<M.World>({
  format: lit('amble-world'),
  version: lit(1),
  id,
  title: str(TEXT_LIMITS.worldTitle),
  pitch: str(TEXT_LIMITS.worldPitch),
  level: orElse(level, 'middle'),
  createdAt: orElse(num(0), 0),
  updatedAt: orElse(num(0), 0),
  openedAt: orElse(num(0), 0),
  origin: orElse(origin, { kind: 'parade' }),
  code,
  cast,
  sounds: orElse(sounds, {}),
  dials: orElse(dials, {}),
  twists: orElse(twists, []),
  controls: orElse(controls, {}),
  gameStorage,
  steps: orElse(arrLoose(stepSummary), []),
  head: orElse(str(64), ''),
  assignment: orElse(nullable(assignment), null),
  handIn: orElse(handIn, { fileName: null, savedAt: null, method: null, turnedInAt: null }),
  credits: orElse(obj({ madeBy: str(TEXT_LIMITS.madeBy) }), { madeBy: '' }),
  plan: orElse(nullable(plan), null),
});

/** A world from a file, cleaned; null when it can't be read as one. */
export function cleanWorld(v: unknown): M.World | null {
  const w = worldShape(v);
  if (w === FAIL) return null;
  if (!w.steps.some((s) => s.id === w.head)) w.head = w.steps[w.steps.length - 1]?.id ?? '';
  return isWorld(w) ? w : null;
}

// ------------------------------------------------------------------ drawings

const partBlob = obj<M.ArtExport['parts'][string]>({ blob: blobRef, x: num(), y: num(), w: num(0), h: num(0) });

const artExport = obj<M.ArtExport>({
  hash: str(128, 1),
  flat: blobRef,
  w: num(1, 4096),
  h: num(1, 4096),
  anchor: point,
  inkMask: nullable(blobRef),
  parts: rec(partBlob, (k) => k.length > 0 && k.length <= 64, 64),
  sticker: blobRef,
  thumb: blobRef,
  frames: nullable(obj({ atlas: blobRef, json: str(256 * 1024), move: str(20, 1), fps: num(1, 60) })),
});

const rigBone = obj<RigBone>({
  name: str(40, 1),
  role: str(20, 1) as Cleaner<RigBone['role']>,
  parent: int(-1, 127),
  x: num(),
  y: num(),
  x2: num(),
  y2: num(),
  dynamic: opt(obj({ stiffness: num(0, 1), damping: num(0, 1), gravity: num() })),
  rigid: opt(bool),
});

const rigShape = obj<RigData>({
  format: lit('amble-rig'),
  v: lit(1),
  kind: oneOf<CharacterKind>(CHARACTER_KINDS),
  facing: lit(1, -1, 0),
  anchor: point,
  bones: arr(rigBone, 128),
  parts: opt(arrLoose(obj({ name: str(40, 1), bones: arrLoose(str(40, 1), 128), order: num(), layer: opt(str(64)) }), 64)),
  skin: opt(obj({ cell: opt(num(1)), blend: opt(num(0)) })),
  artHash: str(128),
  made: orElse(oneOf(['auto', 'ai', 'hand']), 'auto'),
  anims: opt(rec(obj({ speed: opt(num(0)), amount: opt(num(0)), off: opt(bool) }), (k) => k.length > 0 && k.length <= 20, 32)),
});

/** A rig from a file: cleaned, then the model's guard and the rig core's parser must both accept it, or it is dropped. */
export const rigData: Cleaner<RigData | null> = (v) => {
  if (v === null || v === undefined) return null;
  const clean = rigShape(v);
  if (clean === FAIL) return null;
  try {
    const rig = parseRig(clean);
    return isRigData(rig) ? rig : null;
  } catch {
    return null;
  }
};

const rigInfo = obj<NonNullable<M.ArtRecord['rigInfo']>>({
  made: oneOf(['auto', 'guide', 'parts', 'ai', 'hand']),
  confidence: num(0, 1),
  notes: arrLoose(str(300), 16),
});

const artShape = obj<M.ArtRecord>({
  id,
  name: str(TEXT_LIMITS.artName),
  kind: artKind,
  rig: rigKind,
  facing: orElse(facing, 'viewer'),
  role: orElse(nullable(role), null),
  mode: orElse(oneOf(['bones', 'free']), 'free'),
  board: obj({ w: int(1, LIMITS.boardMaxSide), h: int(1, LIMITS.boardMaxSide), pixelArt: orElse(bool, false) }),
  doc: blobRef,
  cels: arr(blobRef, 4096),
  parts: orElse(rec(obj<M.PartLayers>({ lines: str(64, 1), colors: str(64, 1) }), (k) => k.length > 0 && k.length <= 64, 64), {}),
  export: nullable(artExport),
  rigData,
  rigInfo: orElse(nullable(rigInfo), null),
  palette: orElse(arrLoose(pattern(/^#[0-9a-fA-F]{3,8}$/), TEXT_LIMITS.palette), []),
  madeBy: orElse(oneOf(['student', 'example', 'teacher', 'import']), 'import'),
  shelf: orElse(bool, false),
  createdAt: orElse(num(0), 0),
  updatedAt: orElse(num(0), 0),
  version: orElse(int(0), 1),
});

export function cleanArtRecord(v: unknown): M.ArtRecord | null {
  const a = artShape(v);
  if (a === FAIL) return null;
  if (!a.rigData) a.rigInfo = null;
  return isArtRecord(a) ? a : null;
}

// ------------------------------------------------------------------ footsteps

const stepArt = obj<M.StepSnapshot['art'][string]>({
  version: orElse(int(0), 1),
  doc: blobRef,
  cels: arr(blobRef, 4096),
  export: nullable(artExport),
  rigData,
});

const stepShape = obj<M.StepSnapshot>({
  id,
  worldId: id,
  code,
  cast,
  art: rec(stepArt, isSafeId, 64),
  sounds: orElse(sounds, {}),
  dials: orElse(dials, {}),
  twists: orElse(twists, []),
});

export function cleanStep(v: unknown): M.StepSnapshot | null {
  const s = stepShape(v);
  return s !== FAIL && isStepSnapshot(s) ? s : null;
}

// ------------------------------------------------------------------ the manifest

export type ManifestCheck = { ok: true; manifest: M.AmbleManifest } | { ok: false; kind: 'not-amble' | 'newer' };

export const FILE_VERSION = 2;

export function checkManifest(v: unknown): ManifestCheck {
  if (typeof v !== 'object' || v === null || (v as { format?: unknown }).format !== 'amble-file') return { ok: false, kind: 'not-amble' };
  const version = (v as { version?: unknown }).version;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) return { ok: false, kind: 'not-amble' };
  if (version > FILE_VERSION) return { ok: false, kind: 'newer' };
  const m = obj<M.AmbleManifest>({
    format: lit('amble-file'),
    version: () => FILE_VERSION as 2,
    kind: oneOf(['world', 'drawing', 'assignment']),
    app: orElse(str(80), ''),
    title: orElse(str(TEXT_LIMITS.worldTitle), ''),
    savedAt: orElse(str(40), ''),
    madeBy: orElse(str(TEXT_LIMITS.madeBy), ''),
    assignmentId: orElse(nullable(goalId), null),
    thumb: () => 'thumb.png' as const,
  })(v);
  return m === FAIL ? { ok: false, kind: 'not-amble' } : { ok: true, manifest: m };
}

// ------------------------------------------------------------------ entries and blobs

export type EntryName =
  | { kind: 'manifest' }
  | { kind: 'world' }
  | { kind: 'thumb' }
  | { kind: 'art'; id: string }
  | { kind: 'step'; id: string }
  | { kind: 'blob'; hex: string; ext: BlobExt }
  | { kind: 'unknown' }
  | { kind: 'unsafe' };

export type BlobExt = 'png' | 'wav' | 'webm' | 'json';

/** What an entry name is. Absolute paths, `..`, backslashes and control characters are unsafe. */
export function entryName(name: string): EntryName {
  if (!name || name.length > 200 || /[\\\u0000-\u001f]/.test(name) || name.startsWith('/') || /^[A-Za-z]:/.test(name) || name.split('/').some((p) => p === '..' || p === '.')) return { kind: 'unsafe' };
  if (name === 'manifest.json') return { kind: 'manifest' };
  if (name === 'world.json') return { kind: 'world' };
  if (name === 'thumb.png') return { kind: 'thumb' };
  let m = /^art\/([A-Za-z0-9_-]{1,64})\.json$/.exec(name);
  if (m) return { kind: 'art', id: m[1] };
  m = /^steps\/([A-Za-z0-9_-]{1,64})\.json$/.exec(name);
  if (m) return { kind: 'step', id: m[1] };
  m = /^blobs\/([0-9a-f]{64})\.(png|wav|webm|json)$/.exec(name);
  if (m) return { kind: 'blob', hex: m[1], ext: m[2] as BlobExt };
  return { kind: 'unknown' };
}

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function startsWith(bytes: Uint8Array, sig: number[], at = 0): boolean {
  if (bytes.length < at + sig.length) return false;
  return sig.every((b, i) => bytes[at + i] === b);
}

const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));

/** Width and height from a PNG's IHDR chunk (no decoding), or null when it isn't a PNG. */
export function pngSize(bytes: Uint8Array): { w: number; h: number } | null {
  if (!startsWith(bytes, PNG_SIG) || !startsWith(bytes, ascii('IHDR'), 12) || bytes.length < 24) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { w: view.getUint32(16), h: view.getUint32(20) };
}

/** The blob's real type by its first bytes; 'svg' and 'unknown' are never accepted. */
export function sniff(bytes: Uint8Array): BlobExt | 'svg' | 'unknown' {
  if (startsWith(bytes, PNG_SIG)) return 'png';
  if (startsWith(bytes, ascii('RIFF')) && startsWith(bytes, ascii('WAVE'), 8)) return 'wav';
  if (startsWith(bytes, [0x1a, 0x45, 0xdf, 0xa3])) return 'webm';
  let i = 0;
  if (startsWith(bytes, [0xef, 0xbb, 0xbf])) i = 3;
  while (i < bytes.length && i < 64 && (bytes[i] === 0x20 || bytes[i] === 0x0a || bytes[i] === 0x0d || bytes[i] === 0x09)) i++;
  const head = String.fromCharCode(...bytes.subarray(i, i + 256)).toLowerCase();
  if (head.startsWith('<svg') || (head.startsWith('<?xml') && head.includes('<svg')) || head.includes('<svg')) return 'svg';
  if (bytes[i] === 0x7b /* { */ || bytes[i] === 0x5b /* [ */) return 'json';
  return 'unknown';
}

export const MIME_OF: Record<BlobExt, string> = { png: 'image/png', wav: 'audio/wav', webm: 'audio/webm', json: 'application/json' };

/** Checks a blob's bytes against the type its name claims. */
export function checkBlob(ext: BlobExt, bytes: Uint8Array): { ok: true } | { ok: false; reason: string } {
  const real = sniff(bytes);
  if (real === 'svg') return { ok: false, reason: 'svg' };
  if (real !== ext) return { ok: false, reason: `not ${ext}` };
  if (ext === 'png') {
    const size = pngSize(bytes);
    if (!size || size.w < 1 || size.h < 1 || size.w > LIMITS.boardMaxSide || size.h > LIMITS.boardMaxSide) return { ok: false, reason: 'png size' };
  }
  if (ext === 'json') {
    try {
      JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    } catch {
      return { ok: false, reason: 'json' };
    }
  }
  return { ok: true };
}

// ------------------------------------------------------------------ references

/** Every blob a drawing needs (`doc`, cels and its export), for the partial-damage check. */
export function artRefs(a: Pick<M.ArtRecord, 'doc' | 'cels' | 'export'>): M.BlobRef[] {
  const out: M.BlobRef[] = [a.doc, ...a.cels];
  const e = a.export;
  if (e) {
    out.push(e.flat, e.sticker, e.thumb);
    if (e.inkMask) out.push(e.inkMask);
    for (const p of Object.values(e.parts)) out.push(p.blob);
    if (e.frames) out.push(e.frames.atlas);
  }
  return out;
}

export function soundRefs(sounds: Record<string, M.SoundPiece>): M.BlobRef[] {
  return Object.values(sounds).flatMap((s) => (s.source.kind === 'recording' ? [s.source.blob] : []));
}

export function stepRefs(s: M.StepSnapshot): M.BlobRef[] {
  return [...Object.values(s.art).flatMap(artRefs), ...soundRefs(s.sounds)];
}
