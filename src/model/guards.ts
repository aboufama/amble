/**
 * Runtime guards for every §4.2 shape, built from a few combinators. Used wherever data crosses a trust
 * boundary (IndexedDB records from an older version, settings, files, messages): unknown extra fields are
 * tolerated, wrong types are rejected. `obj<T>` must be given a guard for every property of T, so a type
 * change that forgets its guard fails to compile.
 */
import { SOUND_EFFECTS } from '../audio/effects';
import { ACTIONS, ART_KINDS, ART_SHAPES, RIG_KINDS, ROLES } from '../cores/play';
import type { ArtNeed, DialSpec, GameManifest, PlayerError } from '../cores/play';
import { CHARACTER_KINDS } from '../cores/rig';
import type { RigBone, RigData } from '../cores/rig';
import type { SynthRecipe, SynthSegment } from '../audio/synth';
import type { SoundEffect } from '../audio/effects';
import { isBlobRef, isCastKey } from './ids';
import type * as M from './types';

export type Guard<T> = (v: unknown) => v is T;
export type GuardOf<G> = G extends Guard<infer T> ? T : never;

// ------------------------------------------------------------------ combinators

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export const isString: Guard<string> = (v): v is string => typeof v === 'string';
export const isBool: Guard<boolean> = (v): v is boolean => typeof v === 'boolean';
export const isNull: Guard<null> = (v): v is null => v === null;
export const isFiniteNumber: Guard<number> = (v): v is number => typeof v === 'number' && Number.isFinite(v);
export const isBlob: Guard<Blob> = (v): v is Blob => typeof Blob !== 'undefined' && v instanceof Blob;

/** A string of at most `max` characters. */
export function str(max = Infinity, min = 0): Guard<string> {
  return (v): v is string => typeof v === 'string' && v.length <= max && v.length >= min;
}

/** A finite number in [min, max]. */
export function num(min = -Infinity, max = Infinity): Guard<number> {
  return (v): v is number => isFiniteNumber(v) && v >= min && v <= max;
}

export function int(min = -Infinity, max = Infinity): Guard<number> {
  return (v): v is number => Number.isInteger(v) && (v as number) >= min && (v as number) <= max;
}

export function lit<const T extends readonly (string | number | boolean | null)[]>(...values: T): Guard<T[number]> {
  return (v): v is T[number] => values.includes(v as T[number]);
}

export function oneOf<T extends string>(list: readonly T[]): Guard<T> {
  return (v): v is T => typeof v === 'string' && (list as readonly string[]).includes(v);
}

export function arr<T>(g: Guard<T>, max = Infinity, min = 0): Guard<T[]> {
  return (v): v is T[] => Array.isArray(v) && v.length <= max && v.length >= min && v.every((x) => g(x));
}

export function rec<T>(g: Guard<T>, key: Guard<string> = isString, max = Infinity): Guard<Record<string, T>> {
  return (v): v is Record<string, T> => {
    if (!isRecord(v)) return false;
    const entries = Object.entries(v);
    return entries.length <= max && entries.every(([k, x]) => key(k) && g(x));
  };
}

export function nullable<T>(g: Guard<T>): Guard<T | null> {
  return (v): v is T | null => v === null || g(v);
}

/** For optional properties: absent (undefined) or valid. */
export function opt<T>(g: Guard<T>): Guard<T | undefined> {
  return (v): v is T | undefined => v === undefined || g(v);
}

export function tuple<A, B>(a: Guard<A>, b: Guard<B>): Guard<[A, B]> {
  return (v): v is [A, B] => Array.isArray(v) && v.length === 2 && a(v[0]) && b(v[1]);
}

export function union<G extends Guard<unknown>[]>(...gs: G): Guard<GuardOf<G[number]>> {
  return (v): v is GuardOf<G[number]> => gs.some((g) => g(v));
}

/** An object with (at least) these properties, each passing its guard. */
export function obj<T>(props: { [K in keyof T]-?: Guard<T[K]> }): Guard<T> {
  const keys = Object.keys(props) as Array<keyof T>;
  return (v): v is T => isRecord(v) && keys.every((k) => props[k]((v as Record<keyof T, unknown>)[k]));
}

// ------------------------------------------------------------------ ids and small types

export const isId: Guard<M.Id> = str(64, 1);
export const isCastKeyGuard: Guard<M.CastKey> = (v): v is M.CastKey => isCastKey(v);
export const isBlobRefGuard: Guard<M.BlobRef> = (v): v is M.BlobRef => isBlobRef(v);
export const isLevel = oneOf<M.Level>(['elementary', 'middle', 'high']);
export const isAiMode = oneOf<M.AiMode>(['on', 'explain', 'off']);
export const isAuthor = oneOf<M.Author>(['starter', 'ai', 'student', 'teacher']);
export const isAuthorRun: Guard<M.AuthorRun> = tuple(isAuthor, int(0));
export const isLineRange: Guard<M.LineRange> = (v): v is M.LineRange => tuple(int(1), int(1))(v) && v[0] <= v[1];
export const STARTER_IDS: readonly M.StarterId[] = ['moon-king', 'sky-run', 'wobble-tower', 'lantern-maze', 'clanks-climb'];
export const isStarterId = oneOf<M.StarterId>(STARTER_IDS);
export const isSeedId = oneOf<M.SeedId>([...STARTER_IDS, 'parade']);
export const isTwistId: Guard<M.TwistId> = str(40, 1);

// ------------------------------------------------------------------ core vocabulary

export const isRole = oneOf<M.Role>(ROLES);
export const isArtKind = oneOf<M.ArtKind>(ART_KINDS);
export const isRigKind = oneOf<M.RigKind>(RIG_KINDS);
export const isArtShape = oneOf<M.ArtShape>(ART_SHAPES);
export const isFacing = oneOf<M.Facing>(['viewer', 'right', 'left']);
export const isPronoun = oneOf<M.Pronoun>(['him', 'her', 'them', 'it']);
export const isAction = oneOf<M.Action>(ACTIONS);
export const isCharacterKind = oneOf<M.CharacterKind>(CHARACTER_KINDS);
export const isSoundEffect = oneOf<SoundEffect>(SOUND_EFFECTS.map((e) => e.id));

export const isSynthSegment = obj<SynthSegment>({
  wave: oneOf(['sine', 'square', 'triangle', 'sawtooth', 'noise']),
  startFreq: num(0, 40000),
  endFreq: num(0, 40000),
  duration: num(0, 60),
  startVolume: num(0, 1),
  endVolume: num(0, 1),
});
export const isSynthRecipe = obj<SynthRecipe>({ segments: arr(isSynthSegment, 64) });

export const isDialSpec = obj<DialSpec>({
  label: str(80),
  value: isFiniteNumber,
  min: isFiniteNumber,
  max: isFiniteNumber,
  step: num(0),
  live: isBool,
  words: str(200),
});

export const isArtNeed = obj<ArtNeed>({
  key: isCastKeyGuard,
  name: str(80),
  kind: isArtKind,
  rig: isRigKind,
  role: isRole,
  shape: isArtShape,
  w: num(0),
  h: num(0),
  color: str(9),
  ask: str(200),
  about: str(200),
  pronoun: isPronoun,
  facing: isFacing,
  priority: isFiniteNumber,
  required: isBool,
  declared: isBool,
  used: isBool,
  drawn: isBool,
});

export const isGameManifest = obj<GameManifest>({
  title: isString,
  subtitle: isString,
  physics: oneOf(['arcade', 'matter', 'none', 'phaser']),
  kit: isBool,
  art: arr(isArtNeed),
  dials: arr(
    obj<GameManifest['dials'][number]>({
      label: str(80),
      value: isFiniteNumber,
      min: isFiniteNumber,
      max: isFiniteNumber,
      step: num(0),
      live: isBool,
      words: str(200),
      key: str(64, 1),
      current: isFiniteNumber,
      source: oneOf(['static', 'tune']),
    }),
  ),
  twists: arr(obj<GameManifest['twists'][number]>({ id: str(64, 1), name: isString, does: isString, available: isBool, on: isBool })),
  controls: arr(isAction),
});

export const isPlayerError = obj<PlayerError>({
  phase: oneOf(['load', 'boot', 'create', 'update', 'callback', 'frame', 'uncaught', 'promise', 'frozen']),
  message: isString,
  file: opt(isString),
  line: opt(int(1)),
  column: opt(int(0)),
  count: int(1),
  stack: opt(isString),
});

const isPoint: Guard<[number, number]> = tuple(isFiniteNumber, isFiniteNumber);

export const isRigBone = obj<RigBone>({
  name: str(40, 1),
  role: str(20, 1) as Guard<RigBone['role']>,
  parent: int(-1),
  x: isFiniteNumber,
  y: isFiniteNumber,
  x2: isFiniteNumber,
  y2: isFiniteNumber,
  dynamic: opt(obj<NonNullable<RigBone['dynamic']>>({ stiffness: num(0, 1), damping: num(0, 1), gravity: isFiniteNumber })),
  rigid: opt(isBool),
});

export const isRigData = obj<RigData>({
  format: lit('amble-rig'),
  v: lit(1),
  kind: isCharacterKind,
  facing: lit(1, -1, 0),
  anchor: isPoint,
  bones: arr(isRigBone, 128),
  parts: opt(arr(obj<NonNullable<RigData['parts']>[number]>({ name: str(40, 1), bones: arr(isString), order: isFiniteNumber, layer: opt(isString) }))),
  skin: opt(obj<NonNullable<RigData['skin']>>({ cell: opt(num(1)), blend: opt(num(0)) })),
  artHash: str(128),
  made: oneOf(['auto', 'ai', 'hand']),
  anims: opt(rec(obj<NonNullable<RigData['anims']>[string]>({ speed: opt(num(0)), amount: opt(num(0)), off: opt(isBool) }))),
});

// ------------------------------------------------------------------ the world

export const isWorldOrigin: Guard<M.WorldOrigin> = union(
  obj<Extract<M.WorldOrigin, { kind: 'starter' }>>({ kind: lit('starter'), starter: isStarterId, withArt: isBool }),
  obj<Extract<M.WorldOrigin, { kind: 'plan' }>>({ kind: lit('plan'), starter: isStarterId, planTitle: str(80) }),
  obj<Extract<M.WorldOrigin, { kind: 'assignment' }>>({ kind: lit('assignment'), assignmentId: isId, starter: nullable(isStarterId) }),
  obj<Extract<M.WorldOrigin, { kind: 'file' }>>({ kind: lit('file'), fileName: str(255) }),
  obj<Extract<M.WorldOrigin, { kind: 'parade' }>>({ kind: lit('parade') }),
  obj<Extract<M.WorldOrigin, { kind: 'import-v1' }>>({ kind: lit('import-v1'), title: str(200) }),
);

export const isCodeFile = obj<M.CodeFile>({
  path: (v): v is string => typeof v === 'string' && /^[a-z][a-z0-9-]{0,23}\.js$/.test(v),
  source: isString,
  authors: arr(isAuthorRun),
  locked: arr(isLineRange),
});

export const isCastExtra = obj<M.CastExtra>({ name: str(80), role: isRole, kind: isArtKind, rig: isRigKind, note: str(300) });

export const isCastSlot = obj<M.CastSlot>({
  key: isCastKeyGuard,
  art: nullable(isId),
  madeBy: nullable(oneOf(['student', 'example', 'teacher', 'import'])),
  extra: nullable(isCastExtra),
  laterUntil: num(0),
});

export const isCastMember = obj<M.CastMember>({
  key: isCastKeyGuard,
  name: str(80),
  kind: isArtKind,
  role: isRole,
  rig: isRigKind,
  shape: isArtShape,
  ask: str(200),
  about: str(200),
  pronoun: isPronoun,
  facing: isFacing,
  w: num(0),
  h: num(0),
  priority: isFiniteNumber,
  required: isBool,
  spare: isBool,
  art: nullable(isId),
  status: oneOf(['drawn', 'needed', 'optional', 'spare', 'resting']),
  onScreen: isBool,
  count: int(0),
});

const isSoundSource: Guard<M.SoundPiece['source']> = union(
  obj<Extract<M.SoundPiece['source'], { kind: 'preset' }>>({ kind: lit('preset'), preset: str(40, 1), variation: lit(0, 1, 2) }),
  obj<Extract<M.SoundPiece['source'], { kind: 'synth' }>>({ kind: lit('synth'), recipe: isSynthRecipe }),
  obj<Extract<M.SoundPiece['source'], { kind: 'recording' }>>({ kind: lit('recording'), blob: isBlobRefGuard, mime: lit('audio/wav', 'audio/webm'), duration: num(0, 60) }),
);

export const isSoundPiece = obj<M.SoundPiece>({
  name: str(40, 1),
  source: isSoundSource,
  effects: arr(isSoundEffect, 16),
  caption: str(80),
  madeBy: oneOf(['student', 'example']),
});

export const STEP_KINDS: readonly M.StepKind[] = ['start', 'draw', 'redraw', 'bones', 'dials', 'twists', 'code', 'ask', 'fix', 'goback', 'sound', 'cast', 'import', 'handin', 'refused'];
export const isStepKind = oneOf<M.StepKind>(STEP_KINDS);
const isStepBy = oneOf<M.StepSummary['by']>(['student', 'ai', 'auto', 'teacher']);

export const isStepSummary = obj<M.StepSummary>({
  id: isId,
  at: num(0),
  by: isStepBy,
  kind: isStepKind,
  text: str(300),
  request: opt(str(2000)),
  files: opt(arr(isString, 16)),
  cast: opt(isCastKeyGuard),
  lines: opt(int(0)),
  tested: opt(isBool),
  handEdits: opt(isBool),
});

export const isStepInput = obj<M.StepInput>({
  kind: isStepKind,
  by: isStepBy,
  text: str(300),
  request: opt(str(2000)),
  cast: opt(isCastKeyGuard),
  files: opt(arr(isString, 16)),
  tested: opt(isBool),
  handEdits: opt(isBool),
});

// ------------------------------------------------------------------ school

export const isAutoCheck: Guard<M.AutoCheck> = union(
  obj<Extract<M.AutoCheck, { type: 'drawn' }>>({ type: lit('drawn'), key: isCastKeyGuard }),
  obj<Extract<M.AutoCheck, { type: 'min-drawings' }>>({ type: lit('min-drawings'), n: int(0, 64) }),
  obj<Extract<M.AutoCheck, { type: 'runs-clean' }>>({ type: lit('runs-clean') }),
  obj<Extract<M.AutoCheck, { type: 'boss-attacks' }>>({ type: lit('boss-attacks'), min: int(0, 64) }),
  obj<Extract<M.AutoCheck, { type: 'uses-dials' }>>({ type: lit('uses-dials'), min: int(0, 64) }),
  obj<Extract<M.AutoCheck, { type: 'has-win-and-lose' }>>({ type: lit('has-win-and-lose') }),
  obj<Extract<M.AutoCheck, { type: 'brain-states' }>>({ type: lit('brain-states'), min: int(0, 64) }),
  obj<Extract<M.AutoCheck, { type: 'captions' }>>({ type: lit('captions') }),
);

export const isGoal: Guard<M.Goal> = union(
  obj<Extract<M.Goal, { kind: 'teacher' }>>({ id: isId, label: str(120), kind: lit('teacher') }),
  obj<Extract<M.Goal, { kind: 'auto' }>>({ id: isId, label: str(120), kind: lit('auto'), check: isAutoCheck }),
);

export const isAssignment = obj<M.Assignment>({
  id: isId,
  title: str(60),
  text: str(400),
  starter: nullable(isStarterId),
  require: arr(isCastKeyGuard, 16),
  goals: arr(isGoal, 24),
  ai: isAiMode,
  level: nullable(isLevel),
  due: str(40),
  locked: rec(arr(isLineRange)),
});

export const isHandInState = obj<M.HandInState>({
  fileName: nullable(str(255)),
  savedAt: nullable(num(0)),
  method: nullable(oneOf(['fs-access', 'download'])),
  turnedInAt: nullable(num(0)),
});

// ------------------------------------------------------------------ AI replies

export const isPlanCastItem = obj<M.PlanCastItem>({
  key: isCastKeyGuard,
  name: str(60),
  ask: str(60),
  about: str(80),
  role: isRole,
  kind: isArtKind,
  rig: isRigKind,
  facing: isFacing,
  pronoun: isPronoun,
  size: oneOf(['tiny', 'small', 'hero', 'big', 'huge', 'screen']),
  required: isBool,
  mapsTo: str(24),
});

export const isPlanReply = obj<M.PlanReply>({
  status: oneOf(['ok', 'toned_down', 'refused', 'crisis']),
  safetyNote: str(300),
  title: str(28),
  pitch: str(140),
  starter: isStarterId,
  twist: obj<M.PlanReply['twist']>({ name: str(40), does: str(140) }),
  controls: arr(obj<M.PlanReply['controls'][number]>({ keys: str(40), does: str(80) }), 5),
  cast: arr(isPlanCastItem, 8),
  builds: arr(str(160), 4),
  dials: arr(obj<M.PlanReply['dials'][number]>({ key: str(24, 1), label: str(24) }), 6),
});

export const isWorld = obj<M.World>({
  format: lit('amble-world'),
  version: lit(1),
  id: isId,
  title: str(40),
  pitch: str(300),
  level: isLevel,
  createdAt: num(0),
  updatedAt: num(0),
  openedAt: num(0),
  origin: isWorldOrigin,
  code: arr(isCodeFile, 8),
  cast: rec(isCastSlot, isCastKeyGuard),
  sounds: rec(isSoundPiece),
  dials: rec(isFiniteNumber),
  twists: arr(isTwistId, 32),
  controls: rec(arr(str(32), 8), isAction as Guard<string>),
  gameStorage: rec(isString),
  steps: arr(isStepSummary),
  head: isString,
  assignment: nullable(isAssignment),
  handIn: isHandInState,
  credits: obj<M.World['credits']>({ madeBy: str(20) }),
  plan: nullable(isPlanReply),
});

export const isWorldMeta = obj<M.WorldMeta>({
  id: isId,
  title: str(40),
  createdAt: num(0),
  updatedAt: num(0),
  openedAt: num(0),
  snapshot: nullable(isBlobRefGuard),
  hero: nullable(isId),
  walkers: arr(isId, 2),
  drawn: int(0),
  needed: int(0),
  bytes: num(0),
  origin: oneOf(['starter', 'plan', 'assignment', 'file', 'parade', 'import-v1']),
  assignment: nullable(obj<NonNullable<M.WorldMeta['assignment']>>({ title: str(60), due: str(40) })),
  handedIn: nullable(num(0)),
  putAwayAt: nullable(num(0)),
});

// ------------------------------------------------------------------ drawings

export const isPartLayers = obj<M.PartLayers>({ lines: str(64, 1), colors: str(64, 1) });

const isPartBlob = obj<M.ArtExport['parts'][string]>({ blob: isBlobRefGuard, x: isFiniteNumber, y: isFiniteNumber, w: num(0), h: num(0) });

export const isArtExport = obj<M.ArtExport>({
  hash: str(128, 1),
  flat: isBlobRefGuard,
  w: num(1, 4096),
  h: num(1, 4096),
  anchor: isPoint,
  inkMask: nullable(isBlobRefGuard),
  parts: rec(isPartBlob),
  sticker: isBlobRefGuard,
  thumb: isBlobRefGuard,
  frames: nullable(obj<NonNullable<M.ArtExport['frames']>>({ atlas: isBlobRefGuard, json: isString, move: str(20, 1), fps: num(1, 60) })),
});

export const isArtRecord = obj<M.ArtRecord>({
  id: isId,
  name: str(40),
  kind: isArtKind,
  rig: isRigKind,
  facing: isFacing,
  role: nullable(isRole),
  mode: oneOf(['bones', 'free']),
  board: obj<M.ArtRecord['board']>({ w: int(1, 2048), h: int(1, 2048), pixelArt: isBool }),
  doc: isBlobRefGuard,
  cels: arr(isBlobRefGuard),
  parts: rec(isPartLayers),
  export: nullable(isArtExport),
  rigData: nullable(isRigData),
  rigInfo: nullable(
    obj<NonNullable<M.ArtRecord['rigInfo']>>({ made: oneOf(['auto', 'guide', 'parts', 'ai', 'hand']), confidence: num(0, 1), notes: arr(str(300), 16) }),
  ),
  palette: arr(str(9), 24),
  madeBy: oneOf(['student', 'example', 'teacher', 'import']),
  shelf: isBool,
  createdAt: num(0),
  updatedAt: num(0),
  version: int(0),
});

export const isArtRecordLite = obj<M.ArtRecordLite>({
  id: isId,
  name: str(40),
  kind: isArtKind,
  rig: isRigKind,
  shelf: isBool,
  updatedAt: num(0),
  sticker: nullable(isBlobRefGuard),
});

export const isDeskDraft = obj<M.DeskDraft>({
  artId: isId,
  worldId: nullable(isId),
  castKey: nullable(isCastKeyGuard),
  doc: isString,
  cels: rec(isBlob),
  tool: str(40),
  at: num(0),
});

const isStepArt = obj<M.StepSnapshot['art'][string]>({
  version: int(0),
  doc: isBlobRefGuard,
  cels: arr(isBlobRefGuard),
  export: nullable(isArtExport),
  rigData: nullable(isRigData),
});

export const isStepSnapshot = obj<M.StepSnapshot>({
  id: isId,
  worldId: isId,
  code: arr(isCodeFile, 8),
  cast: rec(isCastSlot, isCastKeyGuard),
  art: rec(isStepArt),
  sounds: rec(isSoundPiece),
  dials: rec(isFiniteNumber),
  twists: arr(isTwistId, 32),
});

export const isStepDiff = obj<M.StepDiff>({
  files: arr(obj<M.StepDiff['files'][number]>({ path: isString, hunks: isString })),
  drawings: arr(obj<M.StepDiff['drawings'][number]>({ key: isCastKeyGuard, before: nullable(isBlobRefGuard), after: nullable(isBlobRefGuard) })),
  dials: arr(obj<M.StepDiff['dials'][number]>({ key: isString, before: isFiniteNumber, after: isFiniteNumber })),
});

export const isCheckResult = obj<M.CheckResult>({ goal: isId, pass: isBool, evidence: str(200) });

const isClassAi = obj<NonNullable<M.ClassLinkV1['ai']>>({
  baseUrl: str(300, 8),
  model: str(80),
  fastModel: opt(str(80)),
  visionModel: opt(str(80)),
  caps: opt(str(120)),
  auth: union(
    obj<Extract<NonNullable<M.ClassLinkV1['ai']>['auth'], { type: 'class-code' }>>({ type: lit('class-code'), header: str(60, 1), code: str(80, 1) }),
    obj<Extract<NonNullable<M.ClassLinkV1['ai']>['auth'], { type: 'none' }>>({ type: lit('none') }),
  ),
});

export const isClassLinkV1 = obj<M.ClassLinkV1>({
  v: lit(1),
  cls: str(40),
  district: nullable(str(60)),
  ai: nullable(isClassAi),
  mode: isAiMode,
  level: isLevel,
  exp: nullable(str(40)),
  asg: nullable(isAssignment),
});

export const isClassLinkIntake: Guard<M.ClassLinkIntake> = union(
  obj<Extract<M.ClassLinkIntake, { ok: true }>>({ ok: lit(true), link: isClassLinkV1, switchingFrom: nullable(str(40)) }),
  obj<Extract<M.ClassLinkIntake, { ok: false }>>({ ok: lit(false), reason: oneOf(['expired', 'unsafe', 'damaged']) }),
);

export const isGalleryNote = obj<M.GalleryNote>({
  fileHash: str(128),
  title: str(80),
  madeBy: str(20),
  checks: rec(isBool),
  feedback: str(4000),
  reviewedAt: nullable(num(0)),
});

export const isTeacherData = obj<M.TeacherData>({ assignments: arr(isAssignment, 200), link: nullable(isClassLinkV1), notes: rec(isGalleryNote) });

// ------------------------------------------------------------------ preferences and settings

const SEEN_KEYS = ['firstPage', 'ghostTip', 'changeTip', 'aiExplainer', 'bonesTip', 'handinInitials'] as const;

/** The guard of each `Prefs` field (also used to merge stored prefs over the defaults). */
export const PREFS_FIELDS: { [K in keyof M.Prefs]-?: Guard<M.Prefs[K]> } = {
  theme: oneOf(['night', 'day', 'contrast']),
  reduceMotion: oneOf(['system', 'on', 'off']),
  textScale: lit(1, 1.15, 1.3),
  extraSpacing: isBool,
  easyRead: isBool,
  uiSounds: oneOf(['off', 'soft', 'on']),
  gameVolume: num(0, 1),
  gameMuted: isBool,
  captions: isBool,
  gameSpeed: lit(1, 0.75, 0.5),
  touchControls: oneOf(['auto', 'on', 'off']),
  readAloud: isBool,
  singleKeys: isBool,
  leftHanded: isBool,
  pressure: oneOf(['light', 'normal', 'firm']),
  brushSounds: isBool,
  trailView: oneOf(['trail', 'list']),
  trailPaused: isBool,
  seen: rec(num(0), oneOf(SEEN_KEYS)) as Guard<M.Prefs['seen']>,
};

export const isPrefs = obj<M.Prefs>(PREFS_FIELDS);

export const isManualAiSettings = obj<M.ManualAiSettings>({
  baseUrl: str(300),
  model: str(80),
  fastModel: str(80),
  key: nullable(str(400)),
  remember: isBool,
});

/** One guard per `settings` key (§4.3). */
export const SETTINGS_GUARDS: { [K in M.SettingsKey]: Guard<M.SettingsMap[K]> } = {
  prefs: isPrefs,
  classLink: isClassLinkV1,
  manualAi: isManualAiSettings,
  teacher: isTeacherData,
  legacy: obj<M.SettingsMap['legacy']>({ hash: str(128), at: num(0), choice: oneOf(['brought', 'dismissed']) }),
  noVision: arr(str(300), 50),
  consent: rec(num(0)),
  lastRoute: str(300),
};

export const isAiLogEntry = obj<M.AiLogEntry>({
  id: isId,
  at: num(0),
  kind: oneOf(['plan', 'build', 'change', 'fix', 'resend', 'continue', 'explain', 'rig', 'moderation', 'test']),
  host: str(300),
  model: str(80),
  bytesSent: num(0),
  bytesReceived: num(0),
  included: arr(str(200), 32),
  body: isString,
  status: oneOf(['ok', 'refused', 'failed', 'cancelled']),
  replySummary: str(500),
});

export const isAiProgress = obj<M.AiProgress>({
  phase: oneOf(['queued', 'checking', 'planning', 'writing', 'validating', 'testing', 'fixing', 'swapping']),
  file: opt(isString),
  lines: opt(int(0)),
  chars: opt(int(0)),
  round: opt(lit(1, 2)),
  waitMs: opt(num(0)),
});

export const isSafetyVerdict: Guard<M.SafetyVerdict> = union(
  obj<Extract<M.SafetyVerdict, { kind: 'allow' }>>({ kind: lit('allow') }),
  obj<Extract<M.SafetyVerdict, { kind: 'pii' }>>({ kind: lit('pii'), spans: arr(tuple(int(0), int(0))), block: isBool }),
  obj<Extract<M.SafetyVerdict, { kind: 'refuse' }>>({ kind: lit('refuse'), category: str(60), message: str(300), alternatives: arr(str(120), 4) }),
  obj<Extract<M.SafetyVerdict, { kind: 'crisis' }>>({ kind: lit('crisis') }),
);

export const isExplainReply = obj<M.ExplainReply>({
  answer: str(2000),
  lines: arr(obj<M.ExplainReply['lines'][number]>({ from: int(1), to: int(1), note: str(300) }), 32),
  safetyNote: str(300),
});

export const isLocalSteer: Guard<M.LocalSteer> = union(
  obj<Extract<M.LocalSteer, { kind: 'dial' }>>({ kind: lit('dial'), key: str(64, 1), label: str(80), from: isFiniteNumber, to: isFiniteNumber }),
  obj<Extract<M.LocalSteer, { kind: 'twist' }>>({ kind: lit('twist'), id: isTwistId, name: str(80), on: isBool }),
);

// ------------------------------------------------------------------ files and starters

export const isAmbleManifest = obj<M.AmbleManifest>({
  format: lit('amble-file'),
  version: lit(2),
  kind: oneOf(['world', 'drawing', 'assignment']),
  app: str(80),
  title: str(80),
  savedAt: str(40),
  madeBy: str(20),
  assignmentId: nullable(isId),
  thumb: lit('thumb.png'),
});

export const isStarterInfo = obj<M.StarterInfo>({
  id: isSeedId,
  title: str(40),
  genre: str(40),
  blurb: str(160),
  teaches: str(200),
  sign: str(300),
  heroKey: isCastKeyGuard,
  yourTurn: nullable(isCastKeyGuard),
  spare: arr(isCastKeyGuard, 8),
  tags: arr(str(40), 40),
  hidden: isBool,
});

export const isSaveState = oneOf<M.SaveState>(['saved', 'saving', 'full', 'files-only', 'error']);
export const isFileProblemKind = oneOf<M.FileProblemKind>(['not-amble', 'damaged', 'too-big', 'newer', 'blocked']);

/** Keeps the fields of `v` that pass their guard over `base` (settings written by an older or newer Amble). */
export function mergeValid<T extends object>(base: T, v: unknown, props: { [K in keyof T]-?: Guard<T[K]> }): T {
  if (!isRecord(v)) return { ...base };
  const out = { ...base };
  for (const k of Object.keys(props) as Array<keyof T>) {
    const x = (v as Record<keyof T, unknown>)[k];
    if (x !== undefined && props[k](x)) out[k] = x;
  }
  return out;
}
