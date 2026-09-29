/**
 * The plan's relative sizes in game pixels (§5.4). The hero unit is 40x64: characters scale it; things
 * without bones (items, shots, props) are square on the hero's width; terrain is one 32 px tile; a
 * background covers the screen.
 */
import type { ArtKind, PlanCastItem } from '../model/types';

export const HERO_UNIT = { w: 40, h: 64 } as const;
export const SCREEN = { w: 960, h: 540 } as const;

export const SIZE_SCALE = { tiny: 0.4, small: 0.7, hero: 1, big: 2, huge: 3.5 } as const;

export type PlanSize = PlanCastItem['size'];

export function sizeOf(size: PlanSize, kind: ArtKind = 'character'): { w: number; h: number } {
  if (size === 'screen' || kind === 'background') return { ...SCREEN };
  if (kind === 'terrain') return { w: 32, h: 32 };
  const k = SIZE_SCALE[size];
  if (kind === 'character') return { w: Math.round(HERO_UNIT.w * k), h: Math.round(HERO_UNIT.h * k) };
  const side = Math.max(12, Math.round(HERO_UNIT.w * k));
  return { w: side, h: side };
}
