/**
 * The robot test, inside the runtime. requestAnimationFrame does not run in hidden or off-screen frames,
 * so the game is put to sleep and stepped by hand: `game.step(t, 1000 / 60)` in batches of 10 per macrotask,
 * on a manual clock that the kit's real-time effects follow too. The bot plays; the runner measures what
 * the judge needs (errors, frames, movement, a blank screen, runaway object counts) and reports it.
 * `speed` is game ms simulated per wall ms: a stepping speed, never a frame rate.
 */
import Phaser from 'phaser';
import type { GameEvent, GameState, RobotOptions, RobotRaw, RuntimeStats } from '../../play/protocol';
import type { VirtualInput } from '../kit/env';
import { currentScene } from '../kit/scene';
import { countGame } from '../kit/stats';
import type { Actor } from '../kit/types';
import { RobotBot } from './bot';
import { advanceManualClock } from './clock';
import { stepFrame } from './patches';
import type { ErrorReporter } from './errors';
import type { KeyInjector } from './keys';

const FRAME_MS = 1000 / 60;
const BATCH = 10;
const SAMPLE_W = 64;
const SAMPLE_H = 36;

export interface RobotRecorder {
  events: GameEvent[];
  warnings: string[];
  artMissing: string[];
}

export interface RobotContext {
  game: Phaser.Game;
  options: RobotOptions;
  input: VirtualInput;
  keys: KeyInjector;
  errors: ErrorReporter;
  recorder: RobotRecorder;
  stats(): RuntimeStats;
  state(): GameState;
  /**
   * Told the stats (with the frames stepped so far) when the run starts and then every `PROGRESS_MS` of
   * wall time, mid-batch too: the editor's watchdog judges the run by its progress, and when a frame never
   * ends, the last report says how far the game got.
   */
  progress?(stats: RuntimeStats): void;
}

/**
 * How often the run reports its progress (wall time). The editor takes at most 4 stats messages a second
 * from a player (src/play/limits.ts) and drops the rest, so more often would tell it less.
 */
const PROGRESS_MS = 300;

function yieldTask(): Promise<void> {
  return new Promise((resolve) => {
    const ch = new MessageChannel();
    ch.port1.onmessage = () => resolve();
    ch.port2.postMessage(0);
  });
}

/** A small grey picture of the canvas right after a frame was drawn (the drawing buffer is still there). */
function lumaSample(game: Phaser.Game): Float32Array | null {
  const c = document.createElement('canvas');
  c.width = SAMPLE_W;
  c.height = SAMPLE_H;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  try {
    ctx.drawImage(game.canvas, 0, 0, SAMPLE_W, SAMPLE_H);
    const px = ctx.getImageData(0, 0, SAMPLE_W, SAMPLE_H).data;
    const out = new Float32Array(SAMPLE_W * SAMPLE_H);
    for (let i = 0; i < out.length; i++) out[i] = 0.299 * px[i * 4] + 0.587 * px[i * 4 + 1] + 0.114 * px[i * 4 + 2];
    return out;
  } catch {
    return null;
  }
}

function variance(a: Float32Array): number {
  let sum = 0;
  for (const v of a) sum += v;
  const mean = sum / a.length;
  let sq = 0;
  for (const v of a) sq += (v - mean) * (v - mean);
  return sq / a.length;
}

function diff(a: Float32Array, b: Float32Array): number {
  let d = 0;
  for (let i = 0; i < a.length; i++) d += Math.abs(a[i] - b[i]);
  return d / a.length / 255;
}

type Positioned = Phaser.GameObjects.GameObject & { x: number; y: number };

function positions(game: Phaser.Game): Map<Positioned, { x: number; y: number }> {
  const out = new Map<Positioned, { x: number; y: number }>();
  const scene = currentScene() ?? game.scene.getScenes(true).at(-1);
  if (!scene) return out;
  for (const o of scene.children.list) {
    const p = o as Positioned;
    if (typeof p.x === 'number' && typeof p.y === 'number') out.set(p, { x: p.x, y: p.y });
  }
  return out;
}

function heroNow(): Actor | null {
  const h = currentScene()?.__kit?.hero;
  return h ?? null;
}

/** Plays the game on the manual clock and returns the measurements. */
export async function runRobot(ctx: RobotContext): Promise<RobotRaw> {
  const { game, options } = ctx;
  const wallStart = performance.now();
  const bot = options.bot === 'auto' ? new RobotBot(game, ctx.input, ctx.keys, options.seed) : null;
  game.loop.sleep();
  let t = 0;
  let frames = 0;
  // Filled by stepOne (a closure, so the compiler cannot follow plain `let`s).
  const first: { stats?: RuntimeStats; pos?: Map<Positioned, { x: number; y: number }>; luma?: Float32Array | null } = {};
  let peakObjects = 0;
  let peakMatter = 0;
  let heroStart: { x: number; y: number } | null = null;
  let heroMoved = 0;
  let heroFound = false;
  let heroControlled = false;
  const sampleAt = Math.min(30, Math.max(1, Math.floor(options.gameMs / FRAME_MS / 4)));
  const total = Math.max(1, Math.round(options.gameMs / FRAME_MS));
  let reportedAt = performance.now();
  ctx.progress?.(ctx.stats());
  const report = (): void => {
    const now = performance.now();
    if (!ctx.progress || now - reportedAt < PROGRESS_MS) return;
    reportedAt = now;
    ctx.progress(ctx.stats());
  };

  const stepOne = (render: boolean): void => {
    t += FRAME_MS;
    advanceManualClock(FRAME_MS);
    bot?.tick(t);
    // What TimeStep.step would have set (its typings mark `frame` read-only).
    const loop = game.loop as Phaser.Core.TimeStep & { frame: number };
    loop.time = t;
    loop.now = t;
    loop.delta = FRAME_MS;
    loop.rawDelta = FRAME_MS;
    loop.frame++;
    stepFrame(game, t, FRAME_MS, render);
    frames++;
    const h = heroNow();
    if (h) {
      if (!heroFound) {
        heroFound = true;
        heroStart = { x: h.x, y: h.y };
      }
      heroControlled ||= !!(h.ctl || h.topdownOpts || h.flyerOpts);
      if (heroStart && h.active) heroMoved = Math.max(heroMoved, Math.hypot(h.x - heroStart.x, h.y - heroStart.y));
    }
    if (frames === sampleAt) {
      first.stats = ctx.stats();
      first.pos = positions(game);
      first.luma = lumaSample(game);
    }
    if (frames % 10 === 0) {
      const c = countGame(game);
      peakObjects = Math.max(peakObjects, c.objects);
      peakMatter = Math.max(peakMatter, c.matterBodies);
    }
  };

  while (frames < total && !ctx.errors.crashed) {
    for (let i = 0; i < BATCH && frames < total && !ctx.errors.crashed; i++) {
      try {
        stepOne(frames + 1 === sampleAt);
      } catch (err) {
        ctx.errors.report(err, 'frame');
      }
      report();
    }
    await yieldTask();
  }
  // The last picture, drawn now so the sample reads a fresh drawing buffer.
  try {
    game.step(t, 0);
  } catch {
    /* already reported */
  }
  const lastLuma = lumaSample(game);
  bot?.stop();
  const endPos = positions(game);
  let movers = 0;
  if (first.pos) {
    for (const [o, p] of first.pos) {
      const q = endPos.get(o);
      if (q && o.active && Math.hypot(q.x - p.x, q.y - p.y) > 2) movers++;
    }
  }
  const end = ctx.stats();
  const c = countGame(game);
  peakObjects = Math.max(peakObjects, c.objects);
  peakMatter = Math.max(peakMatter, c.matterBodies);
  const wallMs = Math.max(1, performance.now() - wallStart);
  const hero = heroNow();
  const gameMs = Math.round(frames * FRAME_MS);
  return {
    gameMs,
    frames,
    wallMs: Math.round(wallMs),
    speed: Math.round((gameMs / wallMs) * 100) / 100,
    errors: ctx.errors.errors.slice(0, 50),
    warnings: ctx.recorder.warnings.slice(0, 20),
    events: ctx.recorder.events.slice(0, 50),
    artMissing: [...new Set(ctx.recorder.artMissing)].slice(0, 32),
    state: ctx.state(),
    hero: { found: heroFound, controlled: heroControlled, moved: Math.round(heroMoved), alive: !!hero && hero.active && hero.alive !== false },
    movers,
    frameDiff: first.luma && lastLuma ? Math.round(diff(first.luma, lastLuma) * 10000) / 10000 : 0,
    lumaVariance: lastLuma ? Math.round(variance(lastLuma) * 100) / 100 : 0,
    start: first.stats ?? end,
    end,
    peakObjects,
    peakMatterBodies: peakMatter,
  };
}
