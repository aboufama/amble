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

export interface RobotTestOptions {
  runtimeUrl: string;
  bundle: GameBundle;
  /** Game time to simulate (default 6000 ms). */
  gameMs?: number;
  /** Seeds Math.random and Phaser's RNG (default 1). */
  seed?: number;
  /** 'auto' (default) drives the hero; 'none' only watches. */
  bot?: 'auto' | 'none';
  /** Wall-clock limit after the game booted; past it the game counts as frozen (default 10 s). */
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

function frozenReport(message: string, expectedFrames: number, gameMs: number, thresholds: RobotThresholds, earlier: PlayerError[] = []): RobotReport {
  const error: PlayerError = { phase: 'frozen', message, count: 1, fatal: true };
  const empty = {
    fps: 0, frameMs: 0, frames: 0, objects: 0, particles: 0, arcadeBodies: 0, matterBodies: 0, shots: 0, tweens: 0, drawCalls: 0,
    textureMB: 0, heapMB: null, quality: 1 as const, timeScale: 1, state: 'crashed' as const, audio: 'none' as const, errors: 1,
  };
  return judgeRobot(
    {
      gameMs, frames: 0, wallMs: 0, speed: 0, errors: [...earlier, error], warnings: [], events: [], artMissing: [], state: 'crashed',
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

  return new Promise<RobotReport>((resolve) => {
    let bootTimer = 0;
    let runTimer = 0;
    const earlyErrors: PlayerError[] = [];
    const finish = (report: RobotReport): void => {
      window.clearTimeout(bootTimer);
      window.clearTimeout(runTimer);
      frame.destroy();
      ownHost?.remove();
      resolve(report);
    };
    const armRunTimer = (): void => {
      window.clearTimeout(runTimer);
      runTimer = window.setTimeout(
        () => {
          const limit = Math.round((options.timeoutMs ?? 10_000) / 1000);
          const message = `The game froze: ${Math.round(gameMs / 1000)} seconds of play took longer than ${limit} seconds.`;
          finish(frozenReport(message, expectedFrames, gameMs, thresholds, earlyErrors));
        },
        options.timeoutMs ?? 10_000,
      );
    };
    bootTimer = window.setTimeout(() => finish(frozenReport('The game did not start.', expectedFrames, gameMs, thresholds, earlyErrors)), BOOT_LIMIT_MS);
    frame.setEvents({
      message: (msg: FromPlayer) => {
        if (msg.type === 'booted') {
          window.clearTimeout(bootTimer);
          armRunTimer();
        } else if (msg.type === 'error' && earlyErrors.length < 20) {
          earlyErrors.push(msg.error);
        } else if (msg.type === 'robotResult') {
          const raw = msg.raw;
          for (const e of earlyErrors) if (!raw.errors.some((x) => x.message === e.message && x.line === e.line)) raw.errors.push(e);
          finish(judgeRobot(raw, expectedFrames, thresholds));
        }
      },
      failed: (message) => finish(frozenReport(message, expectedFrames, gameMs, thresholds, earlyErrors)),
      navigated: () => finish(frozenReport("The game tried to open a web page. Games can't do that.", expectedFrames, gameMs, thresholds)),
    });
    frame.send(init);
  });
}
