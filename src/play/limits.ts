/**
 * Rate limits for messages from a player: game code runs in that realm and can post as fast as it likes,
 * so the editor accepts at most so many logs per second, errors per run, and so on. Pure.
 */
import type { FromPlayerType } from './protocol';

export interface Limit {
  /** Messages allowed per rolling second. */
  perSecond?: number;
  /** Messages allowed for the whole run of one game. */
  perRun?: number;
}

export const PLAYER_LIMITS: Partial<Record<FromPlayerType, Limit>> = {
  log: { perSecond: 50, perRun: 2000 },
  warn: { perSecond: 20, perRun: 200 },
  error: { perSecond: 20, perRun: 50 },
  event: { perSecond: 60 },
  artMissing: { perSecond: 30, perRun: 128 },
  artClicked: { perSecond: 10 },
  manifest: { perSecond: 4 },
  stats: { perSecond: 4 },
  storage: { perSecond: 10 },
  state: { perSecond: 30 },
  csp: { perSecond: 5, perRun: 20 },
  swapped: { perSecond: 60 },
  audio: { perSecond: 10 },
};

/** Counts messages by type; `allow` says whether one more may pass right now. */
export class RateLimiter<T extends string = string> {
  private readonly windows = new Map<T, number[]>();
  private readonly totals = new Map<T, number>();

  constructor(private readonly limits: Partial<Record<T, Limit>>) {}

  allow(type: T, now: number): boolean {
    const limit = this.limits[type];
    if (!limit) return true;
    const total = this.totals.get(type) ?? 0;
    if (limit.perRun !== undefined && total >= limit.perRun) return false;
    if (limit.perSecond !== undefined) {
      const recent = (this.windows.get(type) ?? []).filter((t) => now - t < 1000);
      if (recent.length >= limit.perSecond) {
        this.windows.set(type, recent);
        return false;
      }
      recent.push(now);
      this.windows.set(type, recent);
    }
    this.totals.set(type, total + 1);
    return true;
  }

  reset(): void {
    this.windows.clear();
    this.totals.clear();
  }
}
