/**
 * `PlayerHost` (§6.4, §8.4; FOUNDATION): the app's one door to games. It wraps the core `Player` (one
 * visible player plus one warm spare). The visible iframe lives in the fixed PlayerLayer at the app root
 * and is positioned (never re-parented, which would reload it) over whichever slot the current screen
 * registers. When no slot is visible the game is paused; the core pauses it when the tab is hidden.
 */
import {
  DEFAULT_PLAYER_PREFS,
  EMPTY_MANIFEST,
  PLAYER_CORE,
  Player,
  RUNTIME_URL,
  type DrawnArt,
  type FromPlayer,
  type GameBundle,
  type GameManifest,
  type InitMessage,
  type PlayerPrefs,
  type RobotRaw,
  type RobotReport,
  type RobotVerdict,
  type ToPlayer,
  type WorldObject,
} from '../../cores/play';

export type SlotId = 'world' | 'desk-preview' | 'code' | 'gallery' | 'handin';

export interface PlayerHost {
  /** Positions the visible iframe over `el`; returns detach. The last attached slot wins. */
  attach(slot: SlotId, el: HTMLElement): () => void;
  /** A fresh realm from the spare; resolves on firstFrame with the game's manifest. */
  load(init: InitMessage): Promise<GameManifest>;
  /** In the spare, on a manual clock (the visible game is untouched). */
  robot(init: InitMessage): Promise<{ raw: RobotRaw; verdict: RobotVerdict }>;
  /** Shows the last robot-tested game. */
  promote(): Promise<GameManifest>;
  manifest(): GameManifest | null;
  swapArt(art: DrawnArt): void;
  clearArt(key: string): void;
  dial(key: string, value: number): void;
  twist(id: string, on: boolean): void;
  prefs(p: Partial<PlayerPrefs>): void;
  pause(): void;
  resume(): void;
  restartLevel(): void;
  /** Step-5 additions (M2 implements them in the runtime; until then they do nothing). */
  setMode(m: 'play' | 'change'): void;
  select(id: number | null): void;
  celebrate(key: string): void;
  step(frames: number): void;
  /** A PNG of the current frame, or null (until M2 lands, and when no game runs). */
  snapshot(maxW: number): Promise<Blob | null>;
  key(phase: 'down' | 'up', e: KeyboardEvent): void;
  releaseKeys(): void;
  focus(): void;
  /** Full screen for the game: the page goes full screen and `el` fills it (the iframe follows). */
  fullscreen(el: HTMLElement): Promise<void>;
  /** The iframe's accessible name ("Moon King (game)"). An addition to the spec's interface. */
  setTitle(title: string): void;
  on<T extends FromPlayer['type']>(type: T, fn: (m: Extract<FromPlayer, { type: T }>) => void): () => void;
  /** Change mode's object reports (4 Hz, ≤ 64 items); `on('objects', …)` in one call (§8.3 step 5). */
  onObjects(fn: (items: WorldObject[]) => void): () => void;
}

type AnyListener = (m: FromPlayer) => void;

const SNAPSHOT_TIMEOUT_MS = 800;
const MANIFEST_WAIT_MS = 2000;

/** GameBundle for the core Player from an init message. */
export function bundleOf(init: InitMessage): GameBundle {
  return {
    files: init.files,
    art: init.art,
    sounds: init.sounds,
    fonts: init.fonts,
    dials: init.dials,
    twists: init.twists,
    storage: init.storage,
    autostart: init.autostart,
  };
}

function verdictOf(report: RobotReport): { raw: RobotRaw; verdict: RobotVerdict } {
  const { pass, reasons, notes, moved, blank, ...raw } = report;
  return { raw, verdict: { pass, reasons, notes, moved, blank } };
}

function deviceMemory(): number {
  return (typeof navigator === 'undefined' ? undefined : (navigator as { deviceMemory?: number }).deviceMemory) ?? 8;
}

export interface PlayerHostOptions {
  runtimeUrl?: string;
  /** Keep a warm spare (default: unless the device has under 4 GB). */
  prewarm?: boolean;
}

export class PlayerHostImpl implements PlayerHost {
  private player: Player | null = null;
  private layer: HTMLElement | null = null;
  private layerWaiters: Array<(el: HTMLElement) => void> = [];
  private readonly slots: Array<{ slot: SlotId; el: HTMLElement }> = [];
  private readonly listeners = new Map<string, Set<AnyListener>>();
  private prefsNow: PlayerPrefs = { ...DEFAULT_PLAYER_PREFS };
  private lastRobot: InitMessage | null = null;
  private title = 'Game';
  private userPaused = false;
  private autoPaused = false;
  private observer: ResizeObserver | null = null;
  private raf = 0;
  private hotUntil = 0;
  private nextCheck = 0;
  private lastRect = '';
  private fullscreenEl: HTMLElement | null = null;

  constructor(private readonly o: PlayerHostOptions = {}) {}

  // ---------------------------------------------------------------- the layer and the slots

  /** Called by the PlayerLayer component with its fixed container. */
  mountLayer(el: HTMLElement): () => void {
    this.layer = el;
    for (const resolve of this.layerWaiters.splice(0)) resolve(el);
    this.place();
    return () => {
      if (this.layer === el) this.layer = null;
    };
  }

  private waitForLayer(): Promise<HTMLElement> {
    return this.layer ? Promise.resolve(this.layer) : new Promise((resolve) => this.layerWaiters.push(resolve));
  }

  attach(slot: SlotId, el: HTMLElement): () => void {
    const entry = { slot, el };
    this.slots.push(entry);
    this.observer ??= typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => this.heat());
    this.observer?.observe(el);
    this.heat();
    this.startTracking();
    return () => {
      const i = this.slots.indexOf(entry);
      if (i >= 0) this.slots.splice(i, 1);
      this.observer?.unobserve(el);
      this.heat();
      this.place();
    };
  }

  private activeSlot(): { slot: SlotId; el: HTMLElement } | null {
    return this.slots[this.slots.length - 1] ?? null;
  }

  private heat(): void {
    this.hotUntil = performance.now() + 1000;
    this.nextCheck = 0;
    this.startTracking();
  }

  private startTracking(): void {
    if (this.raf || typeof requestAnimationFrame === 'undefined') return;
    const tick = () => {
      this.raf = 0;
      const now = performance.now();
      if (now >= this.nextCheck) {
        this.place();
        this.nextCheck = now < this.hotUntil ? 0 : now + 250;
      }
      if (this.slots.length) this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  /** Puts the layer over the active slot, or hides it (and pauses the game) when there is none. */
  private place(): void {
    const layer = this.layer;
    if (!layer) return;
    const active = this.activeSlot();
    const r = active?.el.isConnected ? active.el.getBoundingClientRect() : null;
    const visible = !!r && r.width > 1 && r.height > 1;
    const key = visible && r ? `${active?.slot}:${r.left},${r.top},${r.width},${r.height}` : 'hidden';
    if (key === this.lastRect) return;
    this.lastRect = key;
    this.heat();
    if (visible && r && active) {
      Object.assign(layer.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px`, visibility: 'visible' });
      layer.dataset.slot = active.slot;
      if (this.autoPaused && !this.userPaused) this.player?.resume();
      this.autoPaused = false;
    } else {
      layer.style.visibility = 'hidden';
      layer.dataset.slot = 'none';
      if (this.player && !this.autoPaused && (this.player.state === 'running' || this.player.state === 'title')) {
        this.player.pause();
        this.autoPaused = true;
      }
    }
  }

  // ---------------------------------------------------------------- the core player

  private async ensure(): Promise<Player> {
    if (this.player) return this.player;
    const container = await this.waitForLayer();
    if (this.player) return this.player;
    const player = new Player({
      container,
      runtimeUrl: this.o.runtimeUrl ?? RUNTIME_URL,
      title: this.title,
      prefs: this.prefsNow,
      prewarm: this.o.prewarm ?? deviceMemory() >= 4,
    });
    this.player = player;
    this.bridge(player);
    return player;
  }

  private emit(m: FromPlayer): void {
    const layer = this.layer;
    if (layer && m.type === 'state') layer.dataset.state = m.state;
    if (layer && m.type === 'firstFrame') layer.dataset.firstFrame = String(Date.now());
    for (const fn of this.listeners.get(m.type) ?? []) {
      try {
        fn(m);
      } catch (err) {
        console.error(err);
      }
    }
  }

  /** Turns the core's events back into protocol messages for `on()`. */
  private bridge(p: Player): void {
    p.on('state', (state) => state !== 'idle' && this.emit({ type: 'state', state }));
    p.on('manifest', (manifest) => this.emit({ type: 'manifest', manifest }));
    p.on('firstFrame', () => this.emit({ type: 'firstFrame' }));
    p.on('booted', (info) => this.emit({ type: 'booted', ...info }));
    p.on('error', (error) => this.emit({ type: 'error', error }));
    p.on('warn', (message, where) => this.emit({ type: 'warn', message, ...where }));
    p.on('log', (level, message) => this.emit({ type: 'log', level, message }));
    p.on('event', (event) => this.emit({ type: 'event', event }));
    p.on('artMissing', (need) => this.emit({ type: 'artMissing', need }));
    p.on('artClicked', (key, rect) => this.emit({ type: 'artClicked', key, rect }));
    p.on('swapped', (info) => this.emit({ type: 'swapped', ...info }));
    p.on('storage', (data) => this.emit({ type: 'storage', data }));
    p.on('stats', (stats) => this.emit({ type: 'stats', stats }));
    p.on('audio', (state) => this.emit({ type: 'audio', state }));
    p.on('csp', (info) => this.emit({ type: 'csp', ...info }));
    p.on('escape', () => this.emit({ type: 'escape' }));
    // The step-5 replies arrive once M2 adds them to the core's events.
    const on = p.on as unknown as (name: string, fn: (value: unknown) => void) => () => void;
    try {
      on.call(p, 'objects', (items) => this.emit({ type: 'objects', items: items as Extract<FromPlayer, { type: 'objects' }>['items'] }));
      on.call(p, 'snapshot', (png) => this.emit({ type: 'snapshot', png: png as Blob }));
    } catch {
      // Not there yet: setMode/select/snapshot stay no-ops.
    }
  }

  private send(msg: ToPlayer): void {
    this.player?.send(msg);
  }

  // ---------------------------------------------------------------- running games

  async load(init: InitMessage): Promise<GameManifest> {
    const player = await this.ensure();
    this.prefs(init.prefs);
    this.userPaused = false;
    this.autoPaused = false;
    if (PLAYER_CORE === 'stub') return EMPTY_MANIFEST;
    let offManifest: () => void = () => undefined;
    const manifest = new Promise<GameManifest>((resolve) => {
      offManifest = player.on('manifest', resolve);
    });
    try {
      await player.load(bundleOf(init));
      if (player.manifest) return player.manifest;
      return await Promise.race([manifest, new Promise<GameManifest>((resolve) => setTimeout(() => resolve(EMPTY_MANIFEST), MANIFEST_WAIT_MS))]);
    } finally {
      offManifest();
      this.place();
    }
  }

  async robot(init: InitMessage): Promise<{ raw: RobotRaw; verdict: RobotVerdict }> {
    const player = await this.ensure();
    this.lastRobot = init;
    const report = await player.robotTest(bundleOf(init), { gameMs: init.robot?.gameMs ?? 6000, seed: init.robot?.seed ?? 1, bot: init.robot?.bot ?? 'auto' });
    return verdictOf(report);
  }

  async promote(): Promise<GameManifest> {
    const tested = this.lastRobot;
    if (!tested) throw new Error('There is no robot-tested game to show.');
    const { robot: _robot, ...rest } = tested;
    return this.load({ ...rest, mode: 'play', prefs: this.prefsNow, autostart: true });
  }

  manifest(): GameManifest | null {
    return this.player?.manifest ?? null;
  }

  swapArt(art: DrawnArt): void {
    this.player?.swapArt(art);
  }

  clearArt(key: string): void {
    this.player?.clearArt(key);
  }

  dial(key: string, value: number): void {
    this.player?.setDial(key, value);
  }

  twist(id: string, on: boolean): void {
    this.player?.setTwist(id, on);
  }

  prefs(p: Partial<PlayerPrefs>): void {
    this.prefsNow = { ...this.prefsNow, ...p };
    this.player?.setPrefs(p);
  }

  pause(): void {
    this.userPaused = true;
    this.player?.pause();
  }

  resume(): void {
    this.userPaused = false;
    if (!this.autoPaused) this.player?.resume();
  }

  restartLevel(): void {
    this.player?.restartLevel();
  }

  setMode(mode: 'play' | 'change'): void {
    this.send({ type: 'mode', mode });
  }

  select(id: number | null): void {
    this.send({ type: 'select', id });
  }

  celebrate(key: string): void {
    this.send({ type: 'celebrate', key });
  }

  step(frames: number): void {
    this.send({ type: 'step', frames: Math.max(0, Math.round(frames)) });
  }

  snapshot(maxW: number): Promise<Blob | null> {
    if (!this.player || PLAYER_CORE === 'stub') return Promise.resolve(null);
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        off();
        resolve(null);
      }, SNAPSHOT_TIMEOUT_MS);
      const off = this.on('snapshot', (m) => {
        clearTimeout(timer);
        off();
        resolve(m.png);
      });
      this.send({ type: 'snapshot', maxW });
    });
  }

  key(phase: 'down' | 'up', e: KeyboardEvent): void {
    this.player?.forwardKey({ type: phase === 'down' ? 'keydown' : 'keyup', key: e.key, code: e.code, repeat: e.repeat, ctrlKey: e.ctrlKey, metaKey: e.metaKey, altKey: e.altKey });
  }

  releaseKeys(): void {
    this.player?.releaseKeys();
  }

  focus(): void {
    this.player?.focus();
  }

  async fullscreen(el: HTMLElement): Promise<void> {
    if (this.fullscreenEl) this.fullscreenEl.removeAttribute('data-player-fullscreen');
    this.fullscreenEl = el;
    el.setAttribute('data-player-fullscreen', '');
    const leave = () => {
      if (document.fullscreenElement) return;
      el.removeAttribute('data-player-fullscreen');
      if (this.fullscreenEl === el) this.fullscreenEl = null;
      document.removeEventListener('fullscreenchange', leave);
      this.heat();
    };
    document.addEventListener('fullscreenchange', leave);
    try {
      if (!document.fullscreenElement) await document.documentElement.requestFullscreen();
    } catch (err) {
      el.removeAttribute('data-player-fullscreen');
      document.removeEventListener('fullscreenchange', leave);
      this.fullscreenEl = null;
      throw err;
    }
    this.heat();
    this.focus();
  }

  setTitle(title: string): void {
    this.title = title;
    this.player?.setTitle(title);
  }

  on<T extends FromPlayer['type']>(type: T, fn: (m: Extract<FromPlayer, { type: T }>) => void): () => void {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    const listener = fn as AnyListener;
    set.add(listener);
    return () => set.delete(listener);
  }

  onObjects(fn: (items: WorldObject[]) => void): () => void {
    return this.on('objects', (m) => fn(m.items));
  }

  /** Tears everything down (tests, "Delete everything"). */
  destroy(): void {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.observer?.disconnect();
    this.player?.destroy();
    this.player = null;
  }
}
