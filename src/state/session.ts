/**
 * The `session` slice (M2): the world that is open, the game running it (manifest, state, problems), the
 * Cast, the save state, Change mode and its selection, the request tag, and the come-alive flight.
 *
 * Actions other modules call:
 * - `openWorld(id)` loads a world into the session (the same world keeps its session: coming back from
 *   the Desk never restarts the game), `loadGame(world)` runs it in the player;
 * - `updateWorld(recipe)` edits the open world and autosaves it (800 ms, then idle, §4.4);
 * - `setDial` / `setTwist` change the running game live and print footsteps (dial bursts merge, 1.5 s);
 * - `recordStep(step)` prints a footstep for the open world;
 * - `applyAccepted(outcome, { task, request })` puts an accepted AI change into the world (a footstep, new
 *   cast members with a NEW ribbon) and loads it at once, or at the next pause when the student is playing;
 * - `setComeAlive(c)` (M3, after Bring to life) starts the come-alive flight when the world shows again.
 */
import type { Draft } from 'immer';
import { playerPrefsFrom } from '../app/player/prefs';
import { isSupersededLoad } from '../app/player/host';
import { getServices } from '../app/services';
import type { GameManifest, GameState, WorldObject } from '../cores/play';
import { t } from '../i18n';
import type { AiOutcome, CastKey, CastMember, CastSlot, PlayerError, SaveState, StepInput, TwistId, World, WorldId } from '../model/types';
import { createAutosave, type Autosave } from '../store/autosave';
import { deriveCast } from '../world/cast';
import { DialBurst, type DialCommit } from '../world/dialBurst';
import { toInitMessage } from '../world/init';
import type { TagTrigger } from '../world/requestPolicy';
import { getState, setState, type ComeAlive } from './store';

export interface SessionSlice {
  world: World | null;
  manifest: GameManifest | null;
  cast: CastMember[];
  save: SaveState;
  player: GameState;
  problems: PlayerError[];
  mode: 'play' | 'change';
  /** The selected thing's cast key in Change mode. */
  selected: CastKey | null;
  /** Change mode's latest objects report (4 Hz). */
  objects: WorldObject[];
  comeAlive: ComeAlive | null;
  newVersion: { summary: string; ready: boolean } | null;
  /** The selected thing's object id (its tag and outline). */
  selectedId: number | null;
  /** The Ask card's scope chip ("About the Moon King ✕"); follows the selection until cleared. */
  scope: CastKey | null;
  /** This world's game has drawn its first frame (the Loading picture goes away). */
  ready: boolean;
  /** The game stopped: crashed or frozen ("The world stopped."), or it tried to leave its frame. */
  stopped: 'crashed' | 'navigated' | null;
  /** 10 s under 20 fps: "This world is heavy for this Chromebook." */
  heavy: boolean;
  /** The request tag: which member Amble is asking for, and why now. */
  request: { key: CastKey; trigger: TagTrigger } | null;
  /** Members the last AI change added (their cards wear a NEW ribbon). */
  fresh: CastKey[];
  /** Object URL of the world's last snapshot (shown dimmed while it loads). */
  snapshot: string | null;
}

export function initialSession(): SessionSlice {
  return {
    world: null,
    manifest: null,
    cast: [],
    save: 'saved',
    player: 'loading',
    problems: [],
    mode: 'play',
    selected: null,
    objects: [],
    comeAlive: null,
    newVersion: null,
    selectedId: null,
    scope: null,
    ready: false,
    stopped: null,
    heavy: false,
    request: null,
    fresh: [],
    snapshot: null,
  };
}

/** Writes a few session fields at once. */
export function patchSession(patch: Partial<SessionSlice>): void {
  setState((s) => {
    Object.assign(s.session, patch);
  });
}

function starterOf(world: World) {
  const o = world.origin;
  const id = o.kind === 'starter' || o.kind === 'plan' ? o.starter : o.kind === 'assignment' ? o.starter : null;
  if (!id) return null;
  try {
    return getServices().starters.info(id);
  } catch {
    return null;
  }
}

/** A member of the open world's Cast. */
export function getSessionMember(key: CastKey): CastMember | null {
  return getState().session.cast.find((m) => m.key === key) ?? null;
}

/** Re-derives the Cast from the manifest, the world's slots and the live counts. */
export function refreshCast(): void {
  const s = getState().session;
  if (!s.world) return;
  const counts: Record<string, number> = {};
  for (const o of s.objects) if (o.key && o.count) counts[o.key] = Math.max(counts[o.key] ?? 0, o.count);
  const cast = deriveCast(s.manifest, s.world, { starter: starterOf(s.world), counts });
  setState((d) => {
    d.session.cast = cast;
  });
}

// ------------------------------------------------------------------ saving

let autosave: Autosave | null = null;
let autosaveStore: unknown = null;

function saver(): Autosave {
  const { store } = getServices();
  if (!autosave || autosaveStore !== store) {
    autosave?.dispose();
    autosaveStore = store;
    autosave = createAutosave(store, {
      onState: (save) => patchSession({ save }),
      onError: (err) => console.warn('Autosave failed:', err),
    });
  }
  return autosave;
}

/** Edits the open world (immer recipe) and autosaves it. `touch: false` keeps `updatedAt` (UI-only fields). */
export function updateWorld(recipe: (w: Draft<World>) => void, o: { touch?: boolean; save?: boolean } = {}): World | null {
  if (!getState().session.world) return null;
  setState((s) => {
    const w = s.session.world;
    if (!w) return;
    recipe(w);
    if (o.touch !== false) w.updatedAt = Date.now();
  });
  const world = getState().session.world;
  if (world && o.save !== false) saver().schedule(world);
  return world;
}

/** Writes every pending change of the open world now (leaving it, hiding the tab). */
export async function flushWorld(): Promise<void> {
  bursts.flush();
  await autosave?.flush();
}

// ------------------------------------------------------------------ footsteps

/** Prints a footstep for the open world (Footsteps snapshots it) and saves the result. */
export async function recordStep(step: StepInput): Promise<World | null> {
  const world = getState().session.world;
  if (!world) return null;
  let next: World;
  try {
    next = await getServices().history.record(world, step);
  } catch (err) {
    console.warn('The footstep could not be recorded:', err);
    return world;
  }
  // Keep edits made while the step was being written (a dial still moving).
  const now = getState().session.world;
  if (!now || now.id !== next.id) return next;
  setState((s) => {
    const w = s.session.world;
    if (!w) return;
    w.steps = next.steps;
    w.head = next.head;
    w.updatedAt = Math.max(w.updatedAt, next.updatedAt);
  });
  const saved = getState().session.world;
  if (saved) saver().schedule(saved);
  return saved;
}

function dialText(c: DialCommit): string {
  const info = getState().session.manifest?.dials.find((d) => d.key === c.key);
  const label = info?.label ?? c.key;
  const value = `${formatDial(c.to)}${info?.unit ?? ''}`;
  return c.to > c.from ? t('world.stepDialUp', { label, value }) : t('world.stepDialDown', { label, value });
}

/** Dial values as students read them: whole numbers stay whole, others keep up to two decimals. */
export function formatDial(v: number): string {
  return Number.isInteger(v) ? String(v) : String(Math.round(v * 100) / 100);
}

const bursts = new DialBurst((c) => {
  void recordStep({ kind: 'dials', by: 'student', text: dialText(c) });
});

// ------------------------------------------------------------------ opening and running a world

/** What the running game was built from (code, sounds, controls): art, dials and twists change live. */
export function gameSignature(world: World): string {
  const text = JSON.stringify([world.id, world.code.map((f) => [f.path, f.source]), world.sounds, world.controls]);
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `${world.id}:${text.length}:${(h >>> 0).toString(36)}`;
}

let loaded: string | null = null;
let loading: Promise<GameManifest | null> | null = null;

/** Whether the player already runs this world as it is now (returning from the Desk). */
export function isLoaded(world: World): boolean {
  return loaded === gameSignature(world) && !getState().session.stopped;
}

/**
 * Loads a world into the session. The same world keeps its session (mode, objects, the come-alive
 * flight), refreshed from the store when something else saved a newer version (the Desk, a build).
 */
export async function openWorld(id: WorldId): Promise<World | null> {
  const { store } = getServices();
  const current = getState().session.world;
  if (current?.id === id) {
    await autosave?.flush();
    const stored = await store.worlds.get(id).catch(() => null);
    if (stored && stored.updatedAt > current.updatedAt) {
      setState((s) => {
        s.session.world = stored;
      });
      refreshCast();
    }
    return getState().session.world;
  }
  bursts.flush();
  await autosave?.flush();
  const world = await store.worlds.get(id);
  loaded = null;
  setState((s) => {
    Object.assign(s.session, initialSession());
    s.session.world = world ? { ...world, openedAt: Date.now() } : null;
  });
  if (world) {
    refreshCast();
    // Footsteps: a world is born with a first step but no snapshot of it.
    void getServices()
      .history.ensureHead(world)
      .catch(() => undefined);
    void store.worlds
      .list()
      .then((metas) => metas.find((m) => m.id === id)?.snapshot ?? null)
      .then((ref) => (ref ? store.blobs.url(ref) : null))
      .then((url) => {
        if (url && getState().session.world?.id === id && !getState().session.ready) patchSession({ snapshot: url });
      })
      .catch(() => undefined);
  }
  return getState().session.world;
}

/** Runs the open world in the player (a fresh realm from the warm spare); resolves with its manifest. */
export function loadGame(world: World, o: { autostart?: boolean } = {}): Promise<GameManifest | null> {
  const { player } = getServices();
  const sig = gameSignature(world);
  patchSession({ ready: false, stopped: null, problems: [], newVersion: null, heavy: false });
  const run = (async () => {
    player.setTitle(t('world.gameTitle', { title: world.title }));
    const init = await toInitMessage(world, { mode: 'play', prefs: playerPrefsFrom(getState().prefs), autostart: o.autostart ?? false });
    try {
      const manifest = await player.load(init);
      loaded = sig;
      if (getState().session.world?.id === world.id) {
        patchSession({ manifest, ready: true });
        refreshCast();
        // Tells the runtime the editor is here, in Play mode (idle reports and ghost taps start).
        player.setMode(getState().session.mode);
      }
      return manifest;
    } catch (err) {
      if (isSupersededLoad(err)) return null;
      loaded = null;
      if (getState().session.world?.id === world.id) patchSession({ stopped: 'crashed', ready: true });
      console.warn('The world could not start:', err);
      return null;
    }
  })();
  loading = run;
  void run.finally(() => {
    if (loading === run) loading = null;
  });
  return run;
}

/** The running load, if any (the World screen waits on it before measuring things). */
export function pendingLoad(): Promise<GameManifest | null> | null {
  return loading;
}

/**
 * Someone else put the open world into play (Footsteps' Go back, Look inside's Run it): the player runs
 * the session's world as it is now, so coming back from the Desk needs no reload.
 */
export function noteLoaded(): void {
  const world = getState().session.world;
  if (world && !loading) loaded = gameSignature(world);
}

// ------------------------------------------------------------------ live changes: dials, twists, modes

/** Turns a dial live; one footstep per dial after 1.5 s of rest ("You turned Orb speed down to 160"). */
export function setDial(key: string, value: number): void {
  const s = getState().session;
  if (!s.world || !Number.isFinite(value)) return;
  const info = s.manifest?.dials.find((d) => d.key === key);
  const before = s.world.dials[key] ?? info?.current ?? info?.value ?? value;
  updateWorld((w) => {
    w.dials[key] = value;
  });
  setState((d) => {
    const dial = d.session.manifest?.dials.find((x) => x.key === key);
    if (dial) dial.current = value;
  });
  getServices().player.dial(key, value);
  bursts.change(key, before, value);
}

/** A dial back to the game's own value (the ↺ on a focused dial). */
export function resetDial(key: string): void {
  const info = getState().session.manifest?.dials.find((d) => d.key === key);
  if (info) setDial(key, info.value);
}

/** Switches a twist live and prints a footstep ("You switched on Moon gravity"). */
export function setTwist(id: TwistId, on: boolean): void {
  const s = getState().session;
  if (!s.world) return;
  if (s.world.twists.includes(id) === on) {
    getServices().player.twist(id, on);
    return;
  }
  updateWorld((w) => {
    w.twists = on ? [...new Set([...w.twists, id])] : w.twists.filter((x) => x !== id);
  });
  setState((d) => {
    const tw = d.session.manifest?.twists.find((x) => x.id === id);
    if (tw) tw.on = on;
  });
  getServices().player.twist(id, on);
  const name = s.manifest?.twists.find((x) => x.id === id)?.name ?? id;
  void recordStep({ kind: 'twists', by: 'student', text: on ? t('world.stepTwistOn', { name }) : t('world.stepTwistOff', { name }) });
}

/** Play or Change (§2.7): Change pauses the world and streams its things; Play resumes it. */
export function setMode(mode: 'play' | 'change'): void {
  const s = getState().session;
  if (s.mode === mode) return;
  const { player } = getServices();
  if (mode === 'change') {
    player.pause();
    player.setMode('change');
    patchSession({ mode, request: null });
    return;
  }
  player.select(null);
  player.setMode('play');
  patchSession({ mode, selected: null, selectedId: null, scope: null, objects: [] });
  player.resume();
}

/** Selects a thing in Change mode (null closes its card); the Ask field scopes to it. */
export function selectThing(thing: { id: number; key: CastKey } | null): void {
  getServices().player.select(thing?.id ?? null);
  patchSession({ selectedId: thing?.id ?? null, selected: thing?.key ?? null, scope: thing?.key ?? null });
}

export function setScope(scope: CastKey | null): void {
  patchSession({ scope });
}

/** A problem from the running game: the same error again only counts up. */
export function addProblem(error: PlayerError): void {
  setState((s) => {
    const same = s.session.problems.find((p) => p.message === error.message && p.file === error.file && p.line === error.line && p.twist === error.twist);
    if (same) same.count = Math.max(same.count + 1, error.count);
    else s.session.problems.push(error);
    if (s.session.problems.length > 50) s.session.problems.splice(0, s.session.problems.length - 50);
  });
}

// ------------------------------------------------------------------ AI changes

function slotFor(key: CastKey): CastSlot {
  return { key, art: null, madeBy: null, extra: null, laterUntil: 0 };
}

/**
 * Applies an accepted AI change (or a build's fallback) to the open world: code with its authors, new
 * cast members, a footstep with the student's words, a save, and the new version in the player (at once,
 * or at the next pause, win, loss or 5 s of idle when the student is playing). Returns the new world.
 */
export async function applyAccepted(
  outcome: Extract<AiOutcome, { kind: 'accepted' | 'fallback' }>,
  o: { task?: 'build' | 'change' | 'fix'; request?: string } = {},
): Promise<World> {
  const world = getState().session.world;
  if (!world) throw new Error('No world is open.');
  // The AI pipeline calls this with the outcome alone: its job still holds the student's words.
  const job = getState().ai.job;
  const task = o.task ?? (job?.worldId === world.id ? job.task : undefined);
  const request = o.request ?? (job?.worldId === world.id && job.task !== 'fix' ? job.request : undefined);
  const { history } = getServices();
  const code = history.attribute(world.code, outcome.files, 'ai');
  const cast: Record<CastKey, CastSlot> = { ...world.cast };
  const added: CastKey[] = [];
  for (const need of outcome.manifest.art) {
    if (cast[need.key]) continue;
    cast[need.key] = slotFor(need.key);
    added.push(need.key);
  }
  const fresh = outcome.kind === 'accepted' && outcome.newArt.length ? outcome.newArt : added;
  updateWorld((w) => {
    w.code = code;
    w.cast = cast;
  });
  const files = outcome.files.map((f) => f.path);
  const step: StepInput =
    outcome.kind === 'fallback'
      ? { kind: 'code', by: 'ai', text: outcome.message, files, ...(request ? { request } : {}) }
      : {
          kind: task === 'fix' ? 'fix' : 'ask',
          by: 'ai',
          text: outcome.summary || t('world.stepAiChanged'),
          files,
          tested: outcome.tested,
          handEdits: outcome.handEditsTouched,
          ...(request ? { request } : {}),
        };
  const recorded = (await recordStep(step)) ?? getState().session.world ?? world;
  const summary = outcome.kind === 'accepted' ? outcome.summary : outcome.message;
  patchSession({ fresh, manifest: outcome.manifest });
  refreshCast();
  const playing = getState().session.player === 'running' && getState().session.mode === 'play';
  if (playing) patchSession({ newVersion: { summary, ready: true } });
  else void loadGame(recorded, { autostart: true });
  return recorded;
}

/** Loads a new version that waited for a pause ("New version ready: … [Play it now]"). */
export function playNewVersion(): void {
  const world = getState().session.world;
  if (!world || !getState().session.newVersion) return;
  patchSession({ newVersion: null });
  void loadGame(world, { autostart: true });
}

// ------------------------------------------------------------------ the come-alive flight and steer toast

export function setComeAlive(c: ComeAlive | null): void {
  setState((s) => {
    s.session.comeAlive = c;
  });
}

/** Resets the session (tests, "Delete everything"). */
export function closeWorld(): void {
  bursts.cancel();
  loaded = null;
  setState((s) => {
    Object.assign(s.session, initialSession());
  });
}
