/**
 * The standalone script (vite/ambleRuntime.ts builds it as its own file, `amble-standalone-<hash>.js`):
 * what an exported web page ("Share as a web page") adds after the runtime, which games in the editor
 * never download. It binds the page's drawings to their bones (the editor sends games bakes instead), reads
 * the game from the page and shows the ▶ Play card, whose click starts the runtime inside the gesture, and
 * the captions strip when the page carries Captions on.
 */
import '../rig/phaser/binder';
import { STANDALONE_START, type GameEvent, type InitMessage } from '../play/protocol';
import { readStandalone, showCaptions, showPlayCard } from './shell/standalone';

const embedded = readStandalone();
if (embedded) {
  // Whoever shared it had Captions on: the page shows the words for game sounds too.
  const onEvent = embedded.captions ? showCaptions() : undefined;
  showPlayCard(embedded.title, () => {
    const start = (window as unknown as Record<string, unknown>)[STANDALONE_START];
    if (typeof start === 'function') (start as (init: InitMessage, onEvent?: (event: GameEvent) => void) => void)(embedded.init, onEvent);
  });
}
