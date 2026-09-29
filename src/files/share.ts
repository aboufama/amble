/**
 * Share as a web page (§4.6, §6.2): one HTML file that plays the world with no network, for families.
 * `buildStandaloneHtml` (the player core) inlines the player, the code and the drawings under a
 * `default-src 'none'` policy; just-bones members show their names only. `file://` is often blocked for
 * students, so this is never the hand-in path.
 */
import { buildStandaloneHtml, DEFAULT_PLAYER_PREFS, type InitMessage } from '../cores/play';
import type { World } from '../model/types';
import { toInitMessage } from '../world/init';

export interface ShareDeps {
  init?: (world: World) => Promise<InitMessage>;
  captions?: boolean;
}

export async function buildSharePage(world: World, deps: ShareDeps = {}): Promise<Blob> {
  const prefs = { ...DEFAULT_PLAYER_PREFS, captions: deps.captions ?? false, ghostTaps: false, errorPanel: true };
  const init = await (deps.init ?? ((w) => toInitMessage(w, { mode: 'play', prefs, autostart: false })))(world);
  const html = buildStandaloneHtml(init, { title: world.title || 'Amble' });
  return new Blob([html], { type: 'text/html;charset=utf-8' });
}
