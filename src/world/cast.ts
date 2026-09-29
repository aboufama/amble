/**
 * The Cast as the UI shows it (§4.2 `CastMember`; M2 owns): the running game's art needs plus the
 * world's slots. FOUNDATION-STUB with the basics (drawn, needed, optional, resting); M2 adds spares,
 * counts and the request order.
 */
import type { GameManifest } from '../cores/play';
import type { CastMember, Role, World } from '../model/types';

const ROLE_ORDER: Role[] = ['hero', 'boss', 'enemy', 'npc', 'item', 'projectile', 'enemyShot', 'hazard', 'prop', 'terrain', 'background', 'decor'];

export function deriveCast(manifest: GameManifest | null, world: World): CastMember[] {
  const members: CastMember[] = [];
  const seen = new Set<string>();
  for (const need of manifest?.art ?? []) {
    seen.add(need.key);
    const art = world.cast[need.key]?.art ?? null;
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
      required: need.required,
      spare: need.spare,
      art,
      status: art ? 'drawn' : need.spare ? 'spare' : need.required ? 'needed' : 'optional',
      onScreen: need.used,
      count: 0,
    });
  }
  for (const slot of Object.values(world.cast)) {
    if (seen.has(slot.key) || (!slot.art && !slot.extra)) continue;
    const extra = slot.extra;
    members.push({
      key: slot.key,
      name: extra?.name ?? slot.key,
      kind: extra?.kind ?? 'character',
      role: extra?.role ?? 'npc',
      rig: extra?.rig ?? 'blob',
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
      status: 'resting',
      onScreen: false,
      count: 0,
    });
  }
  return members.sort((a, b) => a.priority - b.priority || ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role));
}
