/**
 * The world screen's link to the running game (§2.6): while the screen is up it listens to the player
 * (state, problems, taps on "just bones" characters, objects, game events, stats, storage), decides when
 * the request tag may ask for a drawing, loads a waiting new version at the next pause, and takes the
 * Trail sign's snapshot when the student leaves the world.
 *
 * One controller runs at a time; the World screen starts it on mount and stops it on unmount.
 */
import { getServices } from '../app/services';
import type { FromPlayer, GameEvent, GameState, WorldObject } from '../cores/play';
import { keepGameStorage } from '../model/gameStorage';
import type { CastKey, WorldId } from '../model/types';
import {
  addProblem,
  flushWorld,
  isLoaded,
  loadGame,
  noteLoaded,
  openWorld,
  patchSession,
  playNewVersion,
  refreshCast,
  updateWorld,
} from '../state/session';
import { getState } from '../state/store';
import { sameObjects, type Box } from './objects';
import { pickRequest, triggerOf, type TagTrigger } from './requestPolicy';

export const HEAVY_FPS = 20;
export const HEAVY_AFTER_MS = 10_000;
/** The request tag hides by itself after this long. */
export const REQUEST_SHOWS_MS = 15_000;
export const SNAPSHOT_WIDTH = 320;
const SNAPSHOT_WAIT_MS = 4000;

export interface ControllerHooks {
  /** A tap on a "just bones" member in the running game (frame px): lift it onto the Desk. */
  onLift(key: CastKey, rect: Box): void;
  /** Esc inside the game: leave full screen, or take focus back to the editor. */
  onEscape(): void;
}

/** A Warm-up world's code (§2.5): the cast idles while the build runs. */
export function isWarmup(code: { path: string; source: string }[]): boolean {
  return code.some((f) => f.path === 'game.js' && f.source.startsWith('// Warm-up:'));
}

/** Whether a game's code reads the pointer (taps are gameplay: the coach mark says "Pause, then tap"). */
export function readsPointer(code: { source: string }[]): boolean {
  return code.some((f) => /aim\s*:\s*['"]pointer['"]|\bpointer(down|up|move)\b|activePointer|controls\.pointer|input\.on\(|physics\s*:\s*['"]matter['"]/.test(f.source));
}

/** A PNG of the running game, waiting longer than PlayerHost.snapshot's own timeout (slow GPUs). */
export function takeSnapshot(maxW = SNAPSHOT_WIDTH, waitMs = SNAPSHOT_WAIT_MS): Promise<Blob | null> {
  const { player } = getServices();
  return new Promise((resolve) => {
    let done = false;
    const finish = (png: Blob | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      off();
      resolve(png);
    };
    const timer = setTimeout(() => finish(null), waitMs);
    const off = player.on('snapshot', (m) => finish(m.png));
    void player.snapshot(maxW).then((png) => {
      if (png) finish(png);
    });
  });
}

export class WorldController {
  private offs: Array<() => void> = [];
  private shownAt: Record<CastKey, number> = {};
  private seen = new Set<CastKey>();
  private lastLives: number | null = null;
  private slowSince = 0;
  private requestTimer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  /** The editor paused the game itself (the lift): that pause is not the student's. */
  private editorPause = false;
  /** Objects reports the editor asked for (a step answers with one): they are not idle signals. */
  private asked = 0;

  constructor(
    readonly worldId: WorldId,
    private readonly hooks: ControllerHooks,
  ) {}

  /** Opens the world and starts its game, unless the player already runs it (back from the Desk). */
  async start(): Promise<void> {
    this.listen();
    const world = await openWorld(this.worldId);
    if (this.stopped || !world) return;
    if (isLoaded(world)) {
      const { player } = getServices();
      patchSession({ ready: true, manifest: player.manifest() ?? getState().session.manifest });
      refreshCast();
      return;
    }
    await loadGame(world);
    if (this.stopped) return;
    if (isWarmup(getState().session.world?.code ?? [])) this.trigger('warmup');
  }

  /** Stops listening, writes pending changes, and (when leaving the world) snapshots the Trail sign. */
  stop(): void {
    this.stopped = true;
    for (const off of this.offs.splice(0)) off();
    if (this.requestTimer) clearTimeout(this.requestTimer);
    const s = getState().session;
    if (s.mode === 'change') {
      const { player } = getServices();
      player.select(null);
      player.setMode('play');
      patchSession({ mode: 'play', selected: null, selectedId: null, scope: null, objects: [] });
    }
    patchSession({ request: null });
    void flushWorld();
    const route = getState().app.route;
    const staying = 'worldId' in route && route.worldId === this.worldId;
    if (!staying && s.world?.id === this.worldId && s.ready && !s.stopped) void this.saveSnapshot();
  }

  private async saveSnapshot(): Promise<void> {
    const png = await takeSnapshot();
    if (!png) return;
    const { store } = getServices();
    try {
      const { blobRefOf } = await import('../model/ids');
      const ref = await blobRefOf(png);
      await store.commit({ blobs: [png], snapshots: { [this.worldId]: ref } });
    } catch (err) {
      console.warn('The Trail sign snapshot was not saved:', err);
    }
  }

  // ---------------------------------------------------------------- player events

  private on<T extends FromPlayer['type']>(type: T, fn: (m: Extract<FromPlayer, { type: T }>) => void): void {
    this.offs.push(getServices().player.on(type, fn));
  }

  private listen(): void {
    this.on('state', (m) => this.onState(m.state));
    this.on('manifest', (m) => {
      if (getState().session.world?.id !== this.worldId) return;
      patchSession({ manifest: m.manifest });
      refreshCast();
    });
    this.on('firstFrame', () => {
      patchSession({ ready: true, snapshot: null, stopped: null });
      noteLoaded();
    });
    this.on('error', (m) => {
      addProblem(m.error);
      if (m.error.phase === 'frozen' || /keeps trying to open a web page/.test(m.error.message)) patchSession({ stopped: 'crashed' });
    });
    this.on('warn', (m) => {
      if (/^Games can't open web pages/.test(m.message)) patchSession({ stopped: 'navigated' });
    });
    this.on('artClicked', (m) => {
      if (getState().session.mode !== 'play') return;
      this.pauseForEditor();
      this.hooks.onLift(m.key, m.rect);
    });
    this.on('objects', (m) => this.onObjects(m.items));
    this.on('event', (m) => this.onEvent(m.event));
    this.on('stats', (m) => this.onStats(m.stats.fps, m.stats.state));
    this.on('storage', (m) => {
      // Game code decides what it saves, so the world keeps only what fits its budget (§4.8).
      const kept = keepGameStorage(m.data);
      updateWorld((w) => {
        w.gameStorage = kept;
      }, { touch: false });
    });
    this.on('escape', () => this.hooks.onEscape());
    const onHide = () => {
      if (document.visibilityState === 'hidden') void flushWorld();
    };
    document.addEventListener('visibilitychange', onHide);
    this.offs.push(() => document.removeEventListener('visibilitychange', onHide));
  }

  /** Pauses the game for something the editor does (the lift): no request tag for this pause. */
  pauseForEditor(): void {
    this.editorPause = true;
    getServices().player.pause();
  }

  private onState(state: GameState): void {
    const s = getState().session;
    patchSession({ player: state });
    if (state === 'running') {
      this.editorPause = false;
      if (s.stopped === 'navigated') patchSession({ stopped: null });
    }
    // Pauses the editor made (Change mode, the lift) are not the student's pause.
    if (s.mode !== 'play' || this.editorPause) return;
    if (state === 'paused' && s.player !== 'paused') this.trigger('paused');
    if (state === 'won') this.trigger('won');
    if (state === 'lost') this.trigger('lost');
  }

  private onObjects(items: WorldObject[]): void {
    for (const it of items) if (it.key) this.seen.add(it.key);
    const s = getState().session;
    // Change mode streams the frozen game 4 times a second: when nothing moved there is nothing to redraw,
    // so a world left in Change mode costs no renders.
    if (s.mode === 'change' && sameObjects(s.objects, items)) return;
    patchSession({ objects: items });
    if (s.mode === 'change') {
      refreshCast();
      return;
    }
    if (this.asked > 0) {
      this.asked--;
      refreshCast();
      return;
    }
    // In Play mode a report nobody asked for means 5 s without input.
    if (s.player === 'running' || s.player === 'title') this.trigger('idle');
  }

  /** Asks the game where everything is now (without moving time); resolves with the report, or null. */
  fetchObjects(ms = 700): Promise<WorldObject[] | null> {
    const { player } = getServices();
    this.asked++;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        off();
        this.asked = Math.max(0, this.asked - 1);
        resolve(null);
      }, ms);
      const off = player.onObjects((items) => {
        clearTimeout(timer);
        off();
        resolve(items);
      });
      player.step(0);
    });
  }

  private onEvent(e: GameEvent): void {
    const trigger = triggerOf(e, this.lastLives);
    if (e.kind === 'lives') this.lastLives = e.value;
    if (e.kind === 'start') this.lastLives = null;
    if (trigger) this.trigger(trigger);
  }

  private onStats(fps: number, state: GameState): void {
    if (state !== 'running' || getState().session.heavy) {
      this.slowSince = 0;
      return;
    }
    const now = performance.now();
    if (fps >= HEAVY_FPS) this.slowSince = 0;
    else if (!this.slowSince) this.slowSince = now;
    else if (now - this.slowSince >= HEAVY_AFTER_MS) patchSession({ heavy: true });
  }

  // ---------------------------------------------------------------- the request tag

  /** A moment when Amble may ask (and when a waiting new version loads). */
  trigger(trigger: TagTrigger): void {
    const s = getState().session;
    if (!s.world || s.world.id !== this.worldId || s.mode !== 'play') return;
    if (trigger !== 'warmup' && s.newVersion?.ready) {
      playNewVersion();
      return;
    }
    if (s.request) return;
    const now = Date.now();
    const member = pickRequest(s.cast, s.world, { trigger, now, shownAt: this.shownAt, seen: this.seen });
    if (!member) return;
    this.shownAt[member.key] = now;
    patchSession({ request: { key: member.key, trigger } });
    if (this.requestTimer) clearTimeout(this.requestTimer);
    if (trigger !== 'warmup') {
      this.requestTimer = setTimeout(() => {
        if (getState().session.request?.key === member.key) patchSession({ request: null });
      }, REQUEST_SHOWS_MS);
    }
  }
}
