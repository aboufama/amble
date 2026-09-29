/**
 * Puts a changed world into play (Go back and Run it): the open world in the session becomes the new one
 * and the game reloads in a fresh realm from the warm spare, skipping the title card. M2's world screen
 * reads the session, so its Cast line and Dials follow.
 */
import { playerPrefsFrom } from '../app/player/prefs';
import { getServices } from '../app/services';
import type { GameManifest } from '../cores/play';
import type { World } from '../model/types';
import { getState, setState } from '../state/store';
import { deriveCast } from '../world/cast';
import { toInitMessage } from '../world/init';

/** Replaces the session's world with a newer copy of the same world (no reload). */
export function setSessionWorld(world: World): void {
  setState((s) => {
    if (s.session.world?.id === world.id) s.session.world = world;
  });
}

/** Whether a world is the one open in the session (the one the player runs). */
export function isOpenWorld(worldId: string): boolean {
  return getState().session.world?.id === worldId;
}

/**
 * Plays a world from the start of a fresh realm (the session's world is left as it is); resolves with
 * its manifest, or rejects when the player can't start it or a newer load replaced it (`isSupersededLoad`).
 */
export async function loadWorld(world: World): Promise<GameManifest> {
  const init = await toInitMessage(world, { mode: 'play', prefs: playerPrefsFrom(getState().prefs), autostart: true });
  const manifest = await getServices().player.load(init);
  setState((s) => {
    if (s.session.world?.id !== world.id) return;
    s.session.manifest = manifest;
    s.session.cast = deriveCast(manifest, world);
    s.session.problems = [];
  });
  return manifest;
}

/** Sets the session's world, then plays it (Go back, and opening a world). */
export function playWorld(world: World): Promise<GameManifest> {
  setSessionWorld(world);
  return loadWorld(world);
}
