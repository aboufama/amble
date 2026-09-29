/**
 * The runtime inside the sandboxed game iframe, bundled after Phaser by vite/ambleRuntime.ts. It hardens
 * the realm, installs the kit, answers the editor over its MessagePort, runs the student's files as blob:
 * scripts (so errors point at their own file and line), and keeps the game safe (errors, endless loops,
 * flashes, WebGL contexts) and measured (stats, the robot test).
 */
import Phaser from 'phaser';
import { DEFAULT_PREFS, PROTOCOL_VERSION, type Action, type DrawnArt, type FontAsset, type FromPlayer, type GameState, type InitMessage, type PlayerPrefs, type RobotOptions, type RuntimeStats, type SoundAsset, type ToPlayer } from '../../play/protocol';
import { registryFor } from '../kit/art';
import { buildManifest, configureGame, counters, gameTexturesReady, restartLevel, scheduleManifest } from '../kit/boot';
import { DialRegistry } from '../kit/dials';
import type { KitEnv, VirtualInput } from '../kit/env';
import { installKit } from '../kit/index';
import { currentScene } from '../kit/scene';
import { quality } from '../kit/state';
import { countGame } from '../kit/stats';
import { isTwistId } from '../kit/twistCatalog';
import { setTwist } from '../kit/twists';
import { seeded } from '../kit/util';
import { DrawnStore } from './assets';
import { AudioHub } from './audio';
import { now, useManualClock } from './clock';
import { countDrawCalls, drawCallsFrameDone, drawCallsLastFrame } from './drawCalls';
import { ErrorReporter } from './errors';
import { FlashLimiter, flashPolicy } from './flash';
import { GhostTaps } from './ghosts';
import { harden } from './harden';
import { KeyInjector } from './keys';
import { createLink } from './link';
import { hideErrorPanel, hideSoundChip, showSoundChip } from './overlay';
import { currentGame, patchPhaser, renderOnly, retire } from './patches';
import { runRobot, type RobotRecorder } from './robot';
import { sourceUrlFor } from './stack';
import { readStandalone, showPlayCard } from './standalone';
import { createStorage, installStorage } from './storage';
import { TouchOverlay } from './touch';

const embedded = readStandalone();
const link = createLink(!!embedded);

// ---------------------------------------------------------------- state of this realm

let mode: 'play' | 'robot' = 'play';
let state: GameState = 'loading';
let initStarted = false;
let started = false;
let ready = false;
let editorPaused = false;
let firstFrame = false;
let robot: RobotOptions | null = null;
let swaps = 0;
let frameMs = 0;
const queued: ToPlayer[] = [];
const recorder: RobotRecorder = { events: [], warnings: [], artMissing: [] };

function post(msg: FromPlayer): void {
  if (msg.type === 'state') {
    if (msg.state === state) return;
    state = msg.state;
  }
  if (mode === 'robot') {
    if (msg.type === 'event' && recorder.events.length < 200) recorder.events.push(msg.event);
    else if (msg.type === 'warn' && recorder.warnings.length < 50) recorder.warnings.push(msg.message);
    else if (msg.type === 'artMissing') recorder.artMissing.push(msg.need.key);
  }
  link.post(msg);
}

harden((message) => post({ type: 'warn', message }));

const errors = new ErrorReporter({ post });
errors.captureGlobal();
errors.forwardConsole();
errors.setCrashHandler(() => post({ type: 'state', state: 'crashed' }));

const audio = new AudioHub((s) => {
  post({ type: 'audio', state: s });
  if (s === 'running') hideSoundChip();
});
const flash = new FlashLimiter(flashPolicy(false));
const keys = new KeyInjector();
const input: VirtualInput = { actions: {}, stick: null };
const touch = new TouchOverlay(input);

const env: KitEnv = {
  mode: 'play',
  standalone: !!embedded,
  autostart: false,
  prefs: { ...DEFAULT_PREFS },
  now,
  post,
  report: (err, phase, o) => errors.report(err, phase, { crash: o?.crash, twist: o?.twist }),
  crashed: () => errors.crashed,
  recover: () => {
    errors.recover();
    hideErrorPanel();
  },
  drawn: new DrawnStore(),
  sounds: new Map(),
  flash,
  audio,
  storage: createStorage({}, null),
  dials: new DialRegistry(),
  twistsOn: new Set(),
  input,
  touchActions: (actions: Action[], labels) => touch.setActions(actions, labels),
  paused: () => editorPaused,
  drawCalls: drawCallsLastFrame,
};
installKit(env);

const ghosts = new GhostTaps(post, currentGame, () => env.prefs.ghostTaps && !env.standalone);

// ---------------------------------------------------------------- Phaser

function gpuName(game: Phaser.Game): { renderer: 'webgl' | 'canvas'; gpu: string; maxTexture: number } {
  const r = game.renderer;
  if (!(r instanceof Phaser.Renderer.WebGL.WebGLRenderer)) return { renderer: 'canvas', gpu: '', maxTexture: 4096 };
  const gl = r.gl;
  const info = gl.getExtension('WEBGL_debug_renderer_info');
  const gpu = String(info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)).slice(0, 200);
  return { renderer: 'webgl', gpu, maxTexture: Number(gl.getParameter(gl.MAX_TEXTURE_SIZE)) || 4096 };
}

function applyQuality(gpu: string): void {
  const q = env.prefs.quality;
  if (q !== 'auto') {
    quality.level = q;
    quality.cap = q;
    return;
  }
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 4;
  const software = /swiftshader|llvmpipe|software/i.test(gpu);
  quality.cap = memory >= 8 && !software && gpu !== '' ? 2 : 1;
  quality.level = 1;
}

function applySound(game: Phaser.Game): void {
  const sm = game.sound;
  sm.mute = env.prefs.muted || mode === 'robot';
  sm.volume = env.prefs.volume;
}

function whenBooted(game: Phaser.Game, fn: () => void): void {
  if (game.isBooted) fn();
  else game.events.once(Phaser.Core.Events.BOOT, fn);
}

function gameCreated(game: Phaser.Game): void {
  firstFrame = false;
  whenBooted(game, () => {
    const info = gpuName(game);
    applyQuality(info.gpu);
    applySound(game);
    const r = game.renderer;
    if (r instanceof Phaser.Renderer.WebGL.WebGLRenderer) countDrawCalls(r.gl);
    post({ type: 'booted', ...info });
  });
  if (mode === 'robot' && robot) {
    const options = robot;
    // READY fires just before Phaser starts its loop: take over right after, in the same task.
    game.events.once(Phaser.Core.Events.READY, () => queueMicrotask(() => void startRobot(game, options)));
  }
}

function gameStepped(game: Phaser.Game, ms: number): void {
  keys.frameDone();
  drawCallsFrameDone();
  frameMs = frameMs ? frameMs * 0.9 + ms * 0.1 : ms;
  if (!firstFrame) {
    firstFrame = true;
    post({ type: 'firstFrame' });
    // Kit games report title/running themselves; a plain Phaser game is simply running.
    if (!currentScene() && !errors.crashed && !editorPaused) post({ type: 'state', state: 'running' });
    if (mode === 'play' && !env.standalone) {
      window.setTimeout(() => {
        if (audio.state === 'suspended' && !env.prefs.muted && currentGame() === game) showSoundChip(() => audio.unlock());
      }, 1500);
    }
  }
}

patchPhaser({
  report: (err, phase) => errors.report(err, phase),
  crashed: () => errors.crashed,
  configure: (config) => {
    configureGame(config);
    config.audio = audio.ctx ? { context: audio.ctx } : { noAudio: true };
    if (robot) config.seed = [String(robot.seed)];
  },
  texturesReady: gameTexturesReady,
  created: gameCreated,
  stepped: gameStepped,
  flash,
});

// ---------------------------------------------------------------- stats

function kitState(): GameState {
  if (errors.crashed) return 'crashed';
  const k = currentScene()?.__kit;
  if (!k) return currentGame() ? 'running' : 'loading';
  if (k.state === 'title') return 'title';
  if (k.state === 'won') return 'won';
  if (k.state === 'lost') return 'lost';
  return k.paused ? 'paused' : 'running';
}

function collectStats(): RuntimeStats {
  const game = currentGame();
  const c = game ? countGame(game) : { objects: 0, particles: 0, arcadeBodies: 0, matterBodies: 0, shots: 0, tweens: 0, textureMB: 0 };
  const memory = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
  return {
    fps: game ? Math.round(game.loop.actualFps) : 0,
    frameMs: Math.round(frameMs * 10) / 10,
    frames: game?.loop.frame ?? 0,
    ...c,
    drawCalls: drawCallsLastFrame(),
    heapMB: memory ? Math.round(memory.usedJSHeapSize / 1048576) : null,
    quality: quality.level,
    timeScale: Math.round((currentScene()?.__kit?.appliedScale ?? 1) * 100) / 100,
    state,
    audio: audio.state,
    errors: errors.errors.length,
  };
}

window.setInterval(() => {
  if (started && mode === 'play' && !env.standalone) post({ type: 'stats', stats: collectStats() });
}, 1000);

// ---------------------------------------------------------------- the robot test

async function startRobot(game: Phaser.Game, options: RobotOptions): Promise<void> {
  const raw = await runRobot({ game, options, input, keys, errors, recorder, stats: collectStats, state: () => state });
  post({ type: 'robotResult', raw });
}

/** The game never started (a broken file): report at once instead of letting the editor wait. */
function robotFailedEarly(): void {
  const s = collectStats();
  post({
    type: 'robotResult',
    raw: {
      gameMs: 0, frames: 0, wallMs: 0, speed: 0, errors: errors.errors.slice(0, 50), warnings: recorder.warnings, events: recorder.events,
      artMissing: [...new Set(recorder.artMissing)], state: 'crashed', hero: { found: false, controlled: false, moved: 0, alive: false },
      movers: 0, frameDiff: 0, lumaVariance: 0, start: s, end: s, peakObjects: 0, peakMatterBodies: 0,
    },
  });
}

// ---------------------------------------------------------------- loading a game

function runScript(url: string): Promise<void> {
  return new Promise((resolve) => {
    const s = document.createElement('script');
    s.async = false;
    s.src = url;
    s.onload = () => resolve();
    s.onerror = () => resolve();
    document.head.append(s);
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function loadFonts(fonts: FontAsset[]): Promise<void> {
  const jobs = fonts.map(async (f) => {
    try {
      const face = new FontFace(f.family, f.bytes, { weight: String(f.weight ?? 400) });
      await face.load();
      document.fonts.add(face);
    } catch {
      post({ type: 'warn', message: `The font ${f.family} could not load.` });
    }
  });
  await Promise.race([Promise.all(jobs), delay(1500)]);
}

async function loadArt(list: DrawnArt[]): Promise<void> {
  await Promise.all(
    list.map(async (a) => {
      try {
        env.drawn.set(await env.drawn.decode(a));
      } catch {
        post({ type: 'warn', message: `The drawing for ${a.key} could not load.` });
      }
    }),
  );
}

async function loadSounds(list: SoundAsset[]): Promise<void> {
  await Promise.all(
    list.map(async (s) => {
      try {
        const buf = await audio.decode(s);
        if (buf) env.sounds.set(s.key, buf);
      } catch {
        post({ type: 'warn', message: `The sound ${s.key} could not load.` });
      }
    }),
  );
}

function applyPrefs(prefs: PlayerPrefs): void {
  env.prefs = mode === 'robot' ? { ...prefs, muted: true, touch: 'off', errorPanel: false } : prefs;
  flash.setPolicy(flashPolicy(env.prefs.reducedMotion));
  errors.showPanel = env.prefs.errorPanel;
  touch.setMode(env.prefs.touch);
  const q = env.prefs.quality;
  if (q !== 'auto') {
    quality.level = q;
    quality.cap = q;
  }
  const game = currentGame();
  if (game) applySound(game);
}

async function init(msg: InitMessage): Promise<void> {
  mode = msg.mode;
  env.mode = msg.mode;
  env.autostart = msg.autostart || msg.mode === 'robot';
  if (msg.mode === 'robot' && msg.robot) {
    robot = msg.robot;
    useManualClock(0);
    Math.random = seeded(msg.robot.seed);
  }
  applyPrefs(msg.prefs);
  const local = createStorage(msg.storage, (data) => post({ type: 'storage', data }));
  installStorage(local, createStorage({}, null));
  env.storage = local;
  env.dials = new DialRegistry(msg.dials);
  env.twistsOn = new Set(msg.twists.filter(isTwistId));
  await Promise.all([loadFonts(msg.fonts), loadArt(msg.art), loadSounds(msg.sounds)]);
  errors.globalPhase = 'load';
  for (const f of msg.files) {
    const url = URL.createObjectURL(new Blob([`${f.source}\n//# sourceURL=${sourceUrlFor(f.name)}\n`], { type: 'text/javascript' }));
    errors.scripts.add(f.name, url);
    await runScript(url);
  }
  if (!errors.crashed) {
    const start = URL.createObjectURL(new Blob(["Amble.__start(typeof Game !== 'undefined' ? Game : undefined);"], { type: 'text/javascript' }));
    await runScript(start);
  }
  errors.globalPhase = 'uncaught';
  started = true;
  if (!currentGame()) {
    post({ type: 'state', state: 'crashed' });
    if (mode === 'robot') robotFailedEarly();
  }
  scheduleManifest();
  ready = true;
  for (const m of queued.splice(0)) handle(m);
}

// ---------------------------------------------------------------- live changes

let swapChain: Promise<void> = Promise.resolve();

function swapArt(art: DrawnArt | { key: string; clear: true }): void {
  swapChain = swapChain.then(async () => {
    if ('clear' in art) env.drawn.delete(art.key);
    else {
      try {
        env.drawn.set(await env.drawn.decode(art));
      } catch {
        post({ type: 'warn', message: `The drawing for ${art.key} could not load.` });
        return;
      }
    }
    const game = currentGame();
    const reg = game ? registryFor(game) : undefined;
    const t0 = performance.now();
    let objects = 0;
    try {
      objects = reg ? reg.refresh(art.key) : 0;
    } catch (err) {
      errors.report(err, 'callback', { crash: false });
    }
    const ms = Math.round((performance.now() - t0) * 10) / 10;
    swaps++;
    post({ type: 'swapped', key: art.key, objects, ms });
    if (editorPaused && game) renderOnly(game);
  });
}

let restartTimer = 0;

function setDial(key: string, value: number): void {
  const change = env.dials.set(key, value);
  scheduleManifest();
  if (!change?.restart) return;
  window.clearTimeout(restartTimer);
  restartTimer = window.setTimeout(() => restartLevel(), 150);
}

function pauseGame(): void {
  if (editorPaused) return;
  editorPaused = true;
  keys.releaseAll();
  touch.release();
  audio.hold(true);
  const game = currentGame();
  if (game && mode === 'play') {
    ghosts.setPaused(true);
    renderOnly(game);
    game.loop.sleep();
  }
  post({ type: 'state', state: 'paused' });
}

function resumeGame(): void {
  if (!editorPaused) return;
  editorPaused = false;
  audio.hold(false);
  const game = currentGame();
  if (game && mode === 'play') {
    ghosts.setPaused(false);
    game.loop.wake();
  }
  post({ type: 'state', state: kitState() });
}

function dispose(): void {
  const game = currentGame();
  if (game) retire(game);
  void audio.ctx?.close().catch(() => undefined);
}

function handle(msg: ToPlayer): void {
  switch (msg.type) {
    case 'art':
      swapArt(msg.art);
      break;
    case 'clearArt':
      swapArt({ key: msg.key, clear: true });
      break;
    case 'dial':
      setDial(msg.key, msg.value);
      break;
    case 'twist':
      setTwist(currentScene(), msg.id, msg.on);
      scheduleManifest();
      break;
    case 'prefs':
      applyPrefs({ ...env.prefs, ...msg.prefs });
      break;
    case 'pause':
      pauseGame();
      break;
    case 'resume':
      resumeGame();
      break;
    case 'restartLevel':
      restartLevel();
      resumeGame();
      post({ type: 'state', state: kitState() });
      break;
    case 'key':
      if (msg.phase === 'down') keys.down(msg.key, msg.code, msg.keyCode || undefined);
      else keys.up(msg.code);
      break;
    case 'releaseKeys':
      keys.releaseAll();
      touch.release();
      break;
    case 'unlockAudio':
      audio.unlock();
      break;
    default:
      break;
  }
}

link.onMessage((msg) => {
  if (msg.type === 'dispose') {
    dispose();
    return;
  }
  if (msg.type === 'init') {
    if (initStarted) return;
    initStarted = true;
    void init(msg).catch((err: unknown) => errors.report(err, 'load'));
    return;
  }
  if (!ready) {
    if (queued.length < 200) queued.push(msg);
    return;
  }
  handle(msg);
});

window.addEventListener(
  'keydown',
  (e) => {
    if (e.key === 'Escape') post({ type: 'escape' });
  },
  { capture: true },
);

// ---------------------------------------------------------------- the test hook

Object.defineProperty(window, '__ambleGame', {
  configurable: false,
  value: Object.freeze({
    get state() {
      return state;
    },
    get scene() {
      return currentScene();
    },
    get game() {
      return currentGame();
    },
    find: findByKey,
    all: (group: string) => currentScene()?.all(group) ?? [],
    stats: collectStats,
    manifest: buildManifest,
    get errors() {
      return errors.errors;
    },
    get swaps() {
      return swaps;
    },
    get createCount() {
      return counters.creates;
    },
    dial: (name: string) => env.dials.values()[name],
    twists: () => [...env.twistsOn],
    prefs: () => ({ ...env.prefs }),
  }),
});

/** The first live thing showing an art key (a kit character or sprite, or a plain image). */
function findByKey(key: string): Phaser.GameObjects.GameObject | null {
  const game = currentGame();
  if (!game) return null;
  for (const scene of game.scene.getScenes(true)) {
    for (const o of scene.children.list) {
      const k = (o as { key?: unknown }).key;
      const tex = (o as { texture?: Phaser.Textures.Texture }).texture?.key;
      if (o.active && (k === key || tex === key || tex === key + '~hd')) return o;
    }
  }
  return null;
}

// ---------------------------------------------------------------- go

if (embedded) {
  showPlayCard(embedded.title, () => {
    audio.unlock();
    link.inject(embedded.init);
  });
} else {
  post({ type: 'hello', protocol: PROTOCOL_VERSION, phaser: Phaser.VERSION });
}
