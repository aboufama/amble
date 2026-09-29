/** The clip library by kind, plus the names games and the Bones view may use for them. */
import type { CharacterKind } from '../types';
import { BIPED_CLIPS } from './biped';
import { BLOB_CLIPS } from './blob';
import type { Clip } from './ctx';
import { FLYER_CLIPS } from './flyer';
import { OBJECT_CLIPS } from './object';
import { QUADRUPED_CLIPS } from './quadruped';
import { die, fall, hurt, land, rage, rise, spin, wiggle } from './shared';
import { SWIMMER_CLIPS } from './swimmer';

/** Each kind's own clips win over the shared ones of the same name. */
const LIBRARY: Record<CharacterKind, Clip[]> = {
  biped: [...BIPED_CLIPS, rise, fall, land, hurt, die, rage, wiggle, spin],
  quadruped: [...QUADRUPED_CLIPS, rise, fall, land, hurt, rage, wiggle, spin],
  blob: [...BLOB_CLIPS, rise, fall, land, hurt, rage, wiggle, spin],
  flyer: [...FLYER_CLIPS, hurt, rage, wiggle, spin],
  swimmer: [...SWIMMER_CLIPS, hurt, rage, wiggle, spin],
  object: [...OBJECT_CLIPS, rage],
};

/** A friendly order for move buttons and contact sheets. */
const ORDER = ['idle', 'walk', 'run', 'dash', 'fly', 'swim', 'glide', 'jump', 'rise', 'fall', 'land', 'attack', 'shoot', 'hurt', 'die', 'wave', 'win', 'rage', 'wiggle', 'spin'];

const maps = new Map<CharacterKind, Map<string, Clip>>();

/** The clips a kind has, by name. */
export function clipMap(kind: CharacterKind): Map<string, Clip> {
  let m = maps.get(kind);
  if (!m) {
    m = new Map();
    for (const c of LIBRARY[kind] ?? LIBRARY.blob) if (!m.has(c.name)) m.set(c.name, c);
    const rank = (n: string) => (ORDER.indexOf(n) + ORDER.length + 1) % (ORDER.length + 1);
    m = new Map([...m].sort((a, b) => rank(a[0]) - rank(b[0])));
    maps.set(kind, m);
  }
  return m;
}

/** Names of a kind's clips, in a friendly order. */
export function clipsFor(kind: CharacterKind): string[] {
  return [...clipMap(kind).keys()];
}

/** Words for the same move (students, the AI and the kit use several), in order of preference. */
const ALIASES: Record<string, string[]> = {
  idle: ['stand', 'rest', 'breathe', 'hover', 'sway', 'still'],
  walk: ['move', 'hop', 'roll', 'trot', 'slither', 'paddle', 'drive', 'crawl', 'swim', 'fly'],
  run: ['sprint', 'gallop', 'zoom', 'race', 'dash'],
  jump: ['leap', 'bounce'],
  hurt: ['ouch', 'hit', 'damage', 'pain'],
  die: ['ko', 'dead', 'death', 'faint', 'lose', 'melt'],
  win: ['cheer', 'celebrate', 'victory', 'yay', 'happy', 'dance', 'wave'],
  attack: ['punch', 'kick', 'bite', 'swing', 'slash', 'shoot', 'zap', 'throw', 'dive', 'lunge', 'charge', 'cast', 'fire'],
  shoot: ['zap', 'throw', 'cast', 'fire'],
  fall: ['glide', 'drop'],
  wiggle: ['wobble', 'jiggle', 'shake'],
  rage: ['angry', 'mad', 'grow'],
};

/**
 * The clip to play for a name on a kind: the clip itself, else what that word means for this kind
 * (a flyer's "walk" is flying, a blob's "wave" is a happy hop), else null. Every clip name the game
 * kit uses resolves for every kind.
 */
export function resolveClip(kind: CharacterKind, name: string): Clip | null {
  const clips = clipMap(kind);
  const key = name.trim().toLowerCase();
  const exact = clips.get(key);
  if (exact) return exact;
  // a flyer's fly and a swimmer's swim are their own clips; everyone else walks
  if (key === 'fly' || key === 'swim') return clips.get(key) ?? clips.get('walk') ?? null;
  for (const [clip, words] of Object.entries(ALIASES)) {
    if (!words.includes(key)) continue;
    const c = clips.get(clip);
    if (c) return c;
  }
  return null;
}
