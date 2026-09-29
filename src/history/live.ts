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

/** Sets the session's world and plays it from the start of a fresh realm; resolves with its manifest. */
export async function playWorld(world: World): Promise<GameManifest> {
  setSessionWorld(world);
  const init = await toInitMessage(world, { mode: 'play', prefs: playerPrefsFrom(getState().prefs), autostart: true });
  const manifest = await getServices().player.load(init);
  setState((s) => {
    const open = s.session.world;
    if (!open || open.id !== world.id) return;
    s.session.manifest = manifest;
    s.session.cast = deriveCast(manifest, open);
    s.session.problems = [];
  });
  return manifest;
}
