/**
 * The request tag's manners (§2.6): Amble asks for a drawing only when the game is paused, won or lost,
 * after the hero loses a life, or after 5 seconds without input; only for the highest-priority member the
 * game needs that has already appeared on screen; at most once per member every 2 minutes; never while
 * **Later** snoozes it (12 hours, `CastSlot.laterUntil`). While a Warm-up plays, it asks at once.
 */
import type { CastKey, CastMember, World } from '../model/types';

export const TAG_COOLDOWN_MS = 2 * 60_000;
export const LATER_MS = 12 * 60 * 60_000;
export const IDLE_MS = 5000;

export type TagTrigger = 'paused' | 'won' | 'lost' | 'death' | 'idle' | 'warmup';

export interface RequestInput {
  trigger: TagTrigger | null;
  now: number;
  /** When the tag last asked for each member (this session). */
  shownAt: Readonly<Record<CastKey, number>>;
  /** Members seen in an objects report (on top of the manifest's `used`). */
  seen?: ReadonlySet<CastKey>;
}

/** Whether this member may be asked for now, whatever the trigger. */
export function askable(m: CastMember, world: World, now: number, shownAt: Readonly<Record<CastKey, number>>): boolean {
  if (m.status !== 'needed') return false;
  const later = world.cast[m.key]?.laterUntil ?? 0;
  if (later > now) return false;
  const last = shownAt[m.key];
  return last === undefined || now - last >= TAG_COOLDOWN_MS;
}

/** The member the tag asks for now, or null. `cast` is in priority order (deriveCast). */
export function pickRequest(cast: CastMember[], world: World, input: RequestInput): CastMember | null {
  if (!input.trigger) return null;
  for (const m of cast) {
    if (!askable(m, world, input.now, input.shownAt)) continue;
    if (input.trigger !== 'warmup' && !m.onScreen && !input.seen?.has(m.key)) continue;
    return m;
  }
  return null;
}

/** The trigger a game event gives (lives going down is a death; the first lives report is not). */
export function triggerOf(e: { kind: string; value?: number }, lastLives: number | null): TagTrigger | null {
  if (e.kind === 'win') return 'won';
  if (e.kind === 'lose') return 'lost';
  if (e.kind === 'lives' && lastLives !== null && typeof e.value === 'number' && e.value < lastLives) return 'death';
  return null;
}

/** `laterUntil` for a member snoozed now. */
export function laterUntil(now: number): number {
  return now + LATER_MS;
}
