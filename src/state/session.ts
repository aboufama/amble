/**
 * The `session` slice (M2 owns; FOUNDATION-STUB with basic `openWorld`, `setDial` and `setTwist`): the
 * world that is open, its manifest and cast, the save state, the player state, Change mode and the
 * come-alive flight.
 */
import { getServices } from '../app/services';
import type { GameManifest, GameState, WorldObject } from '../cores/play';
import { NotBuiltYet } from '../model/notBuilt';
import type { AiOutcome, CastKey, CastMember, PlayerError, SaveState, TwistId, World, WorldId } from '../model/types';
import { getState, setState, type ComeAlive } from './store';

export interface SessionSlice {
  world: World | null;
  manifest: GameManifest | null;
  cast: CastMember[];
  save: SaveState;
  player: GameState;
  problems: PlayerError[];
  mode: 'play' | 'change';
  selected: CastKey | null;
  objects: WorldObject[];
  comeAlive: ComeAlive | null;
  newVersion: { summary: string; ready: boolean } | null;
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
  };
}

/** Loads a world from the store into the session (null when it does not exist). */
export async function openWorld(id: WorldId): Promise<World | null> {
  const world = await getServices().store.worlds.get(id);
  setState((s) => {
    Object.assign(s.session, initialSession());
    s.session.world = world;
  });
  return world;
}

/** Turns a dial live (M2 adds the footstep burst and autosave). */
export function setDial(key: string, value: number): void {
  const world = getState().session.world;
  if (!world) return;
  setState((s) => {
    if (s.session.world) s.session.world.dials[key] = value;
  });
  getServices().player.dial(key, value);
}

/** Switches a twist live (M2 adds the footstep and autosave). */
export function setTwist(id: TwistId, on: boolean): void {
  const world = getState().session.world;
  if (!world) return;
  setState((s) => {
    const w = s.session.world;
    if (!w) return;
    w.twists = on ? [...new Set([...w.twists, id])] : w.twists.filter((x) => x !== id);
  });
  getServices().player.twist(id, on);
}

/** Applies an accepted AI change to the open world (M2). */
export function applyAccepted(_outcome: Extract<AiOutcome, { kind: 'accepted' | 'fallback' }>): Promise<World> {
  return Promise.reject(new NotBuiltYet('applyAccepted (M2)'));
}

export function setComeAlive(c: ComeAlive | null): void {
  setState((s) => {
    s.session.comeAlive = c;
  });
}
