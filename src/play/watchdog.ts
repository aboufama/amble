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

/**
 * The robot test's watchdog, judged by progress rather than a flat wall-clock limit: a slow machine plays
 * the 6 s of game time slowly, and that is fine as long as frames keep finishing. The runtime reports the
 * frames it has stepped when the run starts and then about three times a second (mid-frame-batch too), so:
 * - `start`: the run has not begun this long after the game booted (its `create()` never ended);
 * - `stall`: no frame has finished for `stallMs` (a loop that never ends, even unguarded), or for
 *   `SLOW_GAPS` of the longest wait between two reports that did show progress, when that is longer: on a
 *   busy machine the hidden frame can wait seconds between its batches of frames for a turn to run;
 * - `ceiling`: the run is still going after `ceilingMs` in all (generous: only a hopelessly slow game).
 */
export interface RobotLimits {
  startMs: number;
  stallMs: number;
  ceilingMs: number;
}

export const ROBOT_LIMITS: RobotLimits = { startMs: 20_000, stallMs: 4000, ceilingMs: 60_000 };

export type RobotStop = 'start' | 'stall' | 'ceiling';

export class RobotWatch {
  /** Frames at the first report, the newest frame count, and when it last grew. */
  private startFrames = -1;
  private frames = -1;
  private firstAt = -1;
  private lastAt: number;
  /** The longest wait between two reports that showed progress. */
  private slowest = 0;

  constructor(
    /** When the game booted (the watch starts then). */
    private readonly bootedAt: number,
    private readonly limits: RobotLimits = ROBOT_LIMITS,
  ) {
    this.lastAt = bootedAt;
  }

  /** A progress report: the frames the game has stepped so far. */
  progress(frames: number, now: number): void {
    if (this.firstAt < 0) {
      this.firstAt = now;
      this.startFrames = frames;
      this.frames = frames;
      this.lastAt = now;
      return;
    }
    if (frames > this.frames) {
      this.slowest = Math.max(this.slowest, now - this.lastAt);
      this.frames = frames;
      this.lastAt = now;
    }
  }

  /** How long the run may go without a finished frame right now. */
  stallLimit(): number {
    return Math.max(this.limits.stallMs, this.slowest * SLOW_GAPS);
  }

  /** Frames the robot stepped since its run began, and the wall time that took (for an honest speed). */
  played(now: number): { frames: number; wallMs: number } {
    if (this.firstAt < 0) return { frames: 0, wallMs: Math.max(0, now - this.bootedAt) };
    return { frames: Math.max(0, this.frames - this.startFrames), wallMs: Math.max(0, now - this.firstAt) };
  }

  /** Why the run should stop now, or null while it is healthy. */
  check(now: number): RobotStop | null {
    if (now - this.bootedAt >= this.limits.ceilingMs) return 'ceiling';
    if (this.firstAt < 0) return now - this.bootedAt >= this.limits.startMs ? 'start' : null;
    return now - this.lastAt >= this.stallLimit() ? 'stall' : null;
  }
}
