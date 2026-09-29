/**
 * The runtime inside the sandboxed game iframe, bundled after Phaser by vite/ambleRuntime.ts. It hardens
 * the realm, installs the kit, answers the editor over its MessagePort, runs the student's files as blob:
 * scripts (so errors point at their own file and line), and keeps the game safe (errors, endless loops,
 * flashes, WebGL contexts) and measured (stats, the robot test).
 */
import Phaser from 'phaser';
import {
  DEFAULT_PREFS,
  PROTOCOL_VERSION,
  STANDALONE_DATA_ID,
  STANDALONE_START,
  type Action,
  type DrawnArt,
  type FromPlayer,
  type GameState,
  type InitMessage,
  type PlayerPrefs,
  type RobotOptions,
  type RuntimeStats,
  type ToPlayer,
} from '../../play/protocol';
import { registryFor } from '../kit/art';
import { configureGame, gameTexturesReady, restartLevel, scheduleManifest } from '../kit/boot';
import { DialRegistry } from '../kit/dials';
import type { KitEnv, VirtualInput } from '../kit/env';
import { installKit } from '../kit/index';
import { registerRiggedFactory } from '../kit/rigged';
import { createRiggedMesh } from '../../rig/phaser';
import { currentScene } from '../kit/scene';
import { quality } from '../kit/state';
import { worldObjects } from '../kit/objects';
import { countGame } from '../kit/stats';
import { isTwistId } from '../../play/kit/twistCatalog';
import { setTwist } from '../kit/twists';
import { seeded } from '../kit/util';
import { DrawnStore } from './assets';
import { AudioHub } from './audio';
import { now, useManualClock } from './clock';
import { applyQuality, rendererInfo } from './device';
import { countDrawCalls, drawCallsFrameDone, drawCallsLastFrame } from './drawCalls';
import { ErrorReporter } from './errors';
import { FlashLimiter, flashPolicy } from './flash';
import { GhostTaps } from './ghosts';
import { harden } from './harden';
import { KeyInjector } from './keys';
import { createLink } from './link';
import { loadArt, loadFonts, loadSounds, runFiles, runStart } from './load';
import { hideErrorPanel, hideSoundChip, showSoundChip } from './overlay';
import { editorHandler, type EditorShell } from './editor';
// The World screen's Change mode and friends register their handler (step 5 of the protocol).
import '../editor';
import { currentGame, patchPhaser, renderOnly, retire, stepFrame } from './patches';
import { runRobot, type RobotRecorder } from './robot';
import { createStorage, installStorage } from './storage';
import { installTestHook } from './testHook';
import { TouchOverlay } from './touch';

// An exported page carries its game; the standalone script that follows this runtime starts it.
const embedded = !!document.getElementById(STANDALONE_DATA_ID);
const link = createLink(embedded);

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
const input: VirtualInput = { actions: {}, taps: {}, stick: null };
const touch = new TouchOverlay(input);

/** Keys a touch control presses in a plain Phaser game (which reads the keyboard, not the kit's actions). */
const TOUCH_KEYS: Partial<Record<Action, { key: string; code: string }>> = {
  left: { key: 'ArrowLeft', code: 'ArrowLeft' },
  right: { key: 'ArrowRight', code: 'ArrowRight' },
  up: { key: 'ArrowUp', code: 'ArrowUp' },
  down: { key: 'ArrowDown', code: 'ArrowDown' },
  jump: { key: ' ', code: 'Space' },
  fire: { key: 'x', code: 'KeyX' },
};

function plainGameTouch(): void {
  touch.useKeys((action, down) => {
    const k = TOUCH_KEYS[action];
    if (!k) return;
    if (down) keys.down(k.key, k.code);
    else keys.up(k.code);
  });
  touch.setActions(['left', 'right', 'up', 'down', 'jump'], { jump: 'SPACE' });
}

const env: KitEnv = {
  mode: 'play',
  standalone: embedded,
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
// Drawn characters with bones play through the rig's Phaser mesh (cut-out parts and skinning).
registerRiggedFactory(createRiggedMesh);

const ghosts = new GhostTaps(post, currentGame, () => env.prefs.ghostTaps && !env.standalone);

// ---------------------------------------------------------------- Phaser

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
    const info = rendererInfo(game);
    applyQuality(env.prefs, info.gpu);
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
    // Kit games report title/running themselves; a plain Phaser game is simply running, and reads keys.
    if (!currentScene()) {
      plainGameTouch();
      if (!errors.crashed && !editorPaused) post({ type: 'state', state: 'running' });
    }
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

/** Decoded textures past this make weak Chromebooks swap (drawings arrive at 2x their size). */
const TEXTURE_BUDGET_MB = 32;
let warnedTextures = false;

window.setInterval(() => {
  if (!started || mode !== 'play' || env.standalone) return;
  const stats = collectStats();
  post({ type: 'stats', stats });
  if (stats.textureMB > TEXTURE_BUDGET_MB && !warnedTextures) {
    warnedTextures = true;
    post({ type: 'warn', message: `This game holds ${Math.round(stats.textureMB)} MB of pictures; slower Chromebooks may struggle past ${TEXTURE_BUDGET_MB} MB.` });
  }
}, 1000);

// ---------------------------------------------------------------- the robot test

async function startRobot(game: Phaser.Game, options: RobotOptions): Promise<void> {
  const raw = await runRobot({ game, options, input, keys, errors, recorder, stats: collectStats, state: () => state, progress: (stats) => post({ type: 'stats', stats }) });
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

function applyPrefs(prefs: PlayerPrefs): void {
  env.prefs = mode === 'robot' ? { ...prefs, muted: true, touch: 'off', errorPanel: false } : prefs;
  flash.setPolicy(flashPolicy(env.prefs.reducedMotion));
  errors.showPanel = env.prefs.errorPanel;
  touch.setMode(env.prefs.touch);
  applyQuality(env.prefs, null);
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
  const warn = (message: string) => post({ type: 'warn', message });
  await Promise.all([loadFonts(msg.fonts, warn), loadArt(msg.art, env.drawn, warn), loadSounds(msg.sounds, audio, env.sounds, warn)]);
  errors.globalPhase = 'load';
  await runFiles(msg.files, errors.scripts);
  if (!errors.crashed) await runStart();
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

/** Change mode's "step": simulate frames of a paused game on its own clock, drawing only the last. */
function advancePaused(frames: number): void {
  const game = currentGame();
  if (!game || !editorPaused || mode !== 'play') return;
  if (frames <= 0) {
    renderOnly(game);
    return;
  }
  const dt = 1000 / 60;
  let t = game.loop.time;
  for (let i = 0; i < frames; i++) {
    t += dt;
    stepFrame(game, t, dt, i === frames - 1);
  }
}

const editorShell: EditorShell = {
  game: () => currentGame(),
  scene: () => currentScene() ?? currentGame()?.scene.getScenes(true)[0] ?? null,
  post,
  paused: () => editorPaused,
  pause: pauseGame,
  resume: resumeGame,
  advance: advancePaused,
  render: () => {
    const game = currentGame();
    if (game) renderOnly(game);
  },
  objects: (max = 64) => {
    const game = currentGame();
    return game ? worldObjects(game, max) : [];
  },
};

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
    case 'mode':
    case 'select':
    case 'celebrate':
    case 'step':
    case 'snapshot':
      try {
        editorHandler()?.(msg, editorShell);
      } catch (err) {
        post({ type: 'log', level: 'error', message: `Change mode: ${String(err instanceof Error ? err.message : err).slice(0, 300)}` });
      }
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

installTestHook({
  state: () => state,
  errors: () => errors.errors,
  swaps: () => swaps,
  stats: collectStats,
  dials: () => env.dials.values(),
  twists: () => [...env.twistsOn],
  prefs: () => ({ ...env.prefs }),
  flashes: () => [...flash.allowed],
});

// ---------------------------------------------------------------- go

if (embedded) {
  // Called by the standalone script's ▶ Play card, inside the click (so sound can start).
  const start = (init: InitMessage) => {
    audio.unlock();
    link.inject(init);
  };
  Object.defineProperty(window, STANDALONE_START, { value: start });
} else {
  post({ type: 'hello', protocol: PROTOCOL_VERSION, phaser: Phaser.VERSION });
}
