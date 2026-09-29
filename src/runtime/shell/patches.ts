/**
 * The Phaser patches that make it safe to embed (all verified in the Phaser probe):
 * - `Game.prototype.step` in try/catch: one throw otherwise ends the requestAnimationFrame loop for good.
 *   After a crash the game keeps rendering (so the panel and the last picture stay) but stops simulating.
 * - `SceneManager.bootScene/create` in try/catch: an error in the first create() otherwise aborts
 *   game.start() and leaves a black screen.
 * - `Phaser.Game` merges safe defaults into any config (FIT 960x540 in #amble-game, autoFocus off, the
 *   shared AudioContext, 3 pointers, gamepad) and retires the previous game with WEBGL_lose_context
 *   (without it, restarts run out of WebGL contexts). input.windowEvents is never turned off: Phaser then
 *   fails to tear down cross-origin window listeners and leaks the whole game.
 * - Tweens run on the scene's step delta instead of Date.now, so there is one game clock: hit-stop,
 *   slow-mo and the robot test's manual clock reach tweens too.
 * - Camera flashes and big background-colour jumps go through the flash limiter.
 */
import Phaser from 'phaser';
import type { ErrorPhase } from '../../play/protocol';
import { now } from './clock';
import { FlashLimiter, isStrobeJump, mixColor, safeFlashAlpha } from './flash';
import { loopFrameStart } from './loopGuard';

export interface GameHooks {
  report(err: unknown, phase: ErrorPhase): void;
  crashed(): boolean;
  /** Adds the runtime's settings to a game config (audio context, seed, renderer...). */
  configure(config: Phaser.Types.Core.GameConfig): void;
  /** Textures are ready and the first scene has not booted yet: install art, sounds... */
  texturesReady(game: Phaser.Game): void;
  created(game: Phaser.Game): void;
  /** After every frame (simulated or not), with how long it took in ms. */
  stepped(game: Phaser.Game, ms: number): void;
  flash: FlashLimiter;
}

type GameConfig = Phaser.Types.Core.GameConfig;

/** Phaser sets this when destroy() was called; its type definitions leave it out. */
export function isDestroyed(game: Phaser.Game): boolean {
  return (game as Phaser.Game & { pendingDestroy?: boolean }).pendingDestroy === true;
}

export const GAME_WIDTH = 960;
export const GAME_HEIGHT = 540;
export const GAME_PARENT = 'amble-game';

/** Draws the current state without simulating (used after a crash and while paused). */
export function renderOnly(game: Phaser.Game): void {
  const r = game.renderer;
  if (!r || isDestroyed(game)) return;
  r.preRender();
  game.scene.render(r);
  r.postRender();
}

export function loseContext(game: Phaser.Game): void {
  const r = game.renderer;
  const gl = r instanceof Phaser.Renderer.WebGL.WebGLRenderer ? r.gl : null;
  gl?.getExtension('WEBGL_lose_context')?.loseContext();
}

function patchStep(hooks: GameHooks): void {
  const proto = Phaser.Game.prototype;
  const realStep = proto.step;
  proto.step = function (this: Phaser.Game, time: number, delta: number) {
    const started = performance.now();
    loopFrameStart();
    if (hooks.crashed()) renderOnly(this);
    else {
      try {
        realStep.call(this, time, delta);
      } catch (err) {
        hooks.report(err, 'frame');
      }
    }
    hooks.stepped(this, performance.now() - started);
  };
}

function patchSceneBoot(hooks: GameHooks): void {
  const proto = Phaser.Scenes.SceneManager.prototype as unknown as Record<'bootScene' | 'create', (...args: unknown[]) => unknown>;
  for (const name of ['bootScene', 'create'] as const) {
    const real = proto[name];
    proto[name] = function (this: unknown, ...args: unknown[]) {
      loopFrameStart();
      try {
        return real.apply(this, args);
      } catch (err) {
        hooks.report(err, name === 'create' ? 'create' : 'boot');
        return undefined;
      }
    };
  }
}

interface TweenManagerClock {
  paused: boolean;
  __ambleDelta?: number;
  step(tick?: boolean): void;
  getDelta(tick?: boolean): number;
  update(time?: number, delta?: number): void;
}

function patchTweens(): void {
  const proto = Phaser.Tweens.TweenManager.prototype as unknown as TweenManagerClock;
  proto.update = function (this: TweenManagerClock, _time?: number, delta?: number) {
    if (this.paused) return;
    this.__ambleDelta = typeof delta === 'number' && delta > 0 ? delta : 0;
    this.step(true);
  };
  proto.getDelta = function (this: TweenManagerClock) {
    const d = this.__ambleDelta ?? 0;
    this.__ambleDelta = 0;
    return d;
  };
}

interface FlashEffect {
  alpha: number;
  start(duration?: number, red?: number, green?: number, blue?: number, force?: boolean, ...rest: unknown[]): Phaser.Cameras.Scene2D.Camera;
  camera: Phaser.Cameras.Scene2D.Camera;
}

function patchFlashes(limiter: FlashLimiter): void {
  const flash = Phaser.Cameras.Scene2D.Effects.Flash.prototype as unknown as FlashEffect;
  const realStart = flash.start;
  flash.start = function (this: FlashEffect, duration = 250, red = 255, green = 255, blue = 255, force = false, ...rest: unknown[]) {
    const color = ((red & 255) << 16) | ((green & 255) << 8) | (blue & 255);
    if (!limiter.allow(now())) return this.camera;
    const asked = this.alpha;
    this.alpha = safeFlashAlpha(asked, color, { maxPerSecond: 3, maxAlpha: limiter.maxAlpha });
    const cam = realStart.call(this, duration, red, green, blue, force, ...rest);
    this.alpha = asked;
    return cam;
  };

  type CameraBg = Phaser.Cameras.Scene2D.BaseCamera & { __ambleBg?: number };
  const cam = Phaser.Cameras.Scene2D.BaseCamera.prototype as unknown as { setBackgroundColor(this: CameraBg, color?: unknown): CameraBg };
  const realBg = cam.setBackgroundColor;
  cam.setBackgroundColor = function (this: CameraBg, color?: unknown) {
    const out = realBg.call(this, color);
    const next = this.backgroundColor.color & 0xffffff;
    const prev = this.__ambleBg;
    if (prev !== undefined && this.backgroundColor.alpha > 0 && isStrobeJump(prev, next) && !limiter.allow(now())) {
      const soft = mixColor(prev, next, 0.2);
      realBg.call(this, soft);
      this.__ambleBg = soft;
      return out;
    }
    this.__ambleBg = next;
    return out;
  };
}

/** Merges the runtime's safe defaults into a game's config. */
export function withDefaults(input: GameConfig | undefined, hooks: GameHooks): GameConfig {
  const config: GameConfig = { ...input };
  const scale: Phaser.Types.Core.ScaleConfig = { ...config.scale };
  if (scale.width === undefined && config.width === undefined) scale.width = GAME_WIDTH;
  if (scale.height === undefined && config.height === undefined) scale.height = GAME_HEIGHT;
  scale.parent = GAME_PARENT;
  scale.mode = Phaser.Scale.FIT;
  scale.autoCenter = Phaser.Scale.CENTER_BOTH;
  config.scale = scale;
  config.parent = GAME_PARENT;
  // Never steal focus from the editor: the editor focuses the iframe on Play.
  config.autoFocus = false;
  config.banner = false;
  config.disableContextMenu = true;
  config.input = { activePointers: 3, gamepad: true, ...(typeof config.input === 'object' ? config.input : {}) };
  // Keep input.windowEvents at its default: Phaser then tries window.top, fails (cross-origin) and remembers
  // isTop=false. With windowEvents:false, destroy() throws on window.top and leaks the game and its context.
  if (config.input && 'windowEvents' in config.input) delete config.input.windowEvents;
  config.render = { powerPreference: 'default', ...config.render };
  config.fps = { target: 60, ...config.fps };
  const user = config.callbacks ?? {};
  config.callbacks = {
    preBoot: (game: Phaser.Game) => {
      // Registered before Phaser's own listener, so art exists before the first scene's preload/create.
      game.textures.once(Phaser.Textures.Events.READY, () => hooks.texturesReady(game));
      user.preBoot?.(game);
    },
    postBoot: (game: Phaser.Game) => user.postBoot?.(game),
  };
  hooks.configure(config);
  return config;
}

let current: Phaser.Game | null = null;

export function currentGame(): Phaser.Game | null {
  return current && !isDestroyed(current) ? current : null;
}

/** Destroys a game and loses its WebGL context once Phaser has finished tearing down. */
export function retire(game: Phaser.Game): void {
  game.events.once(Phaser.Core.Events.DESTROY, () => setTimeout(() => loseContext(game), 0));
  game.destroy(true);
}

function patchGameConstructor(hooks: GameHooks): void {
  const RealGame = Phaser.Game;
  function AmbleGame(config?: GameConfig): Phaser.Game {
    if (current && !isDestroyed(current)) retire(current);
    const game = new RealGame(withDefaults(config, hooks));
    current = game;
    hooks.created(game);
    return game;
  }
  AmbleGame.prototype = RealGame.prototype;
  (Phaser as unknown as { Game: unknown }).Game = AmbleGame;
}

export function patchPhaser(hooks: GameHooks): void {
  patchStep(hooks);
  patchSceneBoot(hooks);
  patchTweens();
  patchFlashes(hooks.flash);
  patchGameConstructor(hooks);
}
