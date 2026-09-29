/**
 * The player core as the app sees it (§8.2): protocol v2 types, the framework-free `Player`, the robot
 * judge, the standalone page builder and the kit's API manifest. App code imports these only from here;
 * `src/runtime/**` and `phaser` are never imported by the app.
 *
 * FOUNDATION-STUB: the player core (`src/play`, `src/runtime`, `vite/ambleRuntime.ts`) has not merged yet.
 * Until it does, this file carries the protocol v2 types (mirrored from the core's working copy) plus the
 * step-5 protocol additions, and typed stubs for the functions. When the core merges, the types become
 * re-exports of `src/play/protocol.ts` (the additions move there too) and the stubs become re-exports.
 */
import { NotBuiltYet } from '../model/notBuilt';

/** 'stub' until the player core merges; e2e tests skip what needs a real game until then. */
export const PLAYER_CORE: 'stub' | 'real' = 'stub';

export const PROTOCOL_VERSION = 2;

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

/** A student file. `name` is what errors show ("game.js line 12"). */
export interface GameFile {
  name: string;
  source: string;
}

/** A PNG Blob, a transferred ImageBitmap, or a data URL. */
export type ImageSource = Blob | ImageBitmap | string;

/** One of the student's drawings for an art key. `rig` is RigData v1, passed to the rigged factory as-is. */
export interface DrawnArt {
  key: string;
  image: ImageSource;
  rig?: unknown;
  layers?: Record<string, ImageSource>;
}

/** Student sounds: raw PCM or encoded bytes (decoded in the iframe, never fetched). */
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
  quality: 'auto' | 0 | 1 | 2;
  touch: 'auto' | 'on' | 'off';
  /** 0.5, 0.75 or 1. */
  speed: number;
  captions: boolean;
  /** Show the in-game "Oops!" panel when the game breaks. */
  errorPanel: boolean;
  /** Report `artClicked` when a placeholder is tapped while the game is paused. */
  ghostTaps: boolean;
}

export const DEFAULT_PLAYER_PREFS: PlayerPrefs = {
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

/** Robot test: the game runs on a manual clock with a scripted input bot. */
export interface RobotOptions {
  /** Game time to simulate, in ms. */
  gameMs: number;
  seed: number;
  bot: 'auto' | 'none';
}

export interface InitMessage {
  type: 'init';
  mode: 'play' | 'robot';
  /** Helper files first, game.js last. */
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

/** Step-5 additions (editor → player). M2 implements them in `src/runtime/editor/`. */
export type ToPlayerAdditions =
  /** change = paused, objects streamed at 4 Hz, art keys outlined. */
  | { type: 'mode'; mode: 'play' | 'change' }
  /** Lantern outline around one object in Change mode. */
  | { type: 'select'; id: number | null }
  /** After Bring to life: the character's cheer (or a hop) and eight mint sparks. */
  | { type: 'celebrate'; key: string }
  /** While paused: advance N frames (0 = just render one frame). */
  | { type: 'step'; frames: number }
  /** Reply 'snapshot' with a PNG of the current frame. */
  | { type: 'snapshot'; maxW: number };

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
  | { type: 'dispose' }
  | ToPlayerAdditions;

// ------------------------------------------------------------------ data the player reports

/** One picture the game needs: from `static art`, or guessed from a key the game used. */
export interface ArtNeed {
  key: string;
  name: string;
  kind: ArtKind;
  rig: RigKind;
  role: Role;
  shape: ArtShape;
  /** In-game size (game px): hitbox and placeholder size. */
  w: number;
  h: number;
  /** '#rrggbb' placeholder tint. */
  color: string;
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
  available: boolean;
  on: boolean;
}

export interface GameManifest {
  title: string;
  subtitle: string;
  physics: 'arcade' | 'matter' | 'none' | 'phaser';
  kit: boolean;
  art: ArtNeed[];
  dials: DialInfo[];
  twists: TwistInfo[];
  controls: Action[];
}

export const EMPTY_MANIFEST: GameManifest = { title: '', subtitle: '', physics: 'phaser', kit: false, art: [], dials: [], twists: [], controls: [] };

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
  file?: string;
  line?: number;
  column?: number;
  /** How many times this same error happened in this run. */
  count: number;
  stack?: string;
}

export type AudioState = 'running' | 'suspended' | 'closed' | 'none';

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

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** What the runtime measured during a robot test; `judgeRobot` turns it into pass/fail. */
export interface RobotRaw {
  gameMs: number;
  frames: number;
  wallMs: number;
  speed: number;
  errors: PlayerError[];
  warnings: string[];
  events: GameEvent[];
  artMissing: string[];
  state: GameState;
  hero: { found: boolean; controlled: boolean; moved: number; alive: boolean };
  movers: number;
  frameDiff: number;
  lumaVariance: number;
  start: RuntimeStats;
  end: RuntimeStats;
  peakObjects: number;
  peakMatterBodies: number;
}

export type LogLevel = 'log' | 'info' | 'warn' | 'error';

/** One thing in the world, reported in Change mode (step-5 addition). */
export interface WorldObject {
  id: number;
  key: string | null;
  label: string;
  role: Role | 'scenery';
  group: string | null;
  /** CSS px inside the iframe viewport. */
  x: number;
  y: number;
  w: number;
  h: number;
  drawn: boolean;
  /** Live members sharing this key (first instance only). */
  count: number;
}

/** Step-5 additions (player → editor). */
export type FromPlayerAdditions =
  /** Change mode: ≤ 64 items at 4 Hz. */
  | { type: 'objects'; items: WorldObject[] }
  | { type: 'snapshot'; png: Blob };

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
  | { type: 'escape' }
  | FromPlayerAdditions;

export type FromPlayerType = FromPlayer['type'];

// ------------------------------------------------------------------ robot verdict

export interface RobotThresholds {
  minFrameRatio: number;
  minLumaVariance: number;
  minHeroMove: number;
  maxObjects: number;
  maxMatterBodies: number;
  maxGrowth: number;
  maxGrowthSlack: number;
}

export const ROBOT_THRESHOLDS: RobotThresholds = {
  minFrameRatio: 0.9,
  minLumaVariance: 4,
  minHeroMove: 8,
  maxObjects: 3000,
  maxMatterBodies: 250,
  maxGrowth: 3,
  maxGrowthSlack: 300,
};

/** Pass/fail with reasons the repair prompt (and a curious student) can act on (§5.8). */
export interface RobotVerdict {
  pass: boolean;
  /** Why it failed (empty when it passed). */
  reasons: string[];
  /** Worth knowing, but not a failure. */
  notes: string[];
  /** Something on screen moved. */
  moved: boolean;
  blank: boolean;
}

/** The core's full report: the raw measurements plus the verdict. */
export type RobotReport = RobotRaw & RobotVerdict;

/** `(raw, opts?) => RobotVerdict` (§8.2). The expected frame count defaults to 60 per second of game time. */
export function judgeRobot(raw: RobotRaw, opts: { expectedFrames?: number; thresholds?: RobotThresholds } = {}): RobotVerdict {
  const t = opts.thresholds ?? ROBOT_THRESHOLDS;
  const expected = opts.expectedFrames ?? Math.round(raw.gameMs / (1000 / 60));
  const reasons: string[] = [];
  const notes: string[] = [];
  for (const e of raw.errors.slice(0, 5)) {
    const where = e.file && e.line ? ` (line ${e.line} of ${e.file})` : '';
    reasons.push(`The game broke${where}: ${e.message}`);
  }
  if (raw.errors.length === 0 && raw.state === 'crashed') reasons.push('The game stopped with an error.');
  if (raw.frames < expected * t.minFrameRatio) reasons.push(`The robot could only play ${raw.frames} of ${expected} frames.`);
  const blank = raw.lumaVariance < t.minLumaVariance;
  if (blank) reasons.push('The screen stayed blank.');
  const heroMoved = raw.hero.found && raw.hero.moved >= t.minHeroMove;
  if (raw.hero.found && raw.hero.controlled && !heroMoved) reasons.push("The hero didn't move when the robot pressed the controls.");
  const moved = heroMoved || raw.movers > 0 || raw.frameDiff > 0.002;
  if (!moved && !blank) reasons.push(`Nothing moved in ${Math.round(raw.gameMs / 1000)} seconds.`);
  if (raw.artMissing.length) notes.push(`Not drawn yet: ${raw.artMissing.join(', ')}.`);
  return { pass: reasons.length === 0, reasons, notes, moved, blank };
}

// ------------------------------------------------------------------ the Player controller

/** Everything needed to run a game. */
export interface GameBundle {
  files: GameFile[];
  art?: DrawnArt[];
  sounds?: SoundAsset[];
  fonts?: FontAsset[];
  dials?: Record<string, number>;
  twists?: string[];
  storage?: Record<string, string>;
  autostart?: boolean;
}

export type PlayerState = 'idle' | GameState;

export interface PlayerEvents {
  state: (state: PlayerState) => void;
  manifest: (manifest: GameManifest) => void;
  /** ms from load() to the first drawn frame. */
  firstFrame: (ms: number) => void;
  booted: (info: { renderer: 'webgl' | 'canvas'; gpu: string; maxTexture: number }) => void;
  error: (error: PlayerError) => void;
  warn: (message: string, where: { file?: string; line?: number }) => void;
  log: (level: LogLevel, message: string) => void;
  event: (event: GameEvent) => void;
  artMissing: (need: ArtNeed) => void;
  /** `rect` is in container px. */
  artClicked: (key: string, rect: Rect) => void;
  swapped: (info: { key: string; objects: number; ms: number }) => void;
  storage: (data: Record<string, string>) => void;
  stats: (stats: RuntimeStats) => void;
  audio: (state: AudioState) => void;
  csp: (info: { directive: string; blocked: string }) => void;
  navigated: () => void;
  escape: () => void;
}

export interface PlayerOptions {
  /** The iframe fills it; it is also what goes full screen. */
  container: HTMLElement;
  /** URL of the runtime file. */
  runtimeUrl: string;
  /** Accessible name of the game iframe ("Moon King (game)"). */
  title?: string;
  prefs?: Partial<PlayerPrefs>;
  /** Keep a spare iframe booted so Run is fast (default true). */
  prewarm?: boolean;
  frozenAfterMs?: number;
}

export interface RobotTestOptions {
  gameMs?: number;
  seed?: number;
  bot?: 'auto' | 'none';
  timeoutMs?: number;
  thresholds?: RobotThresholds;
}

export interface KeyLike {
  key: string;
  code: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
}

/**
 * FOUNDATION-STUB of the core's `Player` (same public shape). It never creates an iframe: loads resolve
 * without a first frame, and the robot test reports that the player is not built yet.
 */
export class Player {
  state: PlayerState = 'idle';
  manifest: GameManifest | null = null;
  stats: RuntimeStats | null = null;
  errors: PlayerError[] = [];
  private prefs: PlayerPrefs;

  constructor(options: PlayerOptions) {
    this.prefs = { ...DEFAULT_PLAYER_PREFS, ...options.prefs };
  }

  on<K extends keyof PlayerEvents>(_name: K, _fn: PlayerEvents[K]): () => void {
    return () => undefined;
  }

  load(_bundle: GameBundle): Promise<void> {
    return Promise.resolve();
  }

  restart(): Promise<void> {
    return Promise.resolve();
  }

  restartLevel(): void {}
  pause(): void {}
  resume(): void {}
  swapArt(_art: DrawnArt): void {}
  clearArt(_key: string): void {}
  setDial(_key: string, _value: number): void {}
  setTwist(_id: string, _on: boolean): void {}

  setPrefs(prefs: Partial<PlayerPrefs>): void {
    this.prefs = { ...this.prefs, ...prefs };
  }

  getPrefs(): PlayerPrefs {
    return { ...this.prefs };
  }

  setTitle(_title: string): void {}
  focus(): void {}
  unlockAudio(): void {}

  forwardKey(_e: KeyLike & { type: string; repeat?: boolean }): boolean {
    return false;
  }

  releaseKeys(): void {}

  requestFullscreen(): Promise<void> {
    return Promise.resolve();
  }

  exitFullscreen(): Promise<void> {
    return Promise.resolve();
  }

  robotTest(_bundle: GameBundle, _options: RobotTestOptions = {}): Promise<RobotReport> {
    return Promise.reject(new NotBuiltYet('The robot test (player core)'));
  }

  prewarm(): void {}
  destroy(): void {}

  get iframe(): HTMLIFrameElement | null {
    return null;
  }

  send(_msg: ToPlayer): void {}
}

/** URL of the runtime file (`virtual:amble-runtime`); empty until the player core merges. */
export const RUNTIME_URL = '';

// ------------------------------------------------------------------ standalone page and the kit manifest

/** One HTML file that plays a world with no network (Share as a web page, §6.2). */
export function buildStandaloneHtml(_init: InitMessage, _opts: { title: string }): string {
  throw new NotBuiltYet('buildStandaloneHtml (player core)');
}

export interface KitMember {
  /** `spawnHero`, `fx.shake`, `ui.hearts`... */
  name: string;
  kind: 'method' | 'property' | 'namespace';
  /** TypeScript-style signature, e.g. `spawnHero(x: number, y: number, key: string, o?: SpawnOptions): Actor`. */
  signature: string;
  /** One line a student can read. */
  doc: string;
}

export interface KitNamespace {
  /** '' for members of `this` (the scene), else 'fx', 'ui', 'pattern'... */
  name: string;
  doc: string;
  members: KitMember[];
}

/** The kit's API manifest: what the prompt cheat sheet, hover docs and autocomplete are built from. */
export interface KitApi {
  version: string;
  namespaces: KitNamespace[];
}

export const KIT_API: KitApi = { version: '0', namespaces: [] };

/** The model-facing `amble-kit.d.ts` as text. */
export const kitDts = '';
