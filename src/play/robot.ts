/**
 * The robot test: before a generated game is swapped in, it plays for a few seconds of GAME time in a hidden
 * player. The runtime steps Phaser on a manual clock (never requestAnimationFrame, which Chrome stops in
 * hidden and off-screen frames), a scripted bot moves, jumps, shoots and clicks around, and the result says
 * whether it broke, whether anything moved, and why it failed.
 */
import { PlayerFrame } from './frame';
import { DEFAULT_PREFS, type FromPlayer, type InitMessage, type PlayerError, type PlayerPrefs } from './protocol';
import { judgeRobot, ROBOT_THRESHOLDS, type RobotReport, type RobotThresholds } from './robotJudge';
import type { GameBundle } from './player';
import { ROBOT_LIMITS, RobotWatch, type RobotLimits, type RobotStop } from './watchdog';

export interface RobotTestOptions {
  runtimeUrl: string;
  bundle: GameBundle;
  /** Game time to simulate (default 6000 ms). */
  gameMs?: number;
  /** Seeds Math.random and Phaser's RNG (default 1). */
  seed?: number;
  /** 'auto' (default) drives the hero; 'none' only watches. */
  bot?: 'auto' | 'none';
  /**
   * Wall-clock ceiling after the game booted (default 60 s). Below it the run is judged by its progress: it
   * counts as frozen only when no frame finishes for a few seconds (see `RobotWatch`), never for being slow.
   */
  timeoutMs?: number;
  thresholds?: RobotThresholds;
  /** Where the hidden iframe lives (default: a hidden box on document.body). */
  host?: HTMLElement;
  /** A warm frame to use instead of booting a new one (it is destroyed afterwards). */
  frame?: PlayerFrame;
}

const BOOT_LIMIT_MS = 20_000;

function hiddenHost(): HTMLElement {
  const el = document.createElement('div');
  el.setAttribute('aria-hidden', 'true');
  el.style.cssText = 'position:fixed;left:-10000px;top:0;width:480px;height:270px;overflow:hidden;pointer-events:none';
  document.body.append(el);
  return el;
}

const FRAME_MS = 1000 / 60;

/** A run the host stopped: what it had played so far (frames and wall time, so the speed is honest). */
interface Played {
  frames: number;
  wallMs: number;
}

function frozenReport(message: string, expectedFrames: number, played: Played, thresholds: RobotThresholds, earlier: PlayerError[] = []): RobotReport {
  const error: PlayerError = { phase: 'frozen', message, count: 1, fatal: true };
  const empty = {
    fps: 0, frameMs: 0, frames: 0, objects: 0, particles: 0, arcadeBodies: 0, matterBodies: 0, shots: 0, tweens: 0, drawCalls: 0,
    textureMB: 0, heapMB: null, quality: 1 as const, timeScale: 1, state: 'crashed' as const, audio: 'none' as const, errors: 1,
  };
  const gameMs = Math.round(played.frames * FRAME_MS);
  const wallMs = Math.round(played.wallMs);
  return judgeRobot(
    {
      gameMs, frames: played.frames, wallMs, speed: wallMs > 0 ? Math.round((gameMs / wallMs) * 100) / 100 : 0,
      errors: [...earlier, error], warnings: [], events: [], artMissing: [], state: 'crashed',
      hero: { found: false, controlled: false, moved: 0, alive: false }, movers: 0, frameDiff: 0, lumaVariance: 0,
      start: empty, end: empty, peakObjects: 0, peakMatterBodies: 0,
    },
    expectedFrames,
    thresholds,
  );
}

export function runRobotTest(options: RobotTestOptions): Promise<RobotReport> {
  const gameMs = options.gameMs ?? 6000;
  const seed = options.seed ?? 1;
  const thresholds = options.thresholds ?? ROBOT_THRESHOLDS;
  const expectedFrames = Math.round(gameMs / (1000 / 60));
  const ownHost = options.host ? null : hiddenHost();
  const host = options.host ?? (ownHost as HTMLElement);
  const frame = options.frame ?? new PlayerFrame(host, { runtimeUrl: options.runtimeUrl, title: 'Robot test', hidden: true });
  frame.hide();
  const prefs: PlayerPrefs = { ...DEFAULT_PREFS, muted: true, errorPanel: false, touch: 'off', quality: 1 };
  const b = options.bundle;
  const init: InitMessage = {
    type: 'init',
    mode: 'robot',
    files: b.files,
    art: b.art ?? [],
    sounds: b.sounds ?? [],
    fonts: b.fonts ?? [],
    dials: b.dials ?? {},
    twists: b.twists ?? [],
    storage: { ...b.storage },
    prefs,
    autostart: true,
    robot: { gameMs, seed, bot: options.bot ?? 'auto' },
  };

  const limits: RobotLimits = { ...ROBOT_LIMITS, ceilingMs: options.timeoutMs ?? ROBOT_LIMITS.ceilingMs };
  const why = (stop: RobotStop, stallMs: number): string => {
    const secs = (ms: number) => Math.round(ms / 1000);
    if (stop === 'start') return 'The game froze before it started playing (a loop that never ends in create()?).';
    if (stop === 'stall') return `The game froze: no frame finished for ${secs(stallMs)} seconds (a loop that never ends?).`;
    return `The game froze: ${secs(gameMs)} seconds of play took longer than ${secs(limits.ceilingMs)} seconds.`;
  };

  return new Promise<RobotReport>((resolve) => {
    let bootTimer = 0;
    let watchTimer = 0;
    let watch: RobotWatch | null = null;
    const earlyErrors: PlayerError[] = [];
    const played = (): Played => (watch ? watch.played(performance.now()) : { frames: 0, wallMs: 0 });
    const finish = (report: RobotReport): void => {
      window.clearTimeout(bootTimer);
      window.clearInterval(watchTimer);
      frame.destroy();
      ownHost?.remove();
      resolve(report);
    };
    // After the boot the run is judged by its progress (the runtime reports the frames it has stepped), so a
    // slow machine may take its time; a run whose frames stop finishing is frozen.
    const startWatch = (): void => {
      watch = new RobotWatch(performance.now(), limits);
      window.clearInterval(watchTimer);
      watchTimer = window.setInterval(() => {
        const stop = watch?.check(performance.now());
        if (stop) finish(frozenReport(why(stop, watch?.stallLimit() ?? limits.stallMs), expectedFrames, played(), thresholds, earlyErrors));
      }, 250);
    };
    bootTimer = window.setTimeout(() => finish(frozenReport('The game did not start.', expectedFrames, played(), thresholds, earlyErrors)), BOOT_LIMIT_MS);
    frame.setEvents({
      message: (msg: FromPlayer) => {
        if (msg.type === 'booted') {
          window.clearTimeout(bootTimer);
          startWatch();
        } else if (msg.type === 'stats') {
          watch?.progress(msg.stats.frames, performance.now());
        } else if (msg.type === 'error' && earlyErrors.length < 20) {
          earlyErrors.push(msg.error);
        } else if (msg.type === 'robotResult') {
          const raw = msg.raw;
          for (const e of earlyErrors) if (!raw.errors.some((x) => x.message === e.message && x.line === e.line)) raw.errors.push(e);
          finish(judgeRobot(raw, expectedFrames, thresholds));
        }
      },
      failed: (message) => finish(frozenReport(message, expectedFrames, played(), thresholds, earlyErrors)),
      navigated: () => finish(frozenReport("The game tried to open a web page. Games can't do that.", expectedFrames, played(), thresholds)),
    });
    frame.send(init);
  });
}
