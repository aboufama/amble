/**
 * The player's watchdogs: a truly frozen game is stopped; a slow machine, a robot test or a stale spare is
 * not. The robot test's run is judged by its progress, not by a flat wall-clock limit.
 */
import { describe, expect, it } from 'vitest';
import { FrozenWatch, RobotWatch } from '../../src/play/watchdog';

const LIMIT = 10_000;
const TICK = 1000;

/** Ticks once a second from `from` to `to` (inclusive); `messages(t)` is the game's last message time at t. */
function run(watch: FrozenWatch, from: number, to: number, messages: (t: number) => number, loading: (t: number) => boolean = () => false): number | null {
  for (let t = from; t <= to; t += TICK) if (watch.frozen(t, messages(t), loading(t))) return t;
  return null;
}

/** A game that posts once a second until `stop`, then never again. */
const heartbeat = (start: number, stop = Infinity) => (t: number) => Math.min(t, stop) - ((Math.min(t, stop) - start) % 1000);

describe('the frozen-game watchdog', () => {
  it('stops a game that goes silent while running, after the limit', () => {
    const watch = new FrozenWatch(LIMIT, TICK);
    watch.restart(0);
    expect(run(watch, 0, 60_000, heartbeat(0, 20_000))).toBe(30_000);
  });

  it('never stops a game that keeps posting', () => {
    const watch = new FrozenWatch(LIMIT, TICK);
    watch.restart(0);
    expect(run(watch, 0, 120_000, heartbeat(0))).toBeNull();
  });

  it('counts from the load, not from when a warm spare last spoke', () => {
    const watch = new FrozenWatch(LIMIT, TICK);
    watch.restart(0);
    // One game runs for 90 s; the spare connected at 0 s and has said nothing since. The load takes it.
    expect(run(watch, 0, 89_000, heartbeat(0))).toBeNull();
    watch.restart(90_000);
    expect(run(watch, 90_000, 110_000, () => 0, () => true)).toBeNull();
    // Without the restart, that silence reads as 90 s of a frozen game.
    const stale = new FrozenWatch(LIMIT, TICK);
    stale.restart(0);
    run(stale, 0, 89_000, heartbeat(0));
    expect(stale.frozen(90_000, 0, true)).toBe(true);
  });

  it('gives loading three times the limit (no heartbeat while a cold boot works)', () => {
    const watch = new FrozenWatch(LIMIT, TICK);
    watch.restart(0);
    expect(run(watch, 0, 29_000, () => 0, () => true)).toBeNull();
    expect(run(watch, 30_000, 31_000, () => 0, () => true)).toBe(30_000);
  });

  it('holds while a robot test starves the visible game, and starts over when it ends', () => {
    const watch = new FrozenWatch(LIMIT, TICK);
    watch.restart(0);
    const game = heartbeat(0, 5000);
    expect(run(watch, 0, 8000, game)).toBeNull();
    watch.hold();
    expect(watch.held).toBe(true);
    expect(run(watch, 9000, 40_000, game)).toBeNull();
    watch.release(40_500);
    expect(watch.held).toBe(false);
    // The game is quiet since 5 s: it gets a full limit from the end of the test.
    expect(run(watch, 41_000, 49_000, game)).toBeNull();
    expect(run(watch, 50_000, 51_000, game)).toBe(51_000);
  });

  it('starts over when the editor itself was held up (a late tick), since messages may be queued behind it', () => {
    const watch = new FrozenWatch(LIMIT, TICK);
    watch.restart(0);
    expect(run(watch, 0, 8000, heartbeat(0, 2000))).toBeNull();
    // The editor's thread was busy from 8 s to 20 s: the silence after 2 s is not the game's fault.
    expect(watch.frozen(20_000, 2000, false)).toBe(false);
    expect(run(watch, 21_000, 29_000, () => 2000)).toBeNull();
    expect(watch.frozen(30_000, 2000, false)).toBe(true);
  });

  it('gives a game with slow frames three of its longest gaps', () => {
    const watch = new FrozenWatch(LIMIT, TICK);
    watch.restart(0);
    // Stats arrive every 6 s (6 s frames on a starved machine), then stop at 60 s.
    const slow = (t: number) => Math.min(t, 60_000) - (Math.min(t, 60_000) % 6000);
    expect(run(watch, 0, 60_000, slow)).toBeNull();
    expect(watch.limit(false)).toBe(18_000);
    expect(run(watch, 61_000, 120_000, slow)).toBe(78_000);
  });

  it('does not stretch the limit for the gap of a slow boot', () => {
    const watch = new FrozenWatch(LIMIT, TICK);
    watch.restart(0);
    // Booted at 1 s, first frame (and state running) at 15 s, then a normal heartbeat.
    const boot = (t: number) => (t < 15_000 ? Math.min(t, 1000) : heartbeat(15_000)(t));
    expect(run(watch, 0, 40_000, boot, (t) => t < 15_000)).toBeNull();
    expect(watch.limit(false)).toBe(LIMIT);
  });
});

describe("the robot test's watchdog", () => {
  const LIMITS = { startMs: 20_000, stallMs: 4000, ceilingMs: 60_000 };

  it('lets a slow but healthy run take its time (frames keep finishing)', () => {
    const watch = new RobotWatch(0, LIMITS);
    // 6 s of game (360 frames) at a tenth of real time: 36 s, reported every 500 ms.
    for (let t = 1000; t <= 37_000; t += 500) {
      watch.progress(Math.min(360, Math.floor(((t - 1000) / 36_000) * 360)), t);
      expect(watch.check(t), `at ${t} ms`).toBeNull();
    }
    expect(watch.played(37_000)).toEqual({ frames: 360, wallMs: 36_000 });
  });

  it('stops a run within seconds once its frames stop finishing (a loop that never ends)', () => {
    const watch = new RobotWatch(0, LIMITS);
    watch.progress(0, 800);
    watch.progress(30, 1300);
    // The game's update never returns: no report ever comes again.
    expect(watch.check(5200)).toBeNull();
    expect(watch.check(5300)).toBe('stall');
    expect(watch.played(5300)).toEqual({ frames: 30, wallMs: 4500 });
  });

  it('counts only frames that finish: repeated reports of the same frame are no progress', () => {
    const watch = new RobotWatch(0, LIMITS);
    watch.progress(10, 500);
    for (let t = 1000; t <= 4000; t += 500) watch.progress(10, t);
    expect(watch.check(4500)).toBe('stall');
  });

  it('gives the game time to start playing, then stops one that never does', () => {
    const watch = new RobotWatch(0, LIMITS);
    expect(watch.check(19_000)).toBeNull();
    expect(watch.check(20_000)).toBe('start');
    expect(watch.played(20_000)).toEqual({ frames: 0, wallMs: 20_000 });
  });

  it('ends a run that is still going at the ceiling', () => {
    const watch = new RobotWatch(0, LIMITS);
    for (let t = 500; t < 60_000; t += 500) {
      watch.progress(t / 500, t);
      expect(watch.check(t)).toBeNull();
    }
    expect(watch.check(60_000)).toBe('ceiling');
  });
});
