/**
 * The `prefs` slice (M7 owns; FOUNDATION-STUB with working basics): the student's preferences (§4.2),
 * persisted in `settings.prefs`. main.tsx applies theme, motion and text size to `<html>` from here.
 */
import { BUILD } from '../app/env';
import { mergeValid, PREFS_FIELDS } from '../model/guards';
import type { Prefs } from '../model/types';
import { getState, setState } from './store';

/** School builds start quiet: UI sounds off and games muted (25 Chromebooks in one room). */
export function defaultPrefs(school: boolean = BUILD.school): Prefs {
  return {
    theme: 'night',
    reduceMotion: 'system',
    textScale: 1,
    extraSpacing: false,
    easyRead: false,
    uiSounds: school ? 'off' : 'on',
    gameVolume: 0.8,
    gameMuted: school,
    captions: false,
    gameSpeed: 1,
    touchControls: 'auto',
    readAloud: true,
    singleKeys: true,
    leftHanded: false,
    pressure: 'normal',
    brushSounds: false,
    trailView: 'trail',
    trailPaused: false,
    seen: {},
  };
}

export function initialPrefs(): Prefs {
  return defaultPrefs();
}

/** Stored prefs (possibly from an older Amble) over the defaults; invalid fields are ignored. */
export function readPrefs(stored: unknown): Prefs {
  return mergeValid(defaultPrefs(), stored, PREFS_FIELDS);
}

type PrefsListener = (prefs: Prefs) => void;
let persist: PrefsListener | null = null;

/** Where changes are saved (main.tsx wires `Store.settings`). */
export function onPrefsChange(fn: PrefsListener | null): void {
  persist = fn;
}

export function setPrefs(patch: Partial<Prefs>): void {
  setState((s) => {
    Object.assign(s.prefs, patch);
  });
  persist?.(getState().prefs);
}

/** Replaces all prefs without saving (boot). */
export function loadPrefs(prefs: Prefs): void {
  setState((s) => {
    s.prefs = prefs;
  });
}

/** Remembers that a one-time tip or card was shown. */
export function markSeen(key: keyof Prefs['seen']): void {
  setPrefs({ seen: { ...getState().prefs.seen, [key]: Date.now() } });
}
