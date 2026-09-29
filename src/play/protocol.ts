/**
 * Protocol v2 between the editor (`src/play`) and the sandboxed game runtime (`src/runtime/shell`).
 *
 * Transport: the iframe's bootstrap and the runtime's first message use `window.postMessage`
 * ('boot' / 'runtime' / 'hello'); the host then hands the runtime a MessagePort ('port') and every
 * later message travels over that port, so a navigated or replaced document never receives game data.
 *
 * Everything is structured-clone friendly: Blobs, ImageBitmaps, ArrayBuffers and Float32Arrays travel
 * without base64. The host treats every message from the player as untrusted: `parseFromPlayer` rebuilds
 * a clean object with capped strings and finite numbers, or returns null.
 *
 * This file is a leaf: no DOM, Phaser or app imports, so both sides (and vitest) can use it.
 */

export const PROTOCOL_VERSION = 2;
export const PLAYER_CHANNEL = 'amble-player';

// ------------------------------------------------------------------ vocabulary (shared with the kit)

export const ROLES = ['hero', 'enemy', 'boss', 'npc', 'item', 'hazard', 'prop', 'terrain', 'projectile', 'enemyShot', 'decor', 'background'] as const;
export type Role = (typeof ROLES)[number];

export const ART_KINDS = ['character', 'item', 'projectile', 'prop', 'terrain', 'background', 'decor'] as const;
export type ArtKind = (typeof ART_KINDS)[number];

export const RIG_KINDS = ['biped', 'quadruped', 'flyer', 'swimmer', 'blob', 'object', 'none'] as const;
export type RigKind = (typeof RIG_KINDS)[number];

export const ART_SHAPES = ['box', 'ellipse', 'capsule', 'diamond', 'star', 'heart', 'coin', 'tile'] as const;
export type ArtShape = (typeof ART_SHAPES)[number];

export const ACTIONS = ['left', 'right', 'up', 'down', 'jump', 'fire', 'dash', 'action', 'pause'] as const;
export type Action = (typeof ACTIONS)[number];

export type Facing = 'viewer' | 'right' | 'left';
export type Pronoun = 'him' | 'her' | 'them' | 'it';

// ------------------------------------------------------------------ data the editor sends

/** A student file. `name` is what errors show ("game.js line 12") and the sourceURL (amble:///game.js). */
export interface GameFile {
  name: string;
  source: string;
}

/** A PNG Blob (what the editor keeps in IndexedDB; decoded in the iframe), a transferred ImageBitmap, or a data URL. */
export type ImageSource = Blob | ImageBitmap | string;

/** One of the student's drawings for an art key. `rig` is RigData v1 (src/rig/types.ts), passed to the rigged factory as-is. */
export interface DrawnArt {
  key: string;
  image: ImageSource;
  rig?: unknown;
  layers?: Record<string, ImageSource>;
}

/** Student sounds: raw PCM (no decoding at all) or encoded bytes (decodeAudioData, never a fetch). */
export type SoundAsset =
  | { key: string; pcm: Float32Array[]; sampleRate: number; caption?: string }
  | { key: string; bytes: ArrayBuffer; caption?: string };

/** A font for in-game text (the iframe cannot load fonts from the network). */
export interface FontAsset {
  family: string;
  weight?: number;
  bytes: ArrayBuffer;
}

export interface PlayerPrefs {
  reducedMotion: boolean;
  muted: boolean;
  /** 0..1 */
  volume: number;
  /** 'auto' starts at 1 (2 on strong machines) and adapts to the frame rate. */
  quality: 'auto' | 0 | 1 | 2;
  touch: 'auto' | 'on' | 'off';
  /** Game speed for accessibility: 0.5, 0.75 or 1. */
  speed: number;
  captions: boolean;
  /** Show the in-game "Oops!" panel when the game breaks. */
  errorPanel: boolean;
  /** Report `artClicked` when a stand-in is tapped while the game is paused. */
  ghostTaps: boolean;
}

export const DEFAULT_PREFS: PlayerPrefs = {
  reducedMotion: false,
  muted: false,
  volume: 0.8,
  quality: 'auto',
  touch: 'auto',
  speed: 1,
  captions: false,
  errorPanel: true,
  ghostTaps: true,
};

/** Robot test: the game runs on a manual clock (no requestAnimationFrame) with a scripted input bot. */
export interface RobotOptions {
  /** Game time to simulate, in ms. */
  gameMs: number;
  /** Seeds Math.random and Phaser's RNG so runs are repeatable. */
  seed: number;
  /** 'auto' drives the hero by its behaviours (move, jump, shoot, dash) and clicks around; 'none' only watches. */
  bot: 'auto' | 'none';
}

export interface InitMessage {
  type: 'init';
  mode: 'play' | 'robot';
  /** Run in order: helper files first, game.js last. */
  files: GameFile[];
  art: DrawnArt[];
  sounds: SoundAsset[];
  fonts: FontAsset[];
  /** Dial values chosen by the student (over the game's defaults). */
  dials: Record<string, number>;
  /** Twist ids switched on. */
  twists: string[];
  /** The game's saved localStorage (the iframe has no real storage). */
  storage: Record<string, string>;
  prefs: PlayerPrefs;
  /** Skip the title card. */
  autostart: boolean;
  robot?: RobotOptions;
}

export type KeyPhase = 'down' | 'up';

export type ToPlayer =
  | { type: 'runtime'; scripts: ArrayBuffer[] }
  | { type: 'port' }
  | InitMessage
  | { type: 'art'; art: DrawnArt }
  | { type: 'clearArt'; key: string }
  | { type: 'dial'; key: string; value: number }
  | { type: 'twist'; id: string; on: boolean }
  | { type: 'prefs'; prefs: Partial<PlayerPrefs> }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'restartLevel' }
  | { type: 'key'; phase: KeyPhase; key: string; code: string; keyCode: number }
  | { type: 'releaseKeys' }
  | { type: 'unlockAudio' }
  | { type: 'dispose' };

// ------------------------------------------------------------------ data the player reports

/** One picture the game needs: from `static art`, or guessed from a key the game used. */
export interface ArtNeed {
  key: string;
  /** Shown to the student ("Moon King"). */
  name: string;
  kind: ArtKind;
  rig: RigKind;
  role: Role;
  shape: ArtShape;
  /** In-game size (game px): hitbox and stand-in size. */
  w: number;
  h: number;
  /** '#rrggbb' stand-in tint. */
  color: string;
  /** What Amble says when it asks for it ("Draw the Moon King, a giant boss"). */
  ask: string;
  about: string;
  pronoun: Pronoun;
  facing: Facing;
  /** 1 = ask first. */
  priority: number;
  required: boolean;
  /** Declared in `static art` (false: only used at runtime). */
  declared: boolean;
  /** The running game has used it. */
  used: boolean;
  /** The student's drawing is loaded. */
  drawn: boolean;
}

export interface DialSpec {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  /** false: the level restarts when it changes. */
  live: boolean;
  /** Extra words a student might say for it ("hop bounce float"). */
  words: string;
}

export interface DialInfo extends DialSpec {
  key: string;
  current: number;
  source: 'static' | 'tune';
}

export interface TwistInfo {
  id: string;
  name: string;
  does: string;
  /** The game has what the twist needs (a hero, enemies, gravity...). */
  available: boolean;
  on: boolean;
}

export interface GameManifest {
  title: string;
  subtitle: string;
  /** 'phaser' = a plain Phaser game that does not use the Amble kit. */
  physics: 'arcade' | 'matter' | 'none' | 'phaser';
  kit: boolean;
  art: ArtNeed[];
  dials: DialInfo[];
  twists: TwistInfo[];
  /** Actions the game reads (touch buttons and the controls hint are built from these). */
  controls: Action[];
}

export type GameState = 'loading' | 'title' | 'running' | 'paused' | 'won' | 'lost' | 'crashed';

export type GameEvent =
  | { kind: 'title'; text: string; sub: string }
  | { kind: 'start' }
  | { kind: 'score'; value: number }
  | { kind: 'lives'; value: number; max: number }
  | { kind: 'level'; value: number; text: string }
  | { kind: 'win'; text: string; score: number }
  | { kind: 'lose'; text: string; score: number }
  | { kind: 'text'; text: string }
  | { kind: 'caption'; text: string };

export type ErrorPhase = 'load' | 'boot' | 'create' | 'update' | 'callback' | 'frame' | 'uncaught' | 'promise' | 'frozen';

export interface PlayerError {
  phase: ErrorPhase;
  message: string;
  /** Student file and 1-based line/column, when the error came from (or through) student code. */
  file?: string;
  line?: number;
  column?: number;
  /** How many times this same error happened in this run. */
  count: number;
  stack?: string;
}

export interface RuntimeStats {
  fps: number;
  frameMs: number;
  frames: number;
  objects: number;
  particles: number;
  arcadeBodies: number;
  matterBodies: number;
  shots: number;
  tweens: number;
  drawCalls: number;
  textureMB: number;
  heapMB: number | null;
  quality: 0 | 1 | 2;
  timeScale: number;
  state: GameState;
  audio: AudioState;
  errors: number;
}

export type AudioState = 'running' | 'suspended' | 'closed' | 'none';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** What the runtime measured during a robot test; `judgeRobot` (robot.ts) turns it into pass/fail. */
export interface RobotRaw {
  gameMs: number;
  frames: number;
  wallMs: number;
  /** Manual-clock stepping speed: game ms simulated per wall-clock ms (not a frame rate). */
  speed: number;
  errors: PlayerError[];
  warnings: string[];
  events: GameEvent[];
  artMissing: string[];
  state: GameState;
  hero: { found: boolean; controlled: boolean; moved: number; alive: boolean };
  /** Top-level objects that moved more than 2 px between the first and last samples. */
  movers: number;
  /** 0..1: how much the picture changed between the first and last samples. */
  frameDiff: number;
  /** Brightness variance of the last frame; near 0 means blank. */
  lumaVariance: number;
  start: RuntimeStats;
  end: RuntimeStats;
  peakObjects: number;
  peakMatterBodies: number;
}

export type LogLevel = 'log' | 'info' | 'warn' | 'error';

export type FromPlayer =
  | { type: 'boot' }
  | { type: 'hello'; protocol: number; phaser: string }
  | { type: 'booted'; renderer: 'webgl' | 'canvas'; gpu: string; maxTexture: number }
  | { type: 'manifest'; manifest: GameManifest }
  | { type: 'firstFrame' }
  | { type: 'state'; state: GameState }
  | { type: 'event'; event: GameEvent }
  | { type: 'error'; error: PlayerError }
  | { type: 'warn'; message: string; file?: string; line?: number }
  | { type: 'log'; level: LogLevel; message: string }
  | { type: 'artMissing'; need: ArtNeed }
  | { type: 'artClicked'; key: string; rect: Rect }
  | { type: 'swapped'; key: string; objects: number; ms: number }
  | { type: 'storage'; data: Record<string, string> }
  | { type: 'stats'; stats: RuntimeStats }
  | { type: 'audio'; state: AudioState }
  | { type: 'robotResult'; raw: RobotRaw }
  | { type: 'csp'; directive: string; blocked: string }
  | { type: 'escape' };

export type FromPlayerType = FromPlayer['type'];

// ------------------------------------------------------------------ validation helpers

type Obj = Record<string, unknown>;

const MAX_TEXT = 500;
const MAX_KEY = 64;
const MAX_LIST = 256;

function isObj(v: unknown): v is Obj {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function text(v: unknown, max = MAX_TEXT): string | undefined {
  return typeof v === 'string' ? v.slice(0, max) : undefined;
}

function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

function nonNeg(v: unknown): number | undefined {
  const n = num(v);
  return n === undefined ? undefined : Math.max(0, n);
}

function oneOf<T extends string>(v: unknown, list: readonly T[]): T | undefined {
  return typeof v === 'string' && (list as readonly string[]).includes(v) ? (v as T) : undefined;
}

function bool(v: unknown): boolean | undefined {
  return typeof v === 'boolean' ? v : undefined;
}

function list<T>(v: unknown, item: (x: unknown) => T | null, max = MAX_LIST): T[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out: T[] = [];
  for (const x of v.slice(0, max)) {
    const parsed = item(x);
    if (parsed !== null) out.push(parsed);
  }
  return out;
}

function stringMap(v: unknown, maxEntries = 200, maxValue = 10_000): Record<string, string> | undefined {
  if (!isObj(v)) return undefined;
  const out: Record<string, string> = {};
  let n = 0;
  for (const [k, value] of Object.entries(v)) {
    if (n++ >= maxEntries) break;
    if (typeof value === 'string' && k.length <= 200) out[k] = value.slice(0, maxValue);
  }
  return out;
}

function numberMap(v: unknown, maxEntries = 64): Record<string, number> | undefined {
  if (!isObj(v)) return undefined;
  const out: Record<string, number> = {};
  let n = 0;
  for (const [k, value] of Object.entries(v)) {
    if (n++ >= maxEntries) break;
    const x = num(value);
    if (x !== undefined && k.length <= MAX_KEY) out[k] = x;
  }
  return out;
}

const ERROR_PHASES: readonly ErrorPhase[] = ['load', 'boot', 'create', 'update', 'callback', 'frame', 'uncaught', 'promise', 'frozen'];
const GAME_STATES: readonly GameState[] = ['loading', 'title', 'running', 'paused', 'won', 'lost', 'crashed'];
const AUDIO_STATES: readonly AudioState[] = ['running', 'suspended', 'closed', 'none'];
const LOG_LEVELS: readonly LogLevel[] = ['log', 'info', 'warn', 'error'];

export function parsePlayerError(v: unknown): PlayerError | null {
  if (!isObj(v)) return null;
  const phase = oneOf(v.phase, ERROR_PHASES);
  const message = text(v.message);
  if (!phase || message === undefined) return null;
  const out: PlayerError = { phase, message, count: Math.max(1, Math.round(nonNeg(v.count) ?? 1)) };
  const file = text(v.file, 120);
  const line = num(v.line);
  const column = num(v.column);
  const stack = text(v.stack, 2000);
  if (file !== undefined) out.file = file;
  if (line !== undefined && line >= 1) out.line = Math.round(line);
  if (column !== undefined && column >= 0) out.column = Math.round(column);
  if (stack !== undefined) out.stack = stack;
  return out;
}

export function parseGameEvent(v: unknown): GameEvent | null {
  if (!isObj(v)) return null;
  switch (v.kind) {
    case 'title':
      return { kind: 'title', text: text(v.text, 120) ?? '', sub: text(v.sub, 200) ?? '' };
    case 'start':
      return { kind: 'start' };
    case 'score': {
      const value = num(v.value);
      return value === undefined ? null : { kind: 'score', value };
    }
    case 'lives': {
      const value = num(v.value);
      const max = num(v.max);
      return value === undefined || max === undefined ? null : { kind: 'lives', value, max };
    }
    case 'level': {
      const value = num(v.value);
      return value === undefined ? null : { kind: 'level', value, text: text(v.text, 120) ?? '' };
    }
    case 'win':
    case 'lose': {
      const score = num(v.score) ?? 0;
      return { kind: v.kind, text: text(v.text, 120) ?? '', score };
    }
    case 'text':
    case 'caption': {
      const t = text(v.text, 300);
      return t === undefined ? null : { kind: v.kind, text: t };
    }
    default:
      return null;
  }
}

function parseArtNeed(v: unknown): ArtNeed | null {
  if (!isObj(v)) return null;
  const key = text(v.key, MAX_KEY);
  const kind = oneOf(v.kind, ART_KINDS);
  const rig = oneOf(v.rig, RIG_KINDS);
  const role = oneOf(v.role, ROLES);
  const shape = oneOf(v.shape, ART_SHAPES);
  const w = num(v.w);
  const h = num(v.h);
  if (!key || !kind || !rig || !role || !shape || w === undefined || h === undefined) return null;
  const color = text(v.color, 9) ?? '#8b83a8';
  return {
    key,
    name: text(v.name, 60) ?? key,
    kind,
    rig,
    role,
    shape,
    w: Math.max(1, Math.min(4096, w)),
    h: Math.max(1, Math.min(4096, h)),
    color: /^#[0-9a-f]{6}$/i.test(color) ? color : '#8b83a8',
    ask: text(v.ask, 160) ?? '',
    about: text(v.about, 160) ?? '',
    pronoun: oneOf(v.pronoun, ['him', 'her', 'them', 'it'] as const) ?? 'it',
    facing: oneOf(v.facing, ['viewer', 'right', 'left'] as const) ?? 'viewer',
    priority: Math.round(num(v.priority) ?? 50),
    required: bool(v.required) ?? false,
    declared: bool(v.declared) ?? false,
    used: bool(v.used) ?? false,
    drawn: bool(v.drawn) ?? false,
  };
}

function parseDialInfo(v: unknown): DialInfo | null {
  if (!isObj(v)) return null;
  const key = text(v.key, MAX_KEY);
  const value = num(v.value);
  const min = num(v.min);
  const max = num(v.max);
  const current = num(v.current);
  if (!key || value === undefined || min === undefined || max === undefined || current === undefined || !(min < max)) return null;
  return {
    key,
    label: text(v.label, 40) ?? key,
    value,
    min,
    max,
    step: Math.max(0, num(v.step) ?? 0),
    live: bool(v.live) ?? true,
    words: text(v.words, 120) ?? '',
    current,
    source: v.source === 'tune' ? 'tune' : 'static',
  };
}

function parseTwistInfo(v: unknown): TwistInfo | null {
  if (!isObj(v)) return null;
  const id = text(v.id, MAX_KEY);
  if (!id) return null;
  return { id, name: text(v.name, 60) ?? id, does: text(v.does, 200) ?? '', available: bool(v.available) ?? false, on: bool(v.on) ?? false };
}

function parseManifest(v: unknown): GameManifest | null {
  if (!isObj(v)) return null;
  return {
    title: text(v.title, 120) ?? '',
    subtitle: text(v.subtitle, 200) ?? '',
    physics: oneOf(v.physics, ['arcade', 'matter', 'none', 'phaser'] as const) ?? 'phaser',
    kit: bool(v.kit) ?? false,
    art: list(v.art, parseArtNeed, 128) ?? [],
    dials: list(v.dials, parseDialInfo, 32) ?? [],
    twists: list(v.twists, parseTwistInfo, 32) ?? [],
    controls: list(v.controls, (x) => oneOf(x, ACTIONS) ?? null, ACTIONS.length) ?? [],
  };
}

function parseStats(v: unknown): RuntimeStats | null {
  if (!isObj(v)) return null;
  const q = num(v.quality);
  const heap = num(v.heapMB);
  return {
    fps: nonNeg(v.fps) ?? 0,
    frameMs: nonNeg(v.frameMs) ?? 0,
    frames: nonNeg(v.frames) ?? 0,
    objects: nonNeg(v.objects) ?? 0,
    particles: nonNeg(v.particles) ?? 0,
    arcadeBodies: nonNeg(v.arcadeBodies) ?? 0,
    matterBodies: nonNeg(v.matterBodies) ?? 0,
    shots: nonNeg(v.shots) ?? 0,
    tweens: nonNeg(v.tweens) ?? 0,
    drawCalls: nonNeg(v.drawCalls) ?? 0,
    textureMB: nonNeg(v.textureMB) ?? 0,
    heapMB: heap === undefined ? null : Math.max(0, heap),
    quality: q === 0 || q === 1 || q === 2 ? q : 1,
    timeScale: nonNeg(v.timeScale) ?? 1,
    state: oneOf(v.state, GAME_STATES) ?? 'loading',
    audio: oneOf(v.audio, AUDIO_STATES) ?? 'none',
    errors: nonNeg(v.errors) ?? 0,
  };
}

function parseRect(v: unknown): Rect | null {
  if (!isObj(v)) return null;
  const x = num(v.x);
  const y = num(v.y);
  const w = nonNeg(v.w);
  const h = nonNeg(v.h);
  return x === undefined || y === undefined || w === undefined || h === undefined ? null : { x, y, w, h };
}

function parseRobotRaw(v: unknown): RobotRaw | null {
  if (!isObj(v)) return null;
  const start = parseStats(v.start);
  const end = parseStats(v.end);
  const hero = isObj(v.hero) ? v.hero : null;
  if (!start || !end || !hero) return null;
  return {
    gameMs: nonNeg(v.gameMs) ?? 0,
    frames: nonNeg(v.frames) ?? 0,
    wallMs: nonNeg(v.wallMs) ?? 0,
    speed: nonNeg(v.speed) ?? 0,
    errors: list(v.errors, parsePlayerError, 50) ?? [],
    warnings: list(v.warnings, (x) => text(x) ?? null, 50) ?? [],
    events: list(v.events, parseGameEvent, 200) ?? [],
    artMissing: list(v.artMissing, (x) => text(x, MAX_KEY) ?? null, 128) ?? [],
    state: oneOf(v.state, GAME_STATES) ?? 'loading',
    hero: {
      found: bool(hero.found) ?? false,
      controlled: bool(hero.controlled) ?? false,
      moved: nonNeg(hero.moved) ?? 0,
      alive: bool(hero.alive) ?? false,
    },
    movers: nonNeg(v.movers) ?? 0,
    frameDiff: Math.min(1, nonNeg(v.frameDiff) ?? 0),
    lumaVariance: nonNeg(v.lumaVariance) ?? 0,
    start,
    end,
    peakObjects: nonNeg(v.peakObjects) ?? 0,
    peakMatterBodies: nonNeg(v.peakMatterBodies) ?? 0,
  };
}

/**
 * Validates a message from the player (untrusted: game code runs in that realm). Returns a clean copy
 * with only known fields, capped strings and finite numbers, or null.
 */
export function parseFromPlayer(data: unknown): FromPlayer | null {
  if (!isObj(data)) return null;
  switch (data.type) {
    case 'boot':
      return { type: 'boot' };
    case 'hello': {
      const protocol = num(data.protocol);
      return protocol === undefined ? null : { type: 'hello', protocol, phaser: text(data.phaser, 20) ?? '' };
    }
    case 'booted': {
      const renderer = oneOf(data.renderer, ['webgl', 'canvas'] as const);
      return renderer ? { type: 'booted', renderer, gpu: text(data.gpu, 200) ?? '', maxTexture: nonNeg(data.maxTexture) ?? 0 } : null;
    }
    case 'manifest': {
      const manifest = parseManifest(data.manifest);
      return manifest ? { type: 'manifest', manifest } : null;
    }
    case 'firstFrame':
      return { type: 'firstFrame' };
    case 'state': {
      const state = oneOf(data.state, GAME_STATES);
      return state ? { type: 'state', state } : null;
    }
    case 'event': {
      const event = parseGameEvent(data.event);
      return event ? { type: 'event', event } : null;
    }
    case 'error': {
      const error = parsePlayerError(data.error);
      return error ? { type: 'error', error } : null;
    }
    case 'warn': {
      const message = text(data.message);
      if (message === undefined) return null;
      const out: FromPlayer = { type: 'warn', message };
      const file = text(data.file, 120);
      const line = num(data.line);
      if (file !== undefined) out.file = file;
      if (line !== undefined && line >= 1) out.line = Math.round(line);
      return out;
    }
    case 'log': {
      const level = oneOf(data.level, LOG_LEVELS);
      const message = text(data.message);
      return level && message !== undefined ? { type: 'log', level, message } : null;
    }
    case 'artMissing': {
      const need = parseArtNeed(data.need);
      return need ? { type: 'artMissing', need } : null;
    }
    case 'artClicked': {
      const key = text(data.key, MAX_KEY);
      const rect = parseRect(data.rect);
      return key && rect ? { type: 'artClicked', key, rect } : null;
    }
    case 'swapped': {
      const key = text(data.key, MAX_KEY);
      return key ? { type: 'swapped', key, objects: nonNeg(data.objects) ?? 0, ms: nonNeg(data.ms) ?? 0 } : null;
    }
    case 'storage': {
      const map = stringMap(data.data);
      return map ? { type: 'storage', data: map } : null;
    }
    case 'stats': {
      const stats = parseStats(data.stats);
      return stats ? { type: 'stats', stats } : null;
    }
    case 'audio': {
      const state = oneOf(data.state, AUDIO_STATES);
      return state ? { type: 'audio', state } : null;
    }
    case 'robotResult': {
      const raw = parseRobotRaw(data.raw);
      return raw ? { type: 'robotResult', raw } : null;
    }
    case 'csp':
      return { type: 'csp', directive: text(data.directive, 60) ?? '', blocked: text(data.blocked, 200) ?? '' };
    case 'escape':
      return { type: 'escape' };
    default:
      return null;
  }
}

// ------------------------------------------------------------------ editor -> player (validated by the runtime)

function isImageSource(v: unknown): v is ImageSource {
  if (typeof v === 'string') return v.startsWith('data:image/');
  if (typeof Blob !== 'undefined' && v instanceof Blob) return true;
  return typeof ImageBitmap !== 'undefined' && v instanceof ImageBitmap;
}

function parseDrawnArt(v: unknown): DrawnArt | null {
  if (!isObj(v)) return null;
  const key = text(v.key, MAX_KEY);
  if (!key || !isImageSource(v.image)) return null;
  const out: DrawnArt = { key, image: v.image };
  if (v.rig !== undefined && v.rig !== null) out.rig = v.rig;
  if (isObj(v.layers)) {
    const layers: Record<string, ImageSource> = {};
    for (const [name, img] of Object.entries(v.layers)) if (isImageSource(img)) layers[name] = img;
    out.layers = layers;
  }
  return out;
}

function parseSound(v: unknown): SoundAsset | null {
  if (!isObj(v)) return null;
  const key = text(v.key, MAX_KEY);
  if (!key) return null;
  const caption = text(v.caption, 120);
  if (Array.isArray(v.pcm) && v.pcm.every((c) => c instanceof Float32Array) && v.pcm.length > 0) {
    const sampleRate = num(v.sampleRate);
    if (sampleRate === undefined || sampleRate < 3000 || sampleRate > 192000) return null;
    return caption === undefined ? { key, pcm: v.pcm as Float32Array[], sampleRate } : { key, pcm: v.pcm as Float32Array[], sampleRate, caption };
  }
  if (v.bytes instanceof ArrayBuffer) return caption === undefined ? { key, bytes: v.bytes } : { key, bytes: v.bytes, caption };
  return null;
}

const PREF_PARSERS: { [K in keyof PlayerPrefs]: (v: unknown) => PlayerPrefs[K] | undefined } = {
  reducedMotion: bool,
  muted: bool,
  volume: (v) => {
    const n = num(v);
    return n === undefined ? undefined : Math.max(0, Math.min(1, n));
  },
  quality: (v) => (v === 'auto' || v === 0 || v === 1 || v === 2 ? v : undefined),
  touch: (v) => oneOf(v, ['auto', 'on', 'off'] as const),
  speed: (v) => {
    const n = num(v);
    return n === undefined ? undefined : Math.max(0.25, Math.min(1, n));
  },
  captions: bool,
  errorPanel: bool,
  ghostTaps: bool,
};

const PREF_KEYS = Object.keys(DEFAULT_PREFS) as Array<keyof PlayerPrefs>;

function setPref<K extends keyof PlayerPrefs>(out: Partial<PlayerPrefs>, k: K, raw: unknown): void {
  const parsed = PREF_PARSERS[k](raw);
  if (parsed !== undefined) out[k] = parsed;
}

/** Full prefs: valid fields of `v` over `base`. */
export function parsePrefs(v: unknown, base: PlayerPrefs = DEFAULT_PREFS): PlayerPrefs {
  const o = isObj(v) ? v : {};
  const out: Partial<PlayerPrefs> = {};
  for (const k of PREF_KEYS) setPref(out, k, o[k]);
  return { ...base, ...out };
}

function parseInit(v: Obj): InitMessage | null {
  const files = list(
    v.files,
    (f) => {
      if (!isObj(f)) return null;
      const name = text(f.name, 64);
      const source = typeof f.source === 'string' ? f.source : undefined;
      return name && source !== undefined ? { name, source } : null;
    },
    32,
  );
  if (!files) return null;
  const robot = isObj(v.robot)
    ? {
        gameMs: Math.max(100, Math.min(60_000, num(v.robot.gameMs) ?? 5000)),
        seed: Math.round(num(v.robot.seed) ?? 1),
        bot: v.robot.bot === 'none' ? ('none' as const) : ('auto' as const),
      }
    : undefined;
  const mode = v.mode === 'robot' && robot ? 'robot' : 'play';
  const init: InitMessage = {
    type: 'init',
    mode,
    files,
    art: list(v.art, parseDrawnArt, 128) ?? [],
    sounds: list(v.sounds, parseSound, 128) ?? [],
    fonts: list(
      v.fonts,
      (f) => (isObj(f) && typeof f.family === 'string' && f.bytes instanceof ArrayBuffer ? { family: f.family.slice(0, 60), weight: num(f.weight), bytes: f.bytes } : null),
      8,
    ) ?? [],
    dials: numberMap(v.dials) ?? {},
    twists: list(v.twists, (x) => text(x, MAX_KEY) ?? null, 32) ?? [],
    storage: stringMap(v.storage, 500, 100_000) ?? {},
    prefs: parsePrefs(v.prefs),
    autostart: bool(v.autostart) ?? false,
  };
  if (robot) init.robot = robot;
  return init;
}

/** Validates a message from the editor (the runtime side). */
export function parseToPlayer(data: unknown): ToPlayer | null {
  if (!isObj(data)) return null;
  switch (data.type) {
    case 'runtime':
      return Array.isArray(data.scripts) && data.scripts.every((s) => s instanceof ArrayBuffer) ? { type: 'runtime', scripts: data.scripts as ArrayBuffer[] } : null;
    case 'port':
      return { type: 'port' };
    case 'init':
      return parseInit(data);
    case 'art': {
      const art = parseDrawnArt(data.art);
      return art ? { type: 'art', art } : null;
    }
    case 'clearArt': {
      const key = text(data.key, MAX_KEY);
      return key ? { type: 'clearArt', key } : null;
    }
    case 'dial': {
      const key = text(data.key, MAX_KEY);
      const value = num(data.value);
      return key && value !== undefined ? { type: 'dial', key, value } : null;
    }
    case 'twist': {
      const id = text(data.id, MAX_KEY);
      const on = bool(data.on);
      return id && on !== undefined ? { type: 'twist', id, on } : null;
    }
    case 'prefs':
      return { type: 'prefs', prefs: isObj(data.prefs) ? pickPrefs(data.prefs) : {} };
    case 'pause':
    case 'resume':
    case 'restartLevel':
    case 'releaseKeys':
    case 'unlockAudio':
    case 'dispose':
      return { type: data.type };
    case 'key': {
      const phase = oneOf(data.phase, ['down', 'up'] as const);
      const key = text(data.key, 32);
      const code = text(data.code, 32);
      if (!phase || key === undefined || code === undefined) return null;
      return { type: 'key', phase, key, code, keyCode: Math.round(nonNeg(data.keyCode) ?? 0) };
    }
    default:
      return null;
  }
}

/** Only the prefs fields that are present and valid (for partial updates). */
function pickPrefs(v: Obj): Partial<PlayerPrefs> {
  const out: Partial<PlayerPrefs> = {};
  for (const k of PREF_KEYS) if (k in v) setPref(out, k, v[k]);
  return out;
}

/** Objects to transfer (not copy) with a message to the player. The sender gives up these buffers. */
export function transferablesOf(msg: ToPlayer): Transferable[] {
  const out: Transferable[] = [];
  const image = (src: ImageSource) => {
    if (typeof ImageBitmap !== 'undefined' && src instanceof ImageBitmap) out.push(src);
  };
  const art = (a: DrawnArt) => {
    image(a.image);
    if (a.layers) Object.values(a.layers).forEach(image);
  };
  if (msg.type === 'runtime') out.push(...msg.scripts);
  if (msg.type === 'art') art(msg.art);
  if (msg.type === 'init') {
    msg.art.forEach(art);
    for (const s of msg.sounds) {
      if ('pcm' in s) s.pcm.forEach((ch) => out.push(ch.buffer as ArrayBuffer));
      else out.push(s.bytes);
    }
    msg.fonts.forEach((f) => out.push(f.bytes));
  }
  return [...new Set(out)];
}
