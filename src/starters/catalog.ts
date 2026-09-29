/**
 * The five starter worlds in Trail order, plus the hidden Parade (§9), and what the Trail and the plan
 * card show about each.
 */
import { t, type MessageKey } from '../i18n';
import type { SeedId, StarterId, StarterInfo } from '../model/types';
import { clanksClimb } from './clanks-climb/meta';
import { lanternMaze } from './lantern-maze/meta';
import { moonKing } from './moon-king/meta';
import { parade } from './parade/meta';
import { skyRun } from './sky-run/meta';
import type { StarterMeta } from './types';
import { wobbleTower } from './wobble-tower/meta';

/** Trail order: the five starters, then the hidden Parade. */
export const STARTERS: readonly StarterMeta[] = [moonKing, skyRun, wobbleTower, lanternMaze, clanksClimb, parade];

export const STARTER_IDS: readonly StarterId[] = ['moon-king', 'sky-run', 'wobble-tower', 'lantern-maze', 'clanks-climb'];

export function isSeedId(v: unknown): v is SeedId {
  return typeof v === 'string' && STARTERS.some((s) => s.id === v);
}

/** A starter's definition (an unknown id gets Moon King, the ladder's default). */
export function metaOf(id: SeedId): StarterMeta {
  return STARTERS.find((s) => s.id === id) ?? moonKing;
}

/** Where a starter's committed files live, relative to the app (`public/starters/<id>/`). */
export function starterPath(id: SeedId, rest = ''): string {
  return `starters/${id}/${rest}`;
}

export function infoOf(m: StarterMeta, base = ''): StarterInfo {
  return {
    id: m.id,
    title: t(`starters.${m.ns}Title` as MessageKey),
    genre: t(`starters.${m.ns}Genre` as MessageKey),
    blurb: t(`starters.${m.ns}Blurb` as MessageKey),
    teaches: t(`starters.staff_${m.ns}Teaches` as MessageKey),
    sign: m.id === 'parade' ? '' : base + starterPath(m.id, 'sign.png'),
    heroKey: m.heroKey,
    yourTurn: m.yourTurn,
    spare: [...m.spare],
    tags: [...m.tags],
    hidden: m.id === 'parade',
  };
}
