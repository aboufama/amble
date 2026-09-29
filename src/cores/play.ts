/**
 * The player core as the app sees it (§8.2): protocol v2 (with Change mode's messages and their parsers),
 * the framework-free `Player`, the robot judge, the standalone page builder and the kit's API as data.
 * App code imports these only from here; `src/runtime/**` and `phaser` are never imported by the app.
 *
 * Over `src/play` (the player core), under its own names, which are the spec's. Notes for modules:
 * - The runtime's URL is NOT here: it lives in `./playRuntime` (`RUNTIME_URL`), because resolving it
 *   needs the page (`virtual:amble-runtime`). Import it lazily where a game starts (PlayerHost does).
 * - `KIT_API` is the kit's full manifest (the validator's `KitManifest`: globals, scene methods, namespaces,
 *   actor methods, synonyms, reserved names, docs, sounds, moves, twists...). `KIT_REFERENCE` is the same
 *   API as a list of namespaces with signatures and one-line docs (scene first, as ''), for the prompt
 *   cheat sheet, hover docs and autocomplete. `kitDts` is the model-facing `amble-kit.d.ts` as text.
 * - `buildStandaloneHtml(input)` is async and takes the runtime's text; `standalonePage(init, { title })`
 *   below does that from an init message (Share as a web page).
 * - `judgeRobot(raw)`, `(raw, { expectedFrames, thresholds })` or `(raw, frames, thresholds)` returns the
 *   raw report with its verdict (`RobotReport`).
 * - Change mode's messages (mode, select, celebrate, step, snapshot; replies objects and snapshot) are in
 *   the protocol; the runtime hands them to the handler M2 registers with `registerEditorHandler`
 *   (src/runtime/shell/editor.ts). Until then they are ignored and `snapshot` never answers.
 */
import { buildStandaloneHtml, loadRuntimeText, type InitMessage } from '../play';

export * from '../play';

/** 'real' since the player core merged. */
export const PLAYER_CORE: 'stub' | 'real' = 'real';

/**
 * One HTML file that plays a world with no network (§6.2, M6's Share as a web page), from the same init
 * message a player gets: the runtime's text, the files, drawings with their rigs, sounds, fonts, dials
 * and twists, all inline. The standalone script follows the runtime: it shows the ▶ Play card and binds the
 * drawings to their bones in the page (a bake is far bigger than the PNG it comes from).
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
  });
}
