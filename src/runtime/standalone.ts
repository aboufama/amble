/**
 * The standalone script (vite/ambleRuntime.ts builds it as its own file, `amble-standalone-<hash>.js`):
 * what an exported web page ("Share as a web page") adds after the runtime, which games in the editor
 * never download. It binds the page's drawings to their bones (the editor sends games bakes instead), reads
 * the game from the page and shows the ▶ Play card, whose click starts the runtime inside the gesture.
 */
import '../rig/phaser/binder';
import { STANDALONE_START, type InitMessage } from '../play/protocol';
import { readStandalone, showPlayCard } from './shell/standalone';

const embedded = readStandalone();
if (embedded) {
  showPlayCard(embedded.title, () => {
    const start = (window as unknown as Record<string, unknown>)[STANDALONE_START];
    if (typeof start === 'function') (start as (init: InitMessage) => void)(embedded.init);
  });
}
