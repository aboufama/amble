/**
 * The `prefs` slice (M7): the student's preferences (§4.2), persisted in `settings.prefs`. main.tsx applies
 * theme, motion, text size, spacing and easy-read letters to `<html>` whenever they change (htmlPrefs.ts),
 * and saves them through `onPrefsChange`. Settings writes them with `setPref`.
 */
import { BUILD } from '../app/env';
import { isRecord, mergeValid, PREFS_FIELDS, themeOf } from '../model/guards';
import type { Prefs } from '../model/types';
import { getState, setState } from './store';

/** School builds start quiet: UI sounds off and games muted (25 Chromebooks in one room). */
export function defaultPrefs(school: boolean = BUILD.school): Prefs {
  return {
    theme: 'original',
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

/**
 * Stored prefs from earlier builds: their Night and Day themes are both the Original colours now (the
 * student who chose High contrast keeps it).
 */
function migrate(stored: unknown): unknown {
  if (isRecord(stored) && (stored.theme === 'night' || stored.theme === 'day')) return { ...stored, theme: 'original' };
  return stored;
}

/** Stored prefs (possibly from an older Amble) over the defaults; invalid fields are ignored. */
export function readPrefs(stored: unknown): Prefs {
  return mergeValid(defaultPrefs(), migrate(stored), PREFS_FIELDS);
}

type PrefsListener = (prefs: Prefs) => void;
let persist: PrefsListener | null = null;

/** Where changes are saved (main.tsx wires `Store.settings`). */
export function onPrefsChange(fn: PrefsListener | null): void {
  persist = fn;
}

export function setPrefs(patch: Partial<Prefs>): void {
  // A theme written by older code (or a test hook) as 'night' or 'day' means the Original colours.
  const next = 'theme' in patch ? { ...patch, theme: themeOf(patch.theme) } : patch;
  setState((s) => {
    Object.assign(s.prefs, next);
  });
  persist?.(getState().prefs);
}

/** One preference (Settings). */
export function setPref<K extends keyof Prefs>(key: K, value: Prefs[K]): void {
  setPrefs({ [key]: value } as Partial<Prefs>);
}

/** Replaces all prefs without saving (boot). */
export function loadPrefs(prefs: Prefs): void {
  setState((s) => {
    s.prefs = prefs;
  });
}

/** Back to the defaults for this build (after "Delete everything"). */
export function resetPrefs(school: boolean = getState().config.school): void {
  loadPrefs(defaultPrefs(school));
  persist?.(getState().prefs);
}

/** Remembers that a one-time tip or card was shown. */
export function markSeen(key: keyof Prefs['seen']): void {
  setPrefs({ seen: { ...getState().prefs.seen, [key]: Date.now() } });
}
