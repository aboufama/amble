/**
 * The frozen-game watchdog's judgement, kept free of the DOM so it can be tested. A running game posts its
 * stats once a second, so a game that stays silent is stuck in a loop the in-game guard missed. A slow
 * machine must not look like that:
 * - the count starts when a load starts (a warm spare may have been quiet for minutes before it);
 * - it holds while a robot test runs: the test steps a game flat out in the spare, which shares the visible
 *   game's renderer process and can starve it for seconds; it starts over when the test ends;
 * - a late tick means the editor's own thread was held up (a busy machine), and the game's messages may be
 *   queued behind it, so the count starts over; so does the first tick after a pause or a hidden tab;
 * - loading sends no heartbeat, and a cold boot is seconds of solid work on a busy Chromebook: it gets
 *   `LOADING_LIMITS` times the limit;
 * - a game whose messages already come in long gaps (slow frames) gets `SLOW_GAPS` of its longest gap.
 */

/** A tick this many intervals after the last one means the editor itself was held up. */
const LATE_TICKS = 2.5;
const LOADING_LIMITS = 3;
const SLOW_GAPS = 3;

export class FrozenWatch {
  /** When the current count started. */
  private since = 0;
  private lastTick = -Infinity;
  /** The newest message time a tick saw, and whether the game was running then. */
  private seen = -Infinity;
  private seenRunning = false;
  /** The longest gap between two messages of the running game since the count started. */
  private slowest = 0;
  private holds = 0;

  constructor(
    /** Silence (ms) that counts as frozen while the game runs at a normal pace. */
    readonly limitMs: number,
    /** How often the watchdog ticks (ms). */
    readonly tickMs: number,
  ) {}

  /** Starts the count over: a load started. */
  restart(now: number): void {
    this.since = now;
    this.slowest = 0;
  }

  /** A robot test started: no game counts as frozen until `release`. */
  hold(): void {
    this.holds++;
  }

  /** A robot test ended: the count starts over. */
  release(now: number): void {
    this.holds = Math.max(0, this.holds - 1);
    this.since = now;
  }

  get held(): boolean {
    return this.holds > 0;
  }

  /** How long the game may stay silent right now. */
  limit(loading: boolean): number {
    return loading ? this.limitMs * LOADING_LIMITS : Math.max(this.limitMs, this.slowest * SLOW_GAPS);
  }

  /**
   * One tick while a game is loading or running, with the time of its last message: true when it froze.
   * The caller skips ticks while the game is paused, over or hidden.
   */
  frozen(now: number, lastMessageAt: number, loading: boolean): boolean {
    const late = now - this.lastTick > this.tickMs * LATE_TICKS;
    this.lastTick = now;
    if (lastMessageAt > this.seen) {
      // A gap counts only between two messages of the running game, measured while the editor kept time.
      if (!late && !loading && this.seenRunning && this.seen >= this.since) this.slowest = Math.max(this.slowest, lastMessageAt - this.seen);
      this.seen = lastMessageAt;
      this.seenRunning = !loading;
    }
    if (late || this.holds > 0) {
      this.since = now;
      return false;
    }
    return now - Math.max(lastMessageAt, this.since) >= this.limit(loading);
  }
}
