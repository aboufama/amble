/**
 * Reading and checking stored rigs. `parseRig` accepts anything (JSON from a file, a message, an old
 * project) and returns a well-formed `RigData` v1 or a readable error. Unknown fields are preserved
 * (a newer Amble may add some); unknown roles become 'extra' (clips ignore them).
 */
import { BONE_ROLES, CHARACTER_KINDS } from './types';
import type { AnimTweak, BoneRole, CharacterKind, DynamicSpec, Facing, RigBone, RigData, RigPart } from './types';

export class RigFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RigFormatError';
  }
}

/** Names other parts of Amble use for the same kinds (the games kit says 'snake' and 'none'). */
const KIND_ALIASES: Record<string, CharacterKind> = {
  person: 'biped', human: 'biped', robot: 'biped',
  animal: 'quadruped', 'four-legs': 'quadruped', dog: 'quadruped', cat: 'quadruped', horse: 'quadruped',
  bird: 'flyer', bat: 'flyer', dragon: 'flyer', fly: 'flyer',
  snake: 'swimmer', fish: 'swimmer', worm: 'swimmer', swim: 'swimmer',
  slime: 'blob', ghost: 'blob', jelly: 'blob',
  none: 'object', thing: 'object', item: 'object', prop: 'object', vehicle: 'object', rigid: 'object',
};

/** 'snake' → 'swimmer', 'none' → 'object', ...; null if the word means nothing to the rigger. */
export function normalizeKind(kind: string): CharacterKind | null {
  const k = kind.trim().toLowerCase();
  if ((CHARACTER_KINDS as readonly string[]).includes(k)) return k as CharacterKind;
  return KIND_ALIASES[k] ?? null;
}

const ROLE_SET = new Set<string>(BONE_ROLES);
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

function readDynamic(v: unknown, where: string): DynamicSpec | undefined {
  if (v === undefined || v === null || v === false) return undefined;
  if (v === true) return { ...DEFAULT_SPRING };
  if (!isObj(v)) throw new RigFormatError(`${where}.dynamic must be an object`);
  return {
    ...v,
    stiffness: clamp(num(v.stiffness) ? v.stiffness : DEFAULT_SPRING.stiffness, 0.01, 1),
    damping: clamp(num(v.damping) ? v.damping : DEFAULT_SPRING.damping, 0, 0.99),
    gravity: clamp(num(v.gravity) ? v.gravity : DEFAULT_SPRING.gravity, -5000, 5000),
  };
}

/** The spring every auto-found wiggly bit starts with (tuned on the dog's tail). */
export const DEFAULT_SPRING: DynamicSpec = { stiffness: 0.18, damping: 0.86, gravity: 300 };

function readBone(v: unknown, i: number, names: Set<string>): RigBone {
  const where = `bones[${i}]`;
  if (!isObj(v)) throw new RigFormatError(`${where} must be an object`);
  const name = typeof v.name === 'string' && v.name ? v.name : `bone${i}`;
  if (names.has(name)) throw new RigFormatError(`${where}: the name "${name}" is used twice`);
  names.add(name);
  for (const k of ['x', 'y', 'x2', 'y2'] as const) if (!num(v[k])) throw new RigFormatError(`${where}.${k} must be a number`);
  const parent = v.parent === undefined || v.parent === null ? -1 : v.parent;
  if (!Number.isInteger(parent) || (parent as number) < -1 || (parent as number) >= i) {
    throw new RigFormatError(`${where}.parent must be -1 or the index of an earlier bone`);
  }
  const role: BoneRole = typeof v.role === 'string' && ROLE_SET.has(v.role) ? (v.role as BoneRole) : 'extra';
  const bone: RigBone = { ...v, name, role, parent: parent as number, x: v.x as number, y: v.y as number, x2: v.x2 as number, y2: v.y2 as number };
  const dyn = readDynamic(v.dynamic, where);
  if (dyn) bone.dynamic = dyn;
  else delete bone.dynamic;
  if (v.rigid === true) bone.rigid = true;
  else delete bone.rigid;
  return bone;
}

function readPart(v: unknown, i: number, names: Set<string>): RigPart {
  const where = `parts[${i}]`;
  if (!isObj(v)) throw new RigFormatError(`${where} must be an object`);
  if (typeof v.name !== 'string' || !v.name) throw new RigFormatError(`${where}.name must be a string`);
  if (!Array.isArray(v.bones)) throw new RigFormatError(`${where}.bones must be a list of bone names`);
  const bones = v.bones.filter((b): b is string => typeof b === 'string' && names.has(b));
  const part: RigPart = { ...v, name: v.name, bones, order: num(v.order) ? v.order : i };
  if (typeof v.layer === 'string' && v.layer) part.layer = v.layer;
  else delete part.layer;
  return part;
}

function readAnims(v: unknown): Record<string, AnimTweak> | undefined {
  if (!isObj(v)) return undefined;
  const out: Record<string, AnimTweak> = {};
  for (const [clip, t] of Object.entries(v)) {
    if (!isObj(t)) continue;
    const tw: AnimTweak = {};
    if (num(t.speed)) tw.speed = clamp(t.speed, 0.1, 4);
    if (num(t.amount)) tw.amount = clamp(t.amount, 0, 3);
    if (t.off === true) tw.off = true;
    out[clip] = tw;
  }
  return out;
}

/** Checks and normalizes a stored rig. Throws `RigFormatError` with a readable message. */
export function normalizeRig(value: unknown): RigData {
  if (!isObj(value)) throw new RigFormatError('A rig must be an object');
  if (value.format !== 'amble-rig') throw new RigFormatError('Not an Amble rig (format is not "amble-rig")');
  if (num(value.v) && value.v > 1) throw new RigFormatError(`This rig was made by a newer Amble (version ${value.v})`);
  if (value.v !== 1) throw new RigFormatError('Unknown rig version');
  const kind = typeof value.kind === 'string' ? normalizeKind(value.kind) : null;
  if (!kind) throw new RigFormatError(`Unknown kind "${String(value.kind)}"`);
  const facing: Facing = value.facing === 1 || value.facing === -1 ? value.facing : 0;
  if (!Array.isArray(value.anchor) || value.anchor.length !== 2 || !num(value.anchor[0]) || !num(value.anchor[1])) {
    throw new RigFormatError('anchor must be [x, y]');
  }
  if (!Array.isArray(value.bones) || value.bones.length === 0) throw new RigFormatError('A rig needs at least one bone');
  if (value.bones.length > 64) throw new RigFormatError('Too many bones (64 at most)');
  const names = new Set<string>();
  const bones = value.bones.map((b, i) => readBone(b, i, names));
  const rig: RigData = {
    ...value,
    format: 'amble-rig',
    v: 1,
    kind,
    facing,
    anchor: [value.anchor[0], value.anchor[1]],
    bones,
    artHash: typeof value.artHash === 'string' ? value.artHash : '',
    made: value.made === 'ai' || value.made === 'hand' ? value.made : 'auto',
  };
  if (Array.isArray(value.parts)) rig.parts = value.parts.map((p, i) => readPart(p, i, names));
  else delete rig.parts;
  if (isObj(value.skin)) {
    const skin: { cell?: number; blend?: number } = {};
    if (num(value.skin.cell)) skin.cell = clamp(value.skin.cell, 4, 48);
    if (num(value.skin.blend)) skin.blend = clamp(value.skin.blend, 0, 4);
    rig.skin = skin;
  } else delete rig.skin;
  const anims = readAnims(value.anims);
  if (anims) rig.anims = anims;
  else delete rig.anims;
  return rig;
}

export type ParseResult = { ok: true; rig: RigData } | { ok: false; error: string };

/** Like `normalizeRig`, but never throws; accepts a JSON string too. */
export function parseRig(value: unknown): ParseResult {
  try {
    const v = typeof value === 'string' ? (JSON.parse(value) as unknown) : value;
    return { ok: true, rig: normalizeRig(v) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** A deep copy (rigs are plain JSON). */
export function cloneRig(rig: RigData): RigData {
  return JSON.parse(JSON.stringify(rig)) as RigData;
}

/** Compact JSON for storage: coordinates rounded to 1/100 px. */
export function serializeRig(rig: RigData): string {
  return JSON.stringify(rig, (key, v) => (typeof v === 'number' && key !== 'v' ? Math.round(v * 100) / 100 : v));
}
