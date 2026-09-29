/**
 * What Change mode shows over the paused world (§2.7), from the runtime's `objects` reports: one tag per
 * cast member (on its first instance, "Grumble ×2"), quiet tags for scenery, hit testing for taps on the
 * things themselves, and where a member stands (the come-alive flight's landing spot). Positions arrive in
 * CSS px of the game frame; the frame's rect on the page turns them into page px.
 */
import type { WorldObject } from '../cores/play';
import type { CastKey, Role } from '../model/types';

export interface FrameRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type TagTone = 'cast' | 'scenery';

export interface ThingTag {
  /** The object the tag stands on (its first instance). */
  id: number;
  key: CastKey;
  label: string;
  role: Role | 'scenery';
  count: number;
  drawn: boolean;
  tone: TagTone;
  /** The thing's box, in frame px. */
  box: Box;
}

const SCENERY_ROLES = new Set<string>(['terrain', 'background', 'decor', 'scenery']);

export function isScenery(role: Role | 'scenery'): boolean {
  return SCENERY_ROLES.has(role);
}

/** One tag per key, in the report's order (actors first, then scenery); things without a key get none. */
export function tagsOf(items: readonly WorldObject[]): ThingTag[] {
  const byKey = new Map<string, ThingTag>();
  for (const it of items) {
    if (!it.key) continue;
    const known = byKey.get(it.key);
    if (known) {
      if (it.count > known.count) known.count = it.count;
      continue;
    }
    byKey.set(it.key, {
      id: it.id,
      key: it.key,
      label: it.label,
      role: it.role,
      count: Math.max(1, it.count),
      drawn: it.drawn,
      tone: isScenery(it.role) ? 'scenery' : 'cast',
      box: { x: it.x, y: it.y, w: it.w, h: it.h },
    });
  }
  return [...byKey.values()];
}

/** The thing under a point (frame px): the smallest box wins, so a Grumble in front of the Moon King does. */
export function hitTest(items: readonly WorldObject[], x: number, y: number, pad = 6): WorldObject | null {
  let best: WorldObject | null = null;
  for (const it of items) {
    if (!it.key) continue;
    if (x < it.x - pad || x > it.x + it.w + pad || y < it.y - pad || y > it.y + it.h + pad) continue;
    // Scenery loses to anything standing on it.
    const rank = (o: WorldObject) => (isScenery(o.role) ? 1e9 : 0) + o.w * o.h;
    if (!best || rank(it) < rank(best)) best = it;
  }
  return best;
}

/** Where a member stands now (its first instance on screen), in frame px. */
export function boxOfKey(items: readonly WorldObject[], key: CastKey): Box | null {
  const it = items.find((o) => o.key === key);
  return it ? { x: it.x, y: it.y, w: it.w, h: it.h } : null;
}

/** Live instances per key (the Cast's "×3"). */
export function countsOf(items: readonly WorldObject[]): Record<CastKey, number> {
  const out: Record<CastKey, number> = {};
  for (const it of items) if (it.key && it.count) out[it.key] = Math.max(out[it.key] ?? 0, it.count);
  return out;
}

/** Frame px → page px. */
export function toPage(box: Box, frame: FrameRect): Box {
  return { x: frame.left + box.x, y: frame.top + box.y, w: box.w, h: box.h };
}

/** Keeps a tag of width `w` inside the frame: centred above the thing, or below it at the top edge. */
export function placeTag(box: Box, w: number, h: number, frame: { width: number; height: number }, gap = 8): { x: number; y: number; below: boolean } {
  const cx = box.x + box.w / 2;
  const x = Math.min(Math.max(6, cx - w / 2), Math.max(6, frame.width - w - 6));
  let y = box.y - h - gap;
  let below = false;
  if (y < 6) {
    y = Math.min(box.y + box.h + gap, frame.height - h - 6);
    below = true;
  }
  return { x, y, below };
}
