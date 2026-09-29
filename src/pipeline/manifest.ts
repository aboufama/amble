/**
 * What a game declares, read without running it (§5.7 `extractManifest`): its config, the art it asks the
 * student to draw and its dials, as the protocol's `GameManifest`. The Cast line and the Dials card use
 * this before the robot test (or the running game) reports the real one.
 */
import { extractManifest, sourceFilesOf } from '../cores/ai';
import type { Action, ArtKind, ArtNeed, ArtShape, DialInfo, Facing, GameManifest, Pronoun, RigKind, Role } from '../cores/play';
import type { CodeFile } from '../model/types';
import { kitManifestFor } from './kit';
import { kindSize } from './sizes';

export type Literal = string | number | boolean | null | Literal[] | { [key: string]: Literal };
export type Spec = Record<string, Literal>;

export interface Statics {
  config: Spec;
  art: Record<string, Spec>;
  dials: Record<string, Spec>;
}

const isSpec = (v: unknown): v is Spec => typeof v === 'object' && v !== null && !Array.isArray(v);

function records(v: unknown): Record<string, Spec> {
  if (!isSpec(v)) return {};
  const out: Record<string, Spec> = {};
  for (const [k, spec] of Object.entries(v)) if (isSpec(spec)) out[k] = spec;
  return out;
}

/** The literal statics of a game's files (empty parts when a file doesn't parse yet). */
export function readStatics(files: readonly CodeFile[] | ReadonlyArray<{ path: string; content: string }>): Statics {
  const src = files.map((f) => ('source' in f ? { path: f.path, content: f.source } : f));
  const m = extractManifest(src, kitManifestFor());
  return { config: isSpec(m.statics.config) ? m.statics.config : {}, art: records(m.statics.art), dials: records(m.statics.dials) };
}

export { sourceFilesOf };

const ROLES: readonly Role[] = ['hero', 'enemy', 'boss', 'npc', 'item', 'hazard', 'prop', 'terrain', 'projectile', 'enemyShot', 'decor', 'background'];
const KINDS: readonly ArtKind[] = ['character', 'item', 'projectile', 'prop', 'terrain', 'background', 'decor'];
const RIGS: readonly RigKind[] = ['biped', 'quadruped', 'flyer', 'swimmer', 'blob', 'object', 'none'];
const SHAPES: readonly ArtShape[] = ['box', 'ellipse', 'capsule', 'diamond', 'star', 'heart', 'coin', 'tile'];
const ACTIONS: readonly Action[] = ['left', 'right', 'up', 'down', 'jump', 'fire', 'dash', 'action', 'pause'];

/** Placeholder tints by role (§3.1), as the runtime paints them. */
export const ROLE_TINT: Record<Role, string> = {
  hero: '#7cc7ef', npc: '#c9b6f2', enemy: '#f08aa2', boss: '#a993ee', item: '#f2cf5e', hazard: '#f4a261', prop: '#c9c2b2',
  terrain: '#d9b98c', projectile: '#9cc3ff', enemyShot: '#9cc3ff', decor: '#bfc6e0', background: '#bfc6e0',
};

const str = (v: Literal | undefined): string | undefined => (typeof v === 'string' ? v : undefined);
const num = (v: Literal | undefined): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const oneOf = <T extends string>(v: Literal | undefined, list: readonly T[]): T | undefined => (typeof v === 'string' && (list as readonly string[]).includes(v) ? (v as T) : undefined);

/** "moonKing" -> "Moon King". */
export function humanKey(key: string): string {
  const words = key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').trim();
  return words ? words[0].toUpperCase() + words.slice(1).toLowerCase() : key;
}

function roleOf(kind: ArtKind, spec: Spec): Role {
  const role = oneOf(spec.role, ROLES);
  if (role) return role;
  if (kind === 'item') return 'item';
  if (kind === 'projectile') return 'projectile';
  if (kind === 'terrain') return 'terrain';
  if (kind === 'background') return 'background';
  if (kind === 'decor') return 'decor';
  if (kind === 'prop') return 'prop';
  return 'npc';
}

/** One declared picture as the editor sees it (defaults as the kit applies them). */
export function artNeedOf(key: string, spec: Spec, index: number, drawn = false): ArtNeed {
  const kind = oneOf(spec.kind, KINDS) ?? 'character';
  const role = roleOf(kind, spec);
  const name = str(spec.name) ?? humanKey(key);
  const character = kind === 'character';
  return {
    key,
    name,
    kind,
    rig: oneOf(spec.rig, RIGS) ?? (character ? 'blob' : 'none'),
    role,
    shape: oneOf(spec.shape, SHAPES) ?? (character ? 'capsule' : kind === 'item' ? 'ellipse' : 'box'),
    w: num(spec.w) ?? kindSize(kind).w,
    h: num(spec.h) ?? kindSize(kind).h,
    color: str(spec.color) ?? ROLE_TINT[role],
    ask: str(spec.ask) ?? `Draw the ${name}`,
    about: str(spec.about) ?? '',
    pronoun: (oneOf(spec.pronoun, ['him', 'her', 'them', 'it'] as const) ?? (character ? 'them' : 'it')) as Pronoun,
    facing: (oneOf(spec.facing, ['viewer', 'right', 'left'] as const) ?? (role === 'hero' ? 'right' : character ? 'left' : 'viewer')) as Facing,
    priority: num(spec.priority) ?? (role === 'hero' ? 1 : 10 + index),
    required: spec.spare === true ? false : typeof spec.required === 'boolean' ? spec.required : character && (role === 'hero' || role === 'boss' || role === 'enemy'),
    spare: spec.spare === true,
    declared: true,
    used: false,
    drawn,
  };
}

export function dialInfoOf(key: string, spec: Spec, current?: number): DialInfo {
  const min = num(spec.min) ?? 0;
  const max = num(spec.max) ?? 100;
  const value = num(spec.value) ?? min;
  const info: DialInfo & { for?: string } = {
    key,
    label: str(spec.label) ?? humanKey(key),
    value,
    min,
    max,
    step: num(spec.step) ?? 1,
    live: spec.live !== false,
    words: str(spec.words) ?? '',
    current: current ?? value,
    source: 'static',
  };
  const target = str(spec.for);
  if (target) info.for = target;
  return info;
}

/** The manifest a game declares (twists and used art are only known once it runs). */
export function manifestOf(statics: Statics, o: { drawn?: ReadonlySet<string>; dials?: Record<string, number> } = {}): GameManifest {
  const c = statics.config;
  const physics = oneOf(c.physics, ['arcade', 'matter', 'none'] as const) ?? 'arcade';
  const controls = isSpec(c.controls) ? Object.keys(c.controls).filter((a): a is Action => (ACTIONS as readonly string[]).includes(a)) : [];
  return {
    title: str(c.title) ?? '',
    subtitle: str(c.subtitle) ?? '',
    physics,
    kit: true,
    art: Object.entries(statics.art).map(([k, spec], i) => artNeedOf(k, spec, i, o.drawn?.has(k) ?? false)),
    dials: Object.entries(statics.dials).map(([k, spec]) => dialInfoOf(k, spec, o.dials?.[k])),
    twists: [],
    controls,
  };
}
