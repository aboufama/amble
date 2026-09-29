/**
 * "Share as a web page" as the app sees it (§6.2). `./play` re-exports it under the same name; it lives
 * apart because that barrel loads with the app (protocol constants), and an adapter defined in it would
 * bring the standalone builder into the first load.
 */
import type { InitMessage } from '../play/protocol';
import { loadRuntimeText } from '../play/runtimeBytes';
import { buildStandaloneHtml } from '../play/standalone';

/**
 * One HTML file that plays a world with no network (§6.2, M6's Share as a web page), from the same init
 * message a player gets: the runtime's text, the files, drawings with their rigs, sounds, fonts, dials
 * and twists, all inline, and its Captions setting (the page shows captions when it is on). The standalone
 * script follows the runtime: it shows the ▶ Play card and binds the drawings to their bones in the page
 * (a bake is far bigger than the PNG it comes from).
 */
export async function standalonePage(init: InitMessage, o: { title: string; runtimeUrl?: string; standaloneUrl?: string }): Promise<string> {
  const urls = o.runtimeUrl && o.standaloneUrl ? null : await import('./playRuntime');
  const [runtime, standalone] = await Promise.all([loadRuntimeText(o.runtimeUrl ?? urls!.RUNTIME_URL), loadRuntimeText(o.standaloneUrl ?? urls!.STANDALONE_URL)]);
  return buildStandaloneHtml({
    title: o.title,
    runtime: `${runtime}\n;\n${standalone}`,
    files: init.files,
    images: init.art.map((a) => ({ key: a.key, image: a.image, rig: a.rig, layers: a.layers })),
    sounds: init.sounds,
    fonts: init.fonts,
    dials: init.dials,
    twists: init.twists,
    captions: init.prefs.captions,
  });
}
