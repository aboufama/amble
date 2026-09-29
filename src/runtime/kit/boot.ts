/**
 * Starting games and the kit's side of the runtime: `Amble.boot(Game)`, the Loader and texture hooks, the
 * manifest the editor reads (art, dials, twists, controls), level restarts and scene stats.
 */
import Phaser from 'phaser';
import { ACTIONS, type Action, type GameManifest } from '../../play/protocol';
import { currentGame } from '../shell/patches';
import { ArtRegistry, registryFor } from './art';
import { patchSoundManager, setGameSounds } from './audio';
import { cssColor } from './color';
import { env } from './env';
import { CHROMA_KEY, ChromaPipeline } from './fx';
import { AmbleScene, currentScene, setBootHooks, type BootHooks, type SceneClass } from './scene';
import { askOrder, toArtNeed } from './spec';
import { quality, type KitConfig } from './state';
import { countGame } from './stats';
import { TWISTS } from './twistCatalog';
import { twistAvailability } from './twists';
import { UiScene } from './ui';

type KitGameClass = typeof AmbleScene & SceneClass;

/** What the booted game class declared (read once, guarded: static getters can throw). */
interface Declared {
  cls: KitGameClass;
  cfg: KitConfig;
  art: unknown;
}

let declared: Declared | null = null;
let lastKitScene: AmbleScene | null = null;

/** For tests: how many times a kit level was built (restarts included). */
export const counters = { creates: 0 };

function safe<T>(fn: () => T): T | undefined {
  try {
    return fn();
  } catch (err) {
    env().report(err, 'boot');
    return undefined;
  }
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function finite(v: unknown, fallback: number, min: number, max: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.max(min, Math.min(max, v)) : fallback;
}

function text(v: unknown, max: number): string {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}

/** `static config` with defaults, whatever the game wrote. */
export function normalizeConfig(input: unknown): KitConfig {
  const o = isObj(input) ? input : {};
  const physics = o.physics === 'matter' || o.physics === 'none' ? o.physics : 'arcade';
  const controls: Partial<Record<Action, string>> = {};
  if (isObj(o.controls)) {
    for (const a of ACTIONS) {
      const label = text(o.controls[a], 12);
      if (label) controls[a] = label.toUpperCase();
    }
  }
  return {
    title: text(o.title, 60),
    subtitle: text(o.subtitle, 120),
    physics,
    gravity: finite(o.gravity, physics === 'matter' ? 1 : 0, -6000, 6000),
    background: cssColor(o.background ?? 0x141022),
    width: Math.round(finite(o.width, 960, 160, 1920)),
    height: Math.round(finite(o.height, 540, 120, 1080)),
    pixelArt: o.pixelArt === true,
    debug: o.debug === true,
    sleeping: o.sleeping !== false,
    damageNumbers: o.damageNumbers === true,
    controls,
    star: text(o.star, 64) || null,
  };
}

function physicsConfig(cfg: KitConfig): Phaser.Types.Core.PhysicsConfig | undefined {
  if (cfg.physics === 'matter') {
    return {
      default: 'matter',
      matter: { gravity: { x: 0, y: cfg.gravity }, enableSleeping: cfg.sleeping, debug: cfg.debug, positionIterations: 6, velocityIterations: 4, constraintIterations: 3 },
    };
  }
  if (cfg.physics === 'none') return undefined;
  return { default: 'arcade', arcade: { gravity: { x: 0, y: cfg.gravity }, debug: cfg.debug, tileBias: 32 } };
}

function isKitClass(v: unknown): v is KitGameClass {
  return typeof v === 'function' && (v === AmbleScene || v.prototype instanceof AmbleScene);
}

function declare(cls: KitGameClass): Declared {
  const cfg = normalizeConfig(safe(() => cls.config));
  cls.__ambleConfig = cfg;
  const d: Declared = { cls, cfg, art: safe(() => cls.art) };
  env().dials.declareAll(safe(() => cls.dials));
  setGameSounds(safe(() => cls.sounds));
  return d;
}

/** `Amble.boot(Game)`: starts a kit game (the runtime does it for `class Game` by itself). */
export function bootKitGame(GameClass: unknown): Phaser.Game | null {
  if (!isKitClass(GameClass)) {
    env().report(new TypeError('Amble.boot() needs a class that extends Amble.Scene.'), 'boot');
    return null;
  }
  declared = declare(GameClass);
  const cfg = declared.cfg;
  return new Phaser.Game({
    type: Phaser.AUTO,
    width: cfg.width,
    height: cfg.height,
    backgroundColor: cfg.background,
    pixelArt: cfg.pixelArt,
    physics: physicsConfig(cfg),
    scene: [UiScene, GameClass],
  });
}

/**
 * Every new Phaser.Game passes through here (from the shell) before it is built. A kit scene started by
 * the game's own `new Phaser.Game({ scene: Game })` gets the kit's physics, background and HUD scene too.
 */
export function configureGame(config: Phaser.Types.Core.GameConfig): void {
  const list: unknown[] = Array.isArray(config.scene) ? [...config.scene] : config.scene ? [config.scene] : [];
  const cls = list.find(isKitClass);
  if (!cls) {
    declared = null;
    return;
  }
  if (!declared || declared.cls !== cls) {
    declared = declare(cls);
    config.physics ??= physicsConfig(declared.cfg);
    config.backgroundColor ??= declared.cfg.background;
  }
  if (!list.includes(UiScene)) config.scene = [UiScene, ...list] as Phaser.Types.Core.GameConfig['scene'];
}

/**
 * Runs after the game's files: boots `class Game` unless the files started their own Phaser.Game.
 * A plain `class Game extends Phaser.Scene` runs as a plain Phaser game.
 */
export function startGame(candidate: unknown): void {
  if (currentGame()) {
    scheduleManifest();
    return;
  }
  if (isKitClass(candidate)) {
    bootKitGame(candidate);
    return;
  }
  if (typeof candidate === 'function' && candidate.prototype instanceof Phaser.Scene) {
    new Phaser.Game({ type: Phaser.AUTO, scene: candidate as typeof Phaser.Scene });
    return;
  }
  env().report(new Error('There is no game to run yet: game.js needs a `class Game extends Amble.Scene`.'), 'load');
}

/** Called by the shell when a game's textures are ready (before any scene): art, sounds, effects. */
export function gameTexturesReady(game: Phaser.Game): void {
  const reg = new ArtRegistry(game, declared?.art);
  reg.onChange = scheduleManifest;
  patchSoundManager(game);
  const r = game.renderer;
  if (r instanceof Phaser.Renderer.WebGL.WebGLRenderer) r.pipelines.addPostPipeline(CHROMA_KEY, ChromaPipeline);
}

// ---------------------------------------------------------------- the manifest

let manifestTimer = 0;

function controlsOf(cfg: KitConfig | null, used: Set<Action> | null): Action[] {
  const set = new Set<Action>();
  if (cfg) for (const a of Object.keys(cfg.controls) as Action[]) set.add(a);
  if (used) for (const a of used) set.add(a);
  return ACTIONS.filter((a) => set.has(a));
}

export function buildManifest(): GameManifest {
  const game = currentGame();
  const scene = currentScene();
  const reg = game ? registryFor(game) : undefined;
  const cfg = scene?.__kit?.cfg ?? declared?.cfg ?? null;
  const avail = twistAvailability(scene);
  const e = env();
  return {
    title: cfg?.title ?? '',
    subtitle: cfg?.subtitle ?? '',
    physics: declared ? declared.cfg.physics : 'phaser',
    kit: !!declared,
    art: reg ? reg.needs().sort(askOrder).map((s) => toArtNeed(s, { used: reg.isUsed(s.key), drawn: reg.isDrawn(s.key) })) : [],
    dials: e.dials.list(),
    twists: TWISTS.map((t) => ({ id: t.id, name: t.name, does: t.does, available: avail[t.id], on: e.twistsOn.has(t.id) })),
    controls: controlsOf(cfg, scene?.__kit?.actionsUsed ?? null),
  };
}

/** Sends the manifest soon (changes come in bursts: a level being built, a dial being turned). */
export function scheduleManifest(): void {
  if (manifestTimer) return;
  manifestTimer = window.setTimeout(() => {
    manifestTimer = 0;
    try {
      env().post({ type: 'manifest', manifest: buildManifest() });
    } catch (err) {
      env().report(err, 'boot', { crash: false });
    }
  }, 60);
}

// ---------------------------------------------------------------- level restarts

/** Restarts the running level in place (textures, dials and twists kept). */
export function restartLevel(): void {
  const e = env();
  e.recover();
  const scene = currentScene() ?? lastKitScene;
  if (scene?.sys?.game && !(scene.sys.game as Phaser.Game & { pendingDestroy?: boolean }).pendingDestroy) {
    scene.scene.restart();
    return;
  }
  const game = currentGame();
  if (!game) return;
  for (const s of game.scene.getScenes(true)) s.scene.restart();
}

// ---------------------------------------------------------------- hooks for Amble.Scene

let dialsView: { registry: unknown; view: Record<string, number> } | null = null;
let controlsTimer = 0;

function touchLabels(cfg: KitConfig | undefined): Partial<Record<Action, string>> {
  return cfg?.controls ?? {};
}

const hooks: BootHooks = {
  registry(game) {
    return registryFor(game) ?? new ArtRegistry(game, declared?.art);
  },
  defaultConfig() {
    return normalizeConfig(undefined);
  },
  autostart() {
    return env().autostart;
  },
  afterCreate(scene) {
    lastKitScene = scene;
    counters.creates++;
    scheduleManifest();
    hooks.controlsChanged();
    // Controls read during the first seconds of play decide the touch buttons: look again a little later.
    scene.time.delayedCall(2000, () => {
      scheduleManifest();
      hooks.controlsChanged();
    });
  },
  sceneShutdown() {
    // The scene object is reused when the level restarts, so there is nothing to forget.
  },
  dialsView() {
    const reg = env().dials;
    if (!dialsView || dialsView.registry !== reg) dialsView = { registry: reg, view: reg.view() };
    return dialsView.view;
  },
  dialsMaybeChanged() {
    if (env().dials.takeChanged()) scheduleManifest();
  },
  controlsChanged() {
    if (controlsTimer) return;
    controlsTimer = window.setTimeout(() => {
      controlsTimer = 0;
      const scene = currentScene();
      const k = scene?.__kit;
      env().touchActions(controlsOf(k?.cfg ?? null, k?.actionsUsed ?? null), touchLabels(k?.cfg));
    }, 50);
  },
  restartLevel,
  sceneStats(scene) {
    const k = scene.__kit;
    const c = countGame(scene.game);
    return {
      fps: Math.round(scene.game.loop.actualFps),
      objects: c.objects,
      particles: c.particles,
      arcadeBodies: c.arcadeBodies,
      matterBodies: c.matterBodies,
      activeShots: c.shots,
      tweens: c.tweens,
      drawCalls: env().drawCalls(),
      timeScale: k ? Math.round(k.appliedScale * 100) / 100 : 1,
      quality: quality.level,
      state: k ? (k.paused ? 'paused' : k.state) : 'running',
    };
  },
};

export function installBootHooks(): void {
  setBootHooks(hooks);
}
