/**
 * What the Desk is drawing (§2.10): the art request of one cast member (the game's `static art` entry, or
 * the world's resting member), with the hero for scale. Read from the running game's cast when the world
 * screen has it, else statically from the world's code, so the Desk works before any game runs.
 */
import { extractManifest, sourceFilesOf } from '../cores/ai';
import type { ArtKind, ArtShape, CastKey, CastMember, Facing, Pronoun, RigKind, Role, World, WorldId } from '../model/types';

/** The hero unit of every size (§5.4): 40 x 64 game px. */
export const HERO_W = 40;
export const HERO_H = 64;

export interface DeskRequest {
  worldId: WorldId | null;
  key: CastKey | null;
  name: string;
  ask: string;
  about: string;
  kind: ArtKind;
  rig: RigKind;
  role: Role | null;
  shape: ArtShape;
  facing: Facing;
  pronoun: Pronoun;
  /** In-game size, game px. */
  w: number;
  h: number;
  /** The hero, for scale ("Pip, for size"); null for the hero itself and free drawings. */
  hero: { key: CastKey; name: string; w: number; h: number; rig: RigKind } | null;
}

const ROLES: readonly Role[] = ['hero', 'enemy', 'boss', 'npc', 'item', 'hazard', 'prop', 'terrain', 'projectile', 'enemyShot', 'decor', 'background'];
const KINDS: readonly ArtKind[] = ['character', 'item', 'projectile', 'prop', 'terrain', 'background', 'decor'];
const RIGS: readonly RigKind[] = ['biped', 'quadruped', 'flyer', 'swimmer', 'blob', 'object', 'none'];
const SHAPES: readonly ArtShape[] = ['box', 'ellipse', 'capsule', 'diamond', 'star', 'heart', 'coin', 'tile'];
const FACINGS: readonly Facing[] = ['viewer', 'right', 'left'];
const PRONOUNS: readonly Pronoun[] = ['him', 'her', 'them', 'it'];

const pick = <T extends string>(v: unknown, list: readonly T[], fallback: T): T => (typeof v === 'string' && (list as readonly string[]).includes(v) ? (v as T) : fallback);
const num = (v: unknown, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : fallback);
const str = (v: unknown, fallback: string): string => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 120) : fallback);

/** A friendly name from a cast key: 'moonKing' → 'Moon King'. */
export function nameFromKey(key: string): string {
  const words = key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').trim();
  return words ? words[0].toUpperCase() + words.slice(1) : key;
}

/** The request for one `static art` entry (as written in the game's code, or reported by the game). */
export function requestFromSpec(key: CastKey, spec: Record<string, unknown>, worldId: WorldId | null): Omit<DeskRequest, 'hero'> {
  const kind = pick(spec.kind, KINDS, 'character');
  const role = pick(spec.role, ROLES, kind === 'character' ? 'npc' : kind === 'background' ? 'background' : kind === 'terrain' ? 'terrain' : kind === 'projectile' ? 'projectile' : 'item');
  const rig = pick(spec.rig, RIGS, kind === 'character' ? 'blob' : 'none');
  const name = str(spec.name, nameFromKey(key));
  return {
    worldId,
    key,
    name,
    ask: str(spec.ask, ''),
    about: str(spec.about, ''),
    kind,
    rig,
    role,
    shape: pick(spec.shape, SHAPES, kind === 'character' ? 'capsule' : kind === 'terrain' ? 'tile' : 'box'),
    facing: pick(spec.facing, FACINGS, 'viewer'),
    pronoun: pick(spec.pronoun, PRONOUNS, kind === 'character' ? 'them' : 'it'),
    w: num(spec.w, kind === 'background' ? 960 : HERO_W),
    h: num(spec.h, kind === 'background' ? 540 : HERO_H),
  };
}

function fromMember(m: CastMember, worldId: WorldId): Omit<DeskRequest, 'hero'> {
  return {
    worldId,
    key: m.key,
    name: m.name,
    ask: m.ask,
    about: m.about,
    kind: m.kind,
    rig: m.rig,
    role: m.role,
    shape: m.shape,
    facing: m.facing,
    pronoun: m.pronoun,
    w: m.w,
    h: m.h,
  };
}

/** The game's `static art` entries, read from the world's code without running it. */
export function staticArt(world: World): Record<string, Record<string, unknown>> {
  try {
    const art = extractManifest(sourceFilesOf(world.code)).statics.art;
    if (art && typeof art === 'object') return art as Record<string, Record<string, unknown>>;
  } catch {
    // Code that does not parse still has a cast in its slots.
  }
  return {};
}

/**
 * The request for cast member `key` of `world`: from the running game's cast when it has the key, else the
 * code's `static art`, else the world's resting member. Null when the world has no such member.
 */
export function resolveRequest(world: World, key: CastKey, cast: readonly CastMember[] = []): DeskRequest | null {
  const specs = staticArt(world);
  const member = cast.find((m) => m.key === key);
  let base: Omit<DeskRequest, 'hero'> | null = null;
  if (member) base = fromMember(member, world.id);
  else if (specs[key]) base = requestFromSpec(key, specs[key], world.id);
  else {
    const extra = world.cast[key]?.extra;
    if (extra) base = { ...requestFromSpec(key, { kind: extra.kind, rig: extra.rig, role: extra.role, name: extra.name, about: extra.note }, world.id) };
  }
  if (!base) return null;
  return { ...base, hero: base.role === 'hero' ? null : heroOf(world, specs, cast) };
}

function heroOf(world: World, specs: Record<string, Record<string, unknown>>, cast: readonly CastMember[]): DeskRequest['hero'] {
  const m = cast.find((c) => c.role === 'hero');
  if (m) return { key: m.key, name: m.name, w: m.w, h: m.h, rig: m.rig };
  const entry = Object.entries(specs).find(([, s]) => s.role === 'hero');
  if (!entry) return null;
  const r = requestFromSpec(entry[0], entry[1], world.id);
  return { key: r.key ?? entry[0], name: r.name, w: r.w, h: r.h, rig: r.rig };
}

/** A free drawing (no request): a character that moves like a person, on a square board. */
export function freeRequest(name: string): DeskRequest {
  return { worldId: null, key: null, name, ask: '', about: '', kind: 'character', rig: 'biped', role: null, shape: 'capsule', facing: 'viewer', pronoun: 'them', w: HERO_W, h: HERO_H, hero: null };
}

/** Whether the request gets bones (a character with a rig kind). */
export function hasBones(r: Pick<DeskRequest, 'kind' | 'rig'>): boolean {
  return r.kind === 'character' && r.rig !== 'none';
}

/** Whether it flies or floats (its ground line says "floats here"). */
export function floats(r: Pick<DeskRequest, 'rig' | 'kind'>): boolean {
  return r.rig === 'flyer' || r.kind === 'projectile';
}

export type FactKey = 'bigRound' | 'bigTall' | 'small' | 'round' | 'faces' | 'facesAt' | 'facesYou' | 'times' | 'sameSize' | 'moves' | 'tiles' | 'fills';

/** One line of the request note, as a string key and its values (the note puts them in words). */
export interface Fact {
  key: FactKey;
  vars: Record<string, string | number>;
}

/** How many times as tall as the hero, in a kid-friendly number ("3", "1½", "half"). */
export function timesTall(h: number, heroH: number): string | null {
  if (!(h > 0 && heroH > 0)) return null;
  const k = h / heroH;
  if (k >= 0.85 && k <= 1.2) return null;
  if (k < 0.85) return k <= 0.6 ? 'half' : 'small';
  const halves = Math.round(k * 2) / 2;
  return Number.isInteger(halves) ? String(halves) : `${Math.floor(halves)}½`;
}

/**
 * The bullet facts on the request note (§2.10): the shape ("Big and round"), which way it faces ("Faces
 * left, at Pip"), how big ("3× as tall as Pip") and how it moves ("Moves like a blob").
 */
export function requestFacts(r: DeskRequest): Fact[] {
  const out: Fact[] = [];
  const big = r.hero ? r.h >= r.hero.h * 1.8 : r.h >= HERO_H * 1.8;
  const small = r.hero ? r.h <= r.hero.h * 0.6 : r.h <= HERO_H * 0.6;
  const round = r.shape === 'ellipse' || r.shape === 'coin' || r.rig === 'blob';
  if (big && round) out.push({ key: 'bigRound', vars: {} });
  else if (big) out.push({ key: 'bigTall', vars: {} });
  else if (small) out.push({ key: 'small', vars: {} });
  else if (round && r.kind === 'character') out.push({ key: 'round', vars: {} });
  if (r.kind === 'character' && r.rig !== 'none') {
    if (r.facing === 'viewer') out.push({ key: 'facesYou', vars: {} });
    else if (r.hero && r.role !== 'hero' && (r.role === 'boss' || r.role === 'enemy')) out.push({ key: 'facesAt', vars: { side: r.facing, hero: r.hero.name } });
    else out.push({ key: 'faces', vars: { side: r.facing } });
  }
  if (r.hero) {
    const t = timesTall(r.h, r.hero.h);
    if (t) out.push({ key: 'times', vars: { n: t, hero: r.hero.name } });
    else if (r.kind === 'character') out.push({ key: 'sameSize', vars: { hero: r.hero.name } });
  }
  if (r.kind === 'character' && r.rig !== 'none') out.push({ key: 'moves', vars: { rig: r.rig } });
  if (r.kind === 'terrain') out.push({ key: 'tiles', vars: {} });
  if (r.kind === 'background') out.push({ key: 'fills', vars: {} });
  return out.slice(0, 4);
}
