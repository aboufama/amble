/**
 * The store (§8.4): the app slice's actions, the promise dialogs, prefs defaults and merging, and the
 * layout classes (§2.2).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { layoutFor } from '../../src/app/layout';
import { announce, dismissToast, setLayout, setRoute, showToast, toastDuration } from '../../src/state/app';
import { defaultPrefs, loadPrefs, onPrefsChange, readPrefs, setPrefs } from '../../src/state/prefs';
import { setConfig } from '../../src/state/config';
import { getState, initialState, resetState, setState, subscribe } from '../../src/state/store';
import { alertUser, askUser, confirmUser } from '../../src/ui/dialogs';

afterEach(() => resetState());

describe('store shape', () => {
  it('has the slices of §8.4', () => {
    const s = initialState();
    expect(Object.keys(s).sort()).toEqual(['ai', 'app', 'config', 'draw', 'library', 'prefs', 'session']);
    expect(s.app).toMatchObject({ route: { name: 'home' }, toasts: [], dialogs: [], announce: { polite: '', assertive: '' } });
    expect(s.library).toMatchObject({ worlds: [], characters: [], loaded: false, storage: 'ok', legacy: null });
    expect(s.session).toMatchObject({ world: null, manifest: null, cast: [], mode: 'play', selected: null, objects: [], comeAlive: null, newVersion: null });
    expect(s.ai).toMatchObject({ job: null, lastOutcome: null, status: 'off' });
    expect(s.draw).toMatchObject({ artId: null, dirty: false, mode: null });
    expect(s.config).toMatchObject({ ai: null, classLink: null });
  });

  it('writes with immer recipes and notifies subscribers', () => {
    const seen: string[] = [];
    const stop = subscribe((state, prev) => {
      if (state.app.layout !== prev.app.layout) seen.push(state.app.layout);
    });
    setState((s) => {
      s.app.layout = 'tab';
    });
    setLayout('tab');
    setLayout('touch');
    stop();
    expect(seen).toEqual(['tab', 'touch']);
  });

  it('keeps state immutable between writes', () => {
    const before = getState();
    setRoute({ name: 'trail', view: 'list' });
    expect(before.app.route).toEqual({ name: 'home' });
    expect(getState().app.route).toEqual({ name: 'trail', view: 'list' });
    expect(getState().prefs).toBe(before.prefs);
  });
});

describe('toasts', () => {
  it('shows at most two, dropping the oldest non-sticky one', () => {
    const a = showToast('Saved');
    const b = showToast('Undo?', { action: { label: 'Undo', run: () => undefined } });
    showToast('Went back', { kind: 'success' });
    const texts = getState().app.toasts.map((t) => t.text);
    expect(texts).toEqual(['Undo?', 'Went back']);
    expect(getState().app.toasts.find((t) => t.id === a)).toBeUndefined();
    dismissToast(b);
    expect(getState().app.toasts.map((t) => t.text)).toEqual(['Went back']);
  });

  it('replaces a toast with the same words', () => {
    showToast('Saved');
    showToast('Saved');
    expect(getState().app.toasts).toHaveLength(1);
  });

  it('stays 4 s, 8 s for errors and toasts with an action, and until dismissed only when sticky', () => {
    showToast('a');
    showToast('b', { kind: 'error' });
    const [a, b] = getState().app.toasts;
    expect(toastDuration(a)).toBe(4000);
    expect(toastDuration(b)).toBe(8000);
    showToast('c', { action: { label: 'Do', run: () => undefined } });
    expect(toastDuration(getState().app.toasts.at(-1)!)).toBe(8000);
    showToast('d', { sticky: true });
    expect(toastDuration(getState().app.toasts.at(-1)!)).toBeNull();
  });

  it('goes when the student moves to another screen, unless it stays relevant', () => {
    let now = 1_000_000;
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => now);
    try {
      setRoute({ name: 'world', id: 'w1' });
      showToast('Done! The Moon King throws fireballs now.', { kind: 'ai', action: { label: 'See what changed', run: () => undefined } });
      showToast('Could not save.', { kind: 'error' });
      now += 5000;
      // The Hand in sheet is the same screen: nothing goes.
      setRoute({ name: 'handin', worldId: 'w1' });
      expect(getState().app.toasts).toHaveLength(2);
      setRoute({ name: 'world', id: 'w1' });
      // Full screen or a menu is not a move either; the Trail is.
      setRoute({ name: 'trail', view: 'trail' });
      expect(getState().app.toasts.map((t) => t.text)).toEqual(['Could not save.']);
      // Errors follow the student; so does a toast asked to (scope 'app') or one that must be answered.
      showToast('Welcome back.', { scope: 'app' });
      showToast('Keep this?', { sticky: true });
      now += 5000;
      setRoute({ name: 'settings', section: null });
      expect(getState().app.toasts.map((t) => t.text)).toEqual(['Welcome back.', 'Keep this?']);
    } finally {
      clock.mockRestore();
    }
  });

  it('comes along when it was shown with the move itself (a toast, then navigate)', () => {
    let now = 2_000_000;
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => now);
    try {
      setRoute({ name: 'teacher', tab: 'assignments' });
      showToast('The assignment is in your class link.', { kind: 'success' });
      now += 200;
      setRoute({ name: 'settings', section: 'ai' });
      expect(getState().app.toasts.map((t) => t.screen)).toEqual(['settings']);
      now += 3000;
      // It now belongs to the screen it came to, and goes when the student leaves that one.
      setRoute({ name: 'settings', section: 'reading' });
      expect(getState().app.toasts).toHaveLength(1);
      setRoute({ name: 'trail', view: 'trail' });
      expect(getState().app.toasts).toHaveLength(0);
    } finally {
      clock.mockRestore();
    }
  });
});

describe('live announcements', () => {
  it('writes polite and assertive regions, and repeats still change the text', () => {
    announce('Saved');
    expect(getState().app.announce.polite).toBe('Saved');
    const first = getState().app.announce.polite;
    announce('Saved');
    expect(getState().app.announce.polite).not.toBe(first);
    expect(getState().app.announce.polite.trim()).toBe('Saved');
    announce('Could not save', 'assertive');
    expect(getState().app.announce.assertive).toBe('Could not save');
  });
});

describe('promise dialogs', () => {
  it('confirm resolves with the answer and leaves the stack', async () => {
    const answer = confirmUser({ title: 'Put this world away?', danger: true });
    const [entry] = getState().app.dialogs;
    expect(entry).toMatchObject({ kind: 'confirm', title: 'Put this world away?', danger: true, ok: 'OK', cancel: 'Cancel' });
    if (entry.kind === 'confirm') entry.resolve(true);
    await expect(answer).resolves.toBe(true);
    expect(getState().app.dialogs).toEqual([]);
  });

  it('ask resolves with the text or null', async () => {
    const name = askUser({ title: 'Name', label: 'Name', value: 'Blorp', maxLength: 40 });
    const entry = getState().app.dialogs[0];
    expect(entry).toMatchObject({ kind: 'ask', value: 'Blorp', maxLength: 40 });
    if (entry.kind === 'ask') entry.resolve(null);
    await expect(name).resolves.toBeNull();
  });

  it('alert resolves when closed, and dialogs stack', async () => {
    const first = alertUser({ title: 'One' });
    const second = alertUser({ title: 'Two' });
    expect(getState().app.dialogs.map((d) => d.title)).toEqual(['One', 'Two']);
    const top = getState().app.dialogs[1];
    if (top.kind === 'alert') top.resolve();
    await expect(second).resolves.toBeUndefined();
    const rest = getState().app.dialogs[0];
    if (rest.kind === 'alert') rest.resolve();
    await expect(first).resolves.toBeUndefined();
  });
});

describe('prefs', () => {
  it('starts quiet in school builds', () => {
    expect(defaultPrefs(true)).toMatchObject({ uiSounds: 'off', gameMuted: true, theme: 'original' });
    expect(defaultPrefs(false)).toMatchObject({ uiSounds: 'on', gameMuted: false, brushSounds: false });
  });

  it('reads stored prefs over the defaults and persists changes', () => {
    const stored = readPrefs({ theme: 'contrast', textScale: 1.3, gameVolume: 9, seen: { firstPage: 5 } });
    expect(stored).toMatchObject({ theme: 'contrast', textScale: 1.3, gameVolume: defaultPrefs().gameVolume, seen: { firstPage: 5 } });
    loadPrefs(stored);
    const saved: string[] = [];
    onPrefsChange((p) => saved.push(p.theme));
    setPrefs({ theme: 'original' });
    onPrefsChange(null);
    expect(getState().prefs.theme).toBe('original');
    expect(saved).toEqual(['original']);
  });

  it('reads the Night and Day themes of earlier builds as the Original colours', () => {
    expect(readPrefs({ theme: 'night', textScale: 1.15 })).toMatchObject({ theme: 'original', textScale: 1.15 });
    expect(readPrefs({ theme: 'day', extraSpacing: true })).toMatchObject({ theme: 'original', extraSpacing: true });
    expect(readPrefs({ theme: 'contrast' }).theme).toBe('contrast');
    expect(readPrefs({ theme: 'sepia' }).theme).toBe('original');
    // Older code (or a test hook) writing a retired theme still gets the Original colours.
    setPrefs({ theme: 'night' as never });
    expect(getState().prefs.theme).toBe('original');
    setPrefs({ theme: 'contrast' });
    expect(getState().prefs.theme).toBe('contrast');
    setPrefs({ theme: 'original' });
  });

  it('config writes merge', () => {
    setConfig({ level: 'high' });
    expect(getState().config.level).toBe('high');
    expect(getState().config.classLink).toBeNull();
  });
});

describe('layout classes (§2.2)', () => {
  it.each([
    [1366, 768, false, 'full'],
    [1340, 740, false, 'full'],
    [1366, 657, false, 'tab'],
    [1280, 620, false, 'tab'],
    [1280, 800, true, 'touch'],
    [1280, 600, false, 'small'],
    [1024, 600, false, 'small'],
    [800, 1280, false, 'portrait'],
    [800, 1280, true, 'portrait'],
  ] as const)('%ix%i coarse=%s → %s', (w, h, coarse, layout) => {
    expect(layoutFor(w, h, coarse)).toBe(layout);
  });
});
