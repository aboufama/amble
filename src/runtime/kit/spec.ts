/**
 * Art specs: what a piece of art is (kind, rig, role, size, shape) from `static art`, or guessed from its
 * key when the game only uses it ("coin", "bossDragon"...). Pure.
 */
import { ART_KINDS, ART_SHAPES, RIG_KINDS, ROLES, type ArtKind, type ArtNeed, type ArtShape, type Facing, type Pronoun, type RigKind, type Role } from '../../play/protocol';
import { colorInt, cssColor } from './color';

export interface ArtSpec {
  key: string;
  name: string;
  kind: ArtKind;
  rig: RigKind;
  role: Role;
  shape: ArtShape;
  w: number;
  h: number;
  /** Stand-in tint, 0xRRGGBB. */
  color: number;
  /** Terrain: colour of the top band. */
  top: number | null;
  ask: string;
  about: string;
  pronoun: Pronoun;
  facing: Facing;
  priority: number;
  required: boolean;
  declared: boolean;
}

/** Night Studio role tints (design tokens), so stand-ins match the editor's Cast. */
export const ROLE_TINTS: Record<Role, number> = {
  hero: 0x7cc4ff,
  boss: 0xb69cff,
  enemy: 0xff5c8a,
  npc: 0x7ddf8c,
  item: 0xffd23f,
  hazard: 0xff8c42,
  prop: 0xd8c3a5,
  terrain: 0x8b83a8,
  projectile: 0x43e6b0,
  enemyShot: 0xff5ea8,
  decor: 0xa0aec0,
  background: 0x2e2850,
};

const ROLE_ORDER: Role[] = ['hero', 'boss', 'enemy', 'npc', 'item', 'hazard', 'projectile', 'enemyShot', 'prop', 'terrain', 'background', 'decor'];

const KIND_SIZES: Record<ArtKind, [number, number]> = {
  character: [40, 64],
  projectile: [16, 16],
  item: [28, 28],
  prop: [44, 44],
  terrain: [32, 32],
  background: [960, 540],
  decor: [48, 48],
};

const RIG_SYNONYMS: Record<string, RigKind> = {
  snake: 'swimmer', worm: 'swimmer', fish: 'swimmer', bird: 'flyer', wings: 'flyer', animal: 'quadruped', dog: 'quadruped',
  person: 'biped', human: 'biped', humanoid: 'biped', slime: 'blob', thing: 'object', vehicle: 'object', rigid: 'none',
};

type Guess = Partial<Pick<ArtSpec, 'kind' | 'rig' | 'role' | 'shape' | 'w' | 'h'>>;

/** A reasonable spec from the key alone ("dragonBoss", "coin", "lava"). */
export function guessFromKey(key: string): Guess {
  const n = key.toLowerCase();
  const has = (re: RegExp) => re.test(n);
  if (has(/hero|player|\bme\b|pilot|kid|runner|knight|wizard/)) return { kind: 'character', rig: 'biped', role: 'hero' };
  if (has(/boss|king|queen|titan|overlord/)) return { kind: 'character', rig: has(/dragon/) ? 'flyer' : 'blob', role: 'boss', w: 200, h: 180 };
  if (has(/dragon|bird|bat|bee|butterfly|ghost|owl|plane/)) return { kind: 'character', rig: 'flyer', role: 'enemy', w: 64, h: 48 };
  if (has(/fish|shark|snake|worm|eel/)) return { kind: 'character', rig: 'swimmer', role: 'enemy', w: 72, h: 32 };
  if (has(/dog|cat|horse|wolf|fox|pig|cow|dino|bear/)) return { kind: 'character', rig: 'quadruped', role: 'npc', w: 64, h: 48 };
  if (has(/enemy|slime|monster|alien|robot|zombie|minion|critter|bug|blob|goblin|grumble/)) return { kind: 'character', rig: 'blob', role: 'enemy', w: 46, h: 42 };
  if (has(/dummy|person|guy|npc|friend|villager/)) return { kind: 'character', rig: 'biped', role: 'npc' };
  if (has(/bomb|grenade/)) return { kind: 'projectile', role: 'enemyShot', shape: 'ellipse', w: 26, h: 26 };
  if (has(/bullet|shot|laser|orb|fireball|arrow|missile|pew|spark|bolt|bubble|snowball/)) return { kind: 'projectile', role: 'projectile' };
  if (has(/coin|gem|star|heart|key|potion|power|item|pickup|magnet|clock|mushroom|apple|fruit|crystal/)) return { kind: 'item', role: 'item' };
  if (has(/ground|floor|platform|wall|tile|block|brick|ledge|dirt|grass|ice|sand/)) return { kind: 'terrain', role: 'terrain' };
  if (has(/spike|lava|saw|hazard|trap|fire/)) return { kind: 'prop', role: 'hazard', shape: 'star' };
  if (has(/sky|background|backdrop|scenery|space|night/)) return { kind: 'background', role: 'background', w: 960, h: 540 };
  if (has(/ball|rock|boulder|planet|moon/)) return { kind: 'prop', role: 'prop', shape: 'ellipse' };
  if (has(/tree|bush|flower|cloud|sign|lamp/)) return { kind: 'decor', role: 'decor' };
  return { kind: 'prop', role: 'prop' };
}

/** "moonKing" / "moon_king" -> "Moon King" */
export function nameFromKey(key: string): string {
  const words = key
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim();
  return words.replace(/\b\w/g, (c) => c.toUpperCase()).slice(0, 40) || 'Drawing';
}

function pick<T extends string>(v: unknown, list: readonly T[]): T | undefined {
  return typeof v === 'string' && (list as readonly string[]).includes(v) ? (v as T) : undefined;
}

function size(v: unknown, fallback: number, max: number): number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.min(max, v) : fallback;
}

function defaultShape(key: string, kind: ArtKind, w: number, h: number): ArtShape {
  const n = key.toLowerCase();
  if (kind === 'projectile') return w > h * 1.4 || h > w * 1.4 ? 'capsule' : 'ellipse';
  if (kind === 'item') return /star/.test(n) ? 'star' : /heart/.test(n) ? 'heart' : /gem|diamond|crystal/.test(n) ? 'diamond' : /coin/.test(n) ? 'coin' : 'box';
  if (kind === 'terrain') return 'tile';
  return 'box';
}

function defaultAsk(role: Role, kind: ArtKind, name: string): string {
  if (role === 'hero') return 'Draw your hero';
  if (role === 'boss') return `Draw the ${name}, a big boss`;
  if (kind === 'background') return `Draw the ${name.toLowerCase()} behind everything`;
  const lower = name.toLowerCase();
  return `Draw ${/^[aeiou]/.test(lower) ? 'an' : 'a'} ${lower}`;
}

/**
 * The full spec for a key from whatever the game declared (`static art` entry, possibly partial or wrong)
 * plus guesses from the key. Never throws.
 */
export function normalizeSpec(key: string, input?: unknown, declared = input !== undefined && input !== null): ArtSpec {
  const o = typeof input === 'object' && input !== null ? (input as Record<string, unknown>) : {};
  const guess = guessFromKey(key);
  const kind = pick(o.kind, ART_KINDS) ?? guess.kind ?? 'prop';
  const kindChanged = o.kind !== undefined && kind !== guess.kind;
  const role = pick(o.role, ROLES) ?? (kindChanged ? undefined : guess.role) ?? roleForKind(kind);
  const [dw, dh] = KIND_SIZES[kind];
  const gw = kindChanged ? undefined : guess.w;
  const gh = kindChanged ? undefined : guess.h;
  const w = size(o.w, gw ?? dw, 4096);
  const h = size(o.h, gh ?? dh, 4096);
  const rigIn = typeof o.rig === 'string' ? (RIG_SYNONYMS[o.rig] ?? pick(o.rig, RIG_KINDS)) : undefined;
  let rig: RigKind = rigIn ?? (kind === 'character' ? (kindChanged ? undefined : guess.rig) ?? (w > h * 1.1 ? 'blob' : 'biped') : 'none');
  if (kind !== 'character' && rig !== 'none' && rig !== 'object') rig = 'none';
  const shape = pick(o.shape, ART_SHAPES) ?? (kindChanged ? undefined : guess.shape) ?? defaultShape(key, kind, w, h);
  const name = typeof o.name === 'string' && o.name.trim() ? o.name.trim().slice(0, 40) : nameFromKey(key);
  const priorityIn = typeof o.priority === 'number' && Number.isFinite(o.priority) ? Math.round(o.priority) : undefined;
  return {
    key,
    name,
    kind,
    rig,
    role,
    shape,
    w,
    h,
    color: colorInt(o.color, ROLE_TINTS[role]),
    top: o.top === undefined ? null : colorInt(o.top, 0xffffff),
    ask: typeof o.ask === 'string' && o.ask.trim() ? o.ask.trim().slice(0, 120) : defaultAsk(role, kind, name),
    about: typeof o.about === 'string' ? o.about.slice(0, 160) : '',
    pronoun: pick(o.pronoun, ['him', 'her', 'them', 'it'] as const) ?? 'it',
    facing: pick(o.facing, ['viewer', 'right', 'left'] as const) ?? (kind === 'character' ? 'right' : 'viewer'),
    priority: priorityIn ?? 10 + ROLE_ORDER.indexOf(role),
    required: typeof o.required === 'boolean' ? o.required : kind === 'character' && (role === 'hero' || role === 'boss' || role === 'enemy'),
    declared,
  };
}

function roleForKind(kind: ArtKind): Role {
  switch (kind) {
    case 'character':
      return 'npc';
    case 'item':
      return 'item';
    case 'projectile':
      return 'projectile';
    case 'terrain':
      return 'terrain';
    case 'background':
      return 'background';
    case 'decor':
      return 'decor';
    default:
      return 'prop';
  }
}

/** The protocol's view of a spec. */
export function toArtNeed(spec: ArtSpec, flags: { used: boolean; drawn: boolean }): ArtNeed {
  return {
    key: spec.key,
    name: spec.name,
    kind: spec.kind,
    rig: spec.rig,
    role: spec.role,
    shape: spec.shape,
    w: spec.w,
    h: spec.h,
    color: cssColor(spec.color),
    ask: spec.ask,
    about: spec.about,
    pronoun: spec.pronoun,
    facing: spec.facing,
    priority: spec.priority,
    required: spec.required,
    declared: spec.declared,
    used: flags.used,
    drawn: flags.drawn,
  };
}

/** The order Amble asks the student to draw things: priority, then role, then declared before guessed. */
export function askOrder(a: ArtSpec, b: ArtSpec): number {
  return a.priority - b.priority || ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role) || Number(b.declared) - Number(a.declared) || a.key.localeCompare(b.key);
}
