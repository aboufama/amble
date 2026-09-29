/** The player's prefs from the student's (§4.2 Prefs → protocol PlayerPrefs). */
import type { PlayerPrefs } from '../../cores/play';
import type { Prefs } from '../../model/types';
import { motionReduced } from '../../ui/a11y';

export function playerPrefsFrom(prefs: Prefs, reducedMotion: boolean = motionReduced()): PlayerPrefs {
  return {
    reducedMotion,
    muted: prefs.gameMuted,
    volume: prefs.gameVolume,
    quality: 'auto',
    touch: prefs.touchControls,
    speed: prefs.gameSpeed,
    captions: prefs.captions,
    errorPanel: true,
    ghostTaps: true,
  };
}
