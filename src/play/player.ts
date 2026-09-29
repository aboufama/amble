/**
 * `Player`: the framework-free controller the editor UI wraps. It owns the visible game iframe and one
 * pre-warmed spare, and speaks protocol v2 (protocol.ts) with the sandboxed runtime.
 *
 *   const player = new Player({ container: stageEl, runtimeUrl });
 *   player.on('manifest', (m) => showCast(m.art));
 *   stageButton.onclick = () => { player.focus(); void player.load({ files }); };  // inside the click: keys + sound
 *   player.swapArt({ key: 'hero', image: pngBlob });   // a drawing changed: no restart
 *   player.setDial('jump', 900);                         // live
 *
 * Code changes get a fresh iframe (a clean JS realm) taken from the warm spare (about 0.6-0.9 s to the first
 * frame, measured); art, dials, twists and prefs apply in place.
 */
import { PlayerFrame } from './frame';
import { isScrollKey, keyCodeFor, shouldForwardKey, type KeyLike } from './keys';
import {
  DEFAULT_PREFS,
  type ArtNeed,
  type AudioState,
  type DrawnArt,
  type FontAsset,
  type FromPlayer,
  type GameEvent,
  type GameFile,
  type GameManifest,
  type GameState,
  type InitMessage,
  type LogLevel,
  type PlayerError,
  type PlayerPrefs,
  type Rect,
  type RuntimeStats,
  type SoundAsset,
  type ToPlayer,
  type WorldObject,
} from './protocol';
import { runRobotTest, type RobotTestOptions } from './robot';
import type { RobotReport } from './robotJudge';

/** Everything needed to run a game. */
export interface GameBundle {
  /** Helper files first, game.js last. */
  files: GameFile[];
  art?: DrawnArt[];
  sounds?: SoundAsset[];
  fonts?: FontAsset[];
  /** Dial values chosen by the student. */
  dials?: Record<string, number>;
  /** Twist ids switched on. */
  twists?: string[];
  /** The game's saved localStorage. */
  storage?: Record<string, string>;
  /** Skip the title card (previews, the Draw screen's live game). */
  autostart?: boolean;
}

export type PlayerState = 'idle' | GameState;

export interface PlayerEvents {
  state: (state: PlayerState) => void;
  /** What the game needs and offers: art (from `static art` and use), dials, twists, controls. */
  manifest: (manifest: GameManifest) => void;
  /** ms from load() to the first drawn frame. */
  firstFrame: (ms: number) => void;
  booted: (info: { renderer: 'webgl' | 'canvas'; gpu: string; maxTexture: number }) => void;
  error: (error: PlayerError) => void;
  warn: (message: string, where: { file?: string; line?: number }) => void;
  log: (level: LogLevel, message: string) => void;
  /** Game events for the Studio and the screen-reader text mirror: title, score, lives, level, win, lose, text. */
  event: (event: GameEvent) => void;
  /** The game used art the student has not drawn yet (a stand-in is playing its part). */
  artMissing: (need: ArtNeed) => void;
  /** The student tapped a stand-in while the game was paused. `rect` is in container px. */
  artClicked: (key: string, rect: Rect) => void;
  swapped: (info: { key: string; objects: number; ms: number }) => void;
  /** The game's localStorage changed: save it with the project. */
  storage: (data: Record<string, string>) => void;
  stats: (stats: RuntimeStats) => void;
  /** 'suspended' means the game is silent until a tap: show a "Tap for sound" hint. */
  audio: (state: AudioState) => void;
  csp: (info: { directive: string; blocked: string }) => void;
  /** The game tried to open a web page; Amble rebuilt it. */
  navigated: () => void;
  /** Escape was pressed inside the game: leave full screen / give focus back to the editor. */
  escape: () => void;
  /** Change mode's object reports (at most 64, 4 times a second), sent by the runtime's editor module. */
  objects: (items: WorldObject[]) => void;
  /** A PNG of the current frame: the answer to `send({ type: 'snapshot', maxW })`. */
  snapshot: (png: Blob) => void;
}

type Listeners = { [K in keyof PlayerEvents]: Set<PlayerEvents[K]> };

export interface PlayerOptions {
  /** The stage wrapper. The iframe fills it; it is also what goes full screen. */
  container: HTMLElement;
  /** URL of the runtime file (`import runtimeUrl from 'virtual:amble-runtime'`). */
  runtimeUrl: string;
  /** Accessible name of the game iframe ("Moon King (game)"). */
  title?: string;
  prefs?: Partial<PlayerPrefs>;
  /** Keep a spare iframe booted so Run is fast (default: yes, unless the machine reports under 4 GB). */
  prewarm?: boolean;
  /** Milliseconds without any message from a running game before it counts as frozen (default 10000). */
  frozenAfterMs?: number;
}

const WATCHDOG_MS = 1000;

export class Player {
  private readonly container: HTMLElement;
  private readonly runtimeUrl: string;
  private title: string;
  private prefs: PlayerPrefs;
  private readonly prewarmEnabled: boolean;
  private readonly frozenAfterMs: number;
  private current: PlayerFrame | null = null;
  private spare: PlayerFrame | null = null;
  private leaving: PlayerFrame[] = [];
  private bundle: GameBundle | null = null;
  private loadStartedAt = 0;
  private pending: { resolve: () => void; reject: (err: Error) => void } | null = null;
  private spareTimer = 0;
  private readonly watchdog: number;
  private autoPaused = false;
  private userPaused = false;
  private destroyed = false;
  /** Navigations of the current bundle: rebuilt once, then it counts as broken (no rebuild loop). */
  private navigations = 0;
  private readonly listeners: Listeners = {
    state: new Set(), manifest: new Set(), firstFrame: new Set(), booted: new Set(), error: new Set(), warn: new Set(), log: new Set(),
    event: new Set(), artMissing: new Set(), artClicked: new Set(), swapped: new Set(), storage: new Set(), stats: new Set(),
    audio: new Set(), csp: new Set(), navigated: new Set(), escape: new Set(), objects: new Set(), snapshot: new Set(),
  };

  /** Current game state ('idle' before the first load). */
  state: PlayerState = 'idle';
  /** The latest manifest from the running game. */
  manifest: GameManifest | null = null;
  /** The latest stats (1 Hz while running). */
  stats: RuntimeStats | null = null;
  /** Errors of the current run, in order (deduplicated by the runtime, with counts). */
  errors: PlayerError[] = [];

  private readonly onVisibility = (): void => {
    if (document.visibilityState === 'hidden') {
      if (this.state === 'running' || this.state === 'title') {
        this.autoPaused = true;
        this.current?.send({ type: 'pause' });
      }
    } else if (this.autoPaused) {
      this.autoPaused = false;
      if (!this.userPaused) this.current?.send({ type: 'resume' });
    }
  };

  constructor(options: PlayerOptions) {
    this.container = options.container;
    this.runtimeUrl = options.runtimeUrl;
    this.title = options.title ?? 'Game';
    this.prefs = { ...DEFAULT_PREFS, ...options.prefs };
    // Each renderer costs 45-60 MB plus textures: a 2 GB Chromebook cannot afford a spare.
    this.prewarmEnabled = options.prewarm ?? ((navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 4) >= 4;
    this.frozenAfterMs = options.frozenAfterMs ?? 10_000;
    if (getComputedStyle(this.container).position === 'static') this.container.style.position = 'relative';
    document.addEventListener('visibilitychange', this.onVisibility);
    this.watchdog = window.setInterval(() => this.checkFrozen(), WATCHDOG_MS);
    if (this.prewarmEnabled) this.prewarm();
  }

  // ---------------------------------------------------------------- events

  on<K extends keyof PlayerEvents>(name: K, fn: PlayerEvents[K]): () => void {
    this.listeners[name].add(fn);
    return () => this.listeners[name].delete(fn);
  }

  private emit<K extends keyof PlayerEvents>(name: K, ...args: Parameters<PlayerEvents[K]>): void {
    for (const fn of this.listeners[name]) {
      try {
        (fn as (...a: Parameters<PlayerEvents[K]>) => void)(...args);
      } catch (err) {
        console.error(err);
      }
    }
  }

  private setState(state: PlayerState): void {
    if (state === this.state) return;
    this.state = state;
    this.emit('state', state);
  }

  // ---------------------------------------------------------------- running games

  /**
   * Runs a game in a fresh realm (the warm spare when there is one). Resolves at the first drawn frame.
   * The previous game stays on screen (paused) until then, so there is no blank flash.
   */
  load(bundle: GameBundle): Promise<void> {
    if (this.destroyed) return Promise.reject(new Error('This player was destroyed.'));
    if (bundle !== this.bundle) this.navigations = 0;
    this.bundle = cloneBundle(bundle);
    this.pending?.reject(new Error('Replaced by a newer load.'));
    this.manifest = null;
    this.stats = null;
    this.errors = [];
    this.userPaused = false;
    this.autoPaused = false;
    const previous = this.current;
    if (previous) {
      previous.send({ type: 'pause' });
      previous.iframe.style.zIndex = '1';
      this.leaving.push(previous);
    }
    const frame = this.takeSpare() ?? this.newFrame(false);
    frame.iframe.style.zIndex = '0';
    frame.show();
    this.current = frame;
    this.bind(frame);
    this.loadStartedAt = performance.now();
    this.setState('loading');
    frame.send(this.initMessage(this.bundle));
    return new Promise<void>((resolve, reject) => {
      this.pending = { resolve, reject };
    });
  }

  /** Runs the same game again in a fresh realm (clean memory, fresh WebGL context). */
  restart(): Promise<void> {
    if (!this.bundle) return Promise.reject(new Error('Nothing to restart yet.'));
    this.navigations = 0;
    return this.load(this.bundle);
  }

  /** Restarts the level inside the running realm (fast; keeps textures). */
  restartLevel(): void {
    this.userPaused = false;
    this.current?.send({ type: 'restartLevel' });
  }

  pause(): void {
    this.userPaused = true;
    this.current?.send({ type: 'pause' });
  }

  resume(): void {
    this.userPaused = false;
    this.autoPaused = false;
    this.current?.send({ type: 'resume' });
  }

  /** Hot swap one drawing (texture plus rig) into the running game; nothing restarts. */
  swapArt(art: DrawnArt): void {
    if (this.bundle) this.bundle.art = [...(this.bundle.art ?? []).filter((a) => a.key !== art.key), art];
    this.current?.send({ type: 'art', art });
  }

  /** The drawing was removed: the stand-in comes back. */
  clearArt(key: string): void {
    if (this.bundle) this.bundle.art = (this.bundle.art ?? []).filter((a) => a.key !== key);
    this.current?.send({ type: 'clearArt', key });
  }

  /** Turns a dial. Values read every frame apply on the next frame; others restart the level. */
  setDial(key: string, value: number): void {
    if (!Number.isFinite(value)) return;
    if (this.bundle) this.bundle.dials = { ...this.bundle.dials, [key]: value };
    this.current?.send({ type: 'dial', key, value });
  }

  setTwist(id: string, on: boolean): void {
    if (this.bundle) {
      const twists = new Set(this.bundle.twists ?? []);
      if (on) twists.add(id);
      else twists.delete(id);
      this.bundle.twists = [...twists];
    }
    this.current?.send({ type: 'twist', id, on });
  }

  setPrefs(prefs: Partial<PlayerPrefs>): void {
    this.prefs = { ...this.prefs, ...prefs };
    this.current?.send({ type: 'prefs', prefs });
  }

  getPrefs(): PlayerPrefs {
    return { ...this.prefs };
  }

  /** Renames the iframe for screen readers ("Moon King (game)"). */
  setTitle(title: string): void {
    this.title = title;
    if (this.current) this.current.iframe.title = title;
  }

  // ---------------------------------------------------------------- input, sound, full screen

  /** Call inside a click (the Play button, a tap on the stage): keyboard goes to the game and sound unlocks. */
  focus(): void {
    this.current?.iframe.focus();
    this.unlockAudio();
  }

  unlockAudio(): void {
    this.current?.send({ type: 'unlockAudio' });
  }

  /**
   * For the editor's keydown/keyup listeners while the game runs but the editor has focus. Returns true
   * when the key went to the game (the caller should then preventDefault). Never Escape, Tab or shortcuts.
   */
  forwardKey(e: KeyLike & { type: string; repeat?: boolean }): boolean {
    if (!this.current?.ready || !shouldForwardKey(e)) return false;
    if (this.state !== 'running' && this.state !== 'title' && this.state !== 'won' && this.state !== 'lost') return false;
    const phase = e.type === 'keyup' ? 'up' : 'down';
    if (phase === 'down' && e.repeat) return isScrollKey(e);
    this.current.send({ type: 'key', phase, key: e.key, code: e.code, keyCode: keyCodeFor(e.key, e.code) });
    return true;
  }

  /** Let go of every forwarded key (call when the editor loses focus). */
  releaseKeys(): void {
    this.current?.send({ type: 'releaseKeys' });
  }

  /** Full screen for the stage wrapper (never the iframe, which cannot without its own gesture). */
  async requestFullscreen(): Promise<void> {
    if (document.fullscreenElement !== this.container) await this.container.requestFullscreen();
    this.focus();
  }

  async exitFullscreen(): Promise<void> {
    if (document.fullscreenElement) await document.exitFullscreen();
  }

  // ---------------------------------------------------------------- robot test

  /**
   * Plays a game for `gameMs` of game time in a hidden player on a manual clock, with a scripted bot
   * (move, jump, shoot, click around), and reports errors, events and whether anything moved.
   * Uses the warm spare when there is one; the visible game is not touched.
   */
  async robotTest(bundle: GameBundle, options: Omit<RobotTestOptions, 'runtimeUrl' | 'bundle' | 'frame'> = {}): Promise<RobotReport> {
    const frame = this.takeSpare();
    try {
      return await runRobotTest({ ...options, runtimeUrl: this.runtimeUrl, bundle, frame: frame ?? undefined, host: this.container });
    } finally {
      this.scheduleSpare(2000);
    }
  }

  // ---------------------------------------------------------------- frames

  /** Boots a spare iframe now so the next load is fast. */
  prewarm(): void {
    if (this.destroyed || this.spare?.alive) return;
    this.spare = this.newFrame(true);
  }

  private scheduleSpare(delay: number): void {
    if (!this.prewarmEnabled || this.destroyed) return;
    window.clearTimeout(this.spareTimer);
    this.spareTimer = window.setTimeout(() => this.prewarm(), delay);
  }

  private takeSpare(): PlayerFrame | null {
    const spare = this.spare;
    this.spare = null;
    return spare?.alive ? spare : null;
  }

  private newFrame(hidden: boolean): PlayerFrame {
    return new PlayerFrame(this.container, { runtimeUrl: this.runtimeUrl, title: this.title, hidden });
  }

  private bind(frame: PlayerFrame): void {
    frame.setEvents({
      message: (msg) => {
        if (frame === this.current) this.handle(msg);
      },
      navigated: () => {
        if (frame !== this.current) return;
        this.emit('navigated');
        this.navigations++;
        if (this.navigations > 1 || !this.bundle) {
          // It did it again: stop here instead of rebuilding forever.
          const error: PlayerError = { phase: 'uncaught', message: "The game keeps trying to open a web page. Games can't do that, so Amble stopped it.", count: this.navigations, fatal: true };
          this.errors.push(error);
          this.emit('error', error);
          this.setState('crashed');
          frame.destroy();
          this.current = null;
          this.pending?.reject(new Error(error.message));
          this.pending = null;
          this.scheduleSpare(500);
          return;
        }
        this.emit('warn', "Games can't open web pages or use the internet, so Amble restarted it.", {});
        const again = this.bundle;
        void this.load(again).catch(() => undefined);
      },
      failed: (message) => {
        if (frame !== this.current) return;
        this.setState('crashed');
        const error: PlayerError = { phase: 'load', message, count: 1, fatal: true };
        this.errors.push(error);
        this.emit('error', error);
        this.pending?.reject(new Error(message));
        this.pending = null;
      },
    });
  }

  private initMessage(bundle: GameBundle): InitMessage {
    return {
      type: 'init',
      mode: 'play',
      files: bundle.files,
      art: bundle.art ?? [],
      sounds: bundle.sounds ?? [],
      fonts: bundle.fonts ?? [],
      dials: bundle.dials ?? {},
      twists: bundle.twists ?? [],
      storage: bundle.storage ?? {},
      prefs: this.prefs,
      autostart: bundle.autostart ?? false,
    };
  }

  private finishLeaving(): void {
    for (const old of this.leaving) old.destroy();
    this.leaving = [];
  }

  private handle(msg: FromPlayer): void {
    switch (msg.type) {
      case 'booted':
        this.emit('booted', { renderer: msg.renderer, gpu: msg.gpu, maxTexture: msg.maxTexture });
        break;
      case 'manifest':
        this.manifest = msg.manifest;
        this.emit('manifest', msg.manifest);
        break;
      case 'firstFrame': {
        this.finishLeaving();
        const ms = Math.round(performance.now() - this.loadStartedAt);
        this.emit('firstFrame', ms);
        this.pending?.resolve();
        this.pending = null;
        this.scheduleSpare(2000);
        break;
      }
      case 'state':
        this.setState(msg.state);
        if (msg.state === 'crashed' && this.pending) {
          // Broken before its first frame: show the new realm (with its "Oops!" panel), not the old game.
          this.finishLeaving();
          this.pending.reject(new Error(this.errors[0]?.message ?? 'The game stopped with an error.'));
          this.pending = null;
        }
        break;
      case 'event':
        this.emit('event', msg.event);
        break;
      case 'error': {
        const known = this.errors.find((e) => e.message === msg.error.message && e.file === msg.error.file && e.line === msg.error.line);
        if (known) known.count = msg.error.count;
        else this.errors.push(msg.error);
        this.emit('error', msg.error);
        break;
      }
      case 'warn':
        this.emit('warn', msg.message, { file: msg.file, line: msg.line });
        break;
      case 'log':
        this.emit('log', msg.level, msg.message);
        break;
      case 'artMissing':
        this.emit('artMissing', msg.need);
        break;
      case 'artClicked':
        this.emit('artClicked', msg.key, msg.rect);
        break;
      case 'swapped':
        this.emit('swapped', { key: msg.key, objects: msg.objects, ms: msg.ms });
        break;
      case 'storage':
        if (this.bundle) this.bundle.storage = msg.data;
        this.emit('storage', msg.data);
        break;
      case 'stats':
        this.stats = msg.stats;
        this.emit('stats', msg.stats);
        break;
      case 'audio':
        this.emit('audio', msg.state);
        break;
      case 'csp':
        this.emit('csp', { directive: msg.directive, blocked: msg.blocked });
        this.emit('warn', "Games can't use the internet, so that was blocked.", {});
        break;
      case 'escape':
        this.emit('escape');
        break;
      case 'objects':
        this.emit('objects', msg.items);
        break;
      case 'snapshot':
        this.emit('snapshot', msg.png);
        break;
      default:
        break;
    }
  }

  private checkFrozen(): void {
    const frame = this.current;
    if (!frame?.ready || document.visibilityState === 'hidden') return;
    if (this.state !== 'running' && this.state !== 'title' && this.state !== 'loading') return;
    // A pre-warmed spare may have been quiet for a long time before this load started: count from the load.
    const quiet = performance.now() - Math.max(frame.lastMessageAt, this.state === 'loading' ? this.loadStartedAt : 0);
    if (quiet < this.frozenAfterMs) return;
    const error: PlayerError = { phase: 'frozen', message: 'The game froze (a loop that never ends?), so Amble stopped it.', count: 1, fatal: true };
    this.errors.push(error);
    this.emit('error', error);
    this.setState('crashed');
    frame.destroy();
    this.current = null;
    this.pending?.reject(new Error(error.message));
    this.pending = null;
    this.scheduleSpare(500);
  }

  /** Removes the iframes and stops everything. */
  destroy(): void {
    this.destroyed = true;
    window.clearInterval(this.watchdog);
    window.clearTimeout(this.spareTimer);
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.current?.destroy();
    this.spare?.destroy();
    this.finishLeaving();
    this.current = null;
    this.spare = null;
    this.pending?.reject(new Error('This player was destroyed.'));
    this.pending = null;
    this.setState('idle');
  }

  /** For tests and diagnostics: the visible iframe. */
  get iframe(): HTMLIFrameElement | null {
    return this.current?.iframe ?? null;
  }

  /** For tests and diagnostics: sends a raw protocol message to the visible game. */
  send(msg: ToPlayer): void {
    this.current?.send(msg);
  }
}

function cloneBundle(b: GameBundle): GameBundle {
  return {
    ...b,
    files: b.files.map((f) => ({ ...f })),
    art: b.art ? [...b.art] : [],
    sounds: b.sounds ? [...b.sounds] : [],
    fonts: b.fonts ? [...b.fonts] : [],
    dials: { ...b.dials },
    twists: [...(b.twists ?? [])],
    storage: { ...b.storage },
  };
}
