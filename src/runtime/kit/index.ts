/**
 * The Amble kit as games see it: `window.Amble` (frozen), with `Amble.Scene` for `class Game extends
 * Amble.Scene`. The shell installs it once per game realm, before any game file runs.
 */
import { loopGuard } from '../shell/loopGuard';
import { bootKitGame, installBootHooks, startGame } from './boot';
import { Character } from './character';
import { numOf } from './dials';
import { env, setEnv, type KitEnv } from './env';
import { patchLoader } from './loader';
import { registerRiggedFactory } from './rigged';
import { AmbleScene } from './scene';
import { SOUND_NAMES } from './sounds';
import { TWIST_IDS } from '../../play/kit/twistCatalog';
import { util } from './util';

export const KIT_VERSION = '2.0.0';

/** Read-only settings a game may look at: `if (Amble.prefs.reducedMotion) ...`. */
function prefsView(): Readonly<{ reducedMotion: boolean; muted: boolean; touch: boolean }> {
  return Object.freeze({
    get reducedMotion() {
      return env().prefs.reducedMotion;
    },
    get muted() {
      return env().prefs.muted;
    },
    get touch() {
      return env().prefs.touch === 'on';
    },
  });
}

export function installKit(e: KitEnv): void {
  setEnv(e);
  installBootHooks();
  patchLoader();
  const Amble = Object.freeze({
    Scene: AmbleScene,
    Character,
    util: Object.freeze({ ...util }),
    num: numOf,
    SOUNDS: Object.freeze([...SOUND_NAMES]),
    TWISTS: Object.freeze([...TWIST_IDS]),
    prefs: prefsView(),
    version: KIT_VERSION,
    boot: bootKitGame,
    registerRiggedFactory,
    /** Called by the runtime after the game's files ran. */
    __start: startGame,
    /** The validator puts `Amble.__loop();` at the top of every loop body. */
    __loop: loopGuard,
  });
  Object.defineProperty(window, 'Amble', { value: Amble, writable: false, configurable: false, enumerable: true });
}

export { AmbleScene, Character };
