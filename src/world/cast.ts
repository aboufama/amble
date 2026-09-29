/**
 * The Cast as the UI shows it (§2.6, §4.2 `CastMember`): the running game's art needs merged with the
 * world's slots. Statuses: drawn, needed (required and not drawn), optional, spare (a starter's or the
 * game's "room for" member, used only once drawn) and resting (a drawing the code no longer uses, or a new
 * character not placed yet). Order: priority, then role (hero, boss, enemy...), resting last.
 */
import type { GameManifest } from '../cores/play';
import type { CastKey, CastMember, Role, StarterInfo, World } from '../model/types';

export const ROLE_ORDER: Role[] = ['hero', 'boss', 'enemy', 'npc', 'item', 'projectile', 'enemyShot', 'prop', 'hazard', 'terrain', 'background', 'decor'];

export interface CastOptions {
  /** The starter's spare slots (StarterCatalog.info). */
  starter?: Pick<StarterInfo, 'spare' | 'yourTurn'> | null;
  /** Live instances per key, from the last objects report. */
  counts?: Record<CastKey, number>;
}

function roleRank(role: Role): number {
  const i = ROLE_ORDER.indexOf(role);
  return i < 0 ? ROLE_ORDER.length : i;
}

/** "moonKing" → "Moon king" (only for members the code never named). */
export function nameFromKey(key: string): string {
  const words = key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').trim().toLowerCase();
  return words ? words[0].toUpperCase() + words.slice(1) : key;
}

export function deriveCast(manifest: GameManifest | null, world: World, o: CastOptions = {}): CastMember[] {
  const members: CastMember[] = [];
  const seen = new Set<string>();
  const spares = new Set(o.starter?.spare ?? []);
  for (const need of manifest?.art ?? []) {
    if (seen.has(need.key)) continue;
    seen.add(need.key);
    const art = world.cast[need.key]?.art ?? null;
    const spare = need.spare || spares.has(need.key);
    members.push({
      key: need.key,
      name: need.name,
      kind: need.kind,
      role: need.role,
      rig: need.rig,
      shape: need.shape,
      ask: need.ask,
      about: need.about,
      pronoun: need.pronoun,
      facing: need.facing,
      w: need.w,
      h: need.h,
      priority: need.priority,
      required: need.required && !spare,
      spare,
      art,
      status: art ? 'drawn' : spare ? 'spare' : need.required ? 'needed' : 'optional',
      onScreen: need.used,
      count: o.counts?.[need.key] ?? 0,
    });
  }
  for (const slot of Object.values(world.cast)) {
    if (seen.has(slot.key)) continue;
    // Before the game reports its needs, only certain facts show: drawings and added members.
    if (!slot.art && !slot.extra) continue;
    seen.add(slot.key);
    const extra = slot.extra;
    const rig = extra?.rig ?? 'blob';
    members.push({
      key: slot.key,
      name: extra?.name ?? nameFromKey(slot.key),
      kind: extra?.kind ?? 'character',
      role: extra?.role ?? 'npc',
      rig,
      shape: 'capsule',
      ask: '',
      about: extra?.note ?? '',
      pronoun: 'them',
      facing: 'viewer',
      w: 40,
      h: 64,
      priority: 99,
      required: false,
      spare: false,
      art: slot.art,
      // Without a manifest a drawn slot is still drawn; once the game has spoken, unused ones rest.
      status: manifest ? 'resting' : slot.art ? 'drawn' : 'resting',
      onScreen: false,
      count: 0,
    });
  }
  const rank = (m: CastMember) => (m.status === 'resting' ? 1 : 0);
  return members.sort((a, b) => rank(a) - rank(b) || a.priority - b.priority || roleRank(a.role) - roleRank(b.role) || a.key.localeCompare(b.key));
}

/** "4 of 6 drawn": members the game plays (not spares, not resting). */
export function castProgress(cast: CastMember[]): { drawn: number; total: number; allRequired: boolean } {
  const playing = cast.filter((m) => m.status === 'drawn' || m.status === 'needed' || m.status === 'optional');
  return {
    drawn: playing.filter((m) => m.status === 'drawn').length,
    total: playing.length,
    allRequired: playing.length > 0 && !playing.some((m) => m.status === 'needed'),
  };
}

/** The member Amble most wants drawn next (the Cast line's glowing card, `D`, the request tag). */
export function nextNeeded(cast: CastMember[]): CastMember | null {
  return cast.find((m) => m.status === 'needed') ?? null;
}
