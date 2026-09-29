/**
 * Key forwarding (§2.6, §6.8): keys go to the game in Play mode, never from text fields or controls that
 * use them, never Escape, Tab, function keys or shortcuts, and every held key is let go on blur.
 */
import { describe, expect, it, vi } from 'vitest';
import { forwardsToGame, installKeyForwarding, KEY_OWNERS, type KeySink, type KeyTarget } from '../../src/world/keys';

/** A target that is inside elements matching `inside` (CSS selectors, checked one by one). */
function target(...inside: string[]): KeyTarget {
  return { closest: (sel: string) => (sel.split(', ').some((s) => inside.includes(s)) ? {} : null) };
}

const key = (k: string, code: string, mods: Partial<{ ctrlKey: boolean; altKey: boolean; metaKey: boolean }> = {}) => ({ key: k, code, ...mods });
const play = { mode: 'play' as const, modal: false };

describe('forwardsToGame', () => {
  it('forwards letters, arrows and Space typed on the page in Play mode', () => {
    expect(forwardsToGame(key('ArrowLeft', 'ArrowLeft'), target(), play)).toBe(true);
    expect(forwardsToGame(key(' ', 'Space'), target(), play)).toBe(true);
    expect(forwardsToGame(key('x', 'KeyX'), null, play)).toBe(true);
  });

  it('never forwards from text fields or controls that use keys themselves', () => {
    for (const owner of ['input', 'textarea', 'button', '[role="slider"]', '[role="radio"]', '[role="menuitem"]', 'dialog', '[role="application"]']) {
      expect(KEY_OWNERS.split(', ')).toContain(owner);
      expect(forwardsToGame(key(' ', 'Space'), target(owner), play)).toBe(false);
    }
  });

  it('never forwards Escape, Tab, function keys or shortcuts', () => {
    expect(forwardsToGame(key('Escape', 'Escape'), target(), play)).toBe(false);
    expect(forwardsToGame(key('Tab', 'Tab'), target(), play)).toBe(false);
    expect(forwardsToGame(key('F5', 'F5'), target(), play)).toBe(false);
    expect(forwardsToGame(key('s', 'KeyS', { ctrlKey: true }), target(), play)).toBe(false);
    expect(forwardsToGame(key('ArrowLeft', 'ArrowLeft', { altKey: true }), target(), play)).toBe(false);
  });

  it('forwards nothing in Change mode or under a modal', () => {
    expect(forwardsToGame(key(' ', 'Space'), target(), { mode: 'change', modal: false })).toBe(false);
    expect(forwardsToGame(key(' ', 'Space'), target(), { mode: 'play', modal: true })).toBe(false);
  });
});

class FakeWindow {
  private readonly handlers = new Map<string, Array<(e: never) => void>>();
  addEventListener(type: string, fn: (e: never) => void) {
    this.handlers.set(type, [...(this.handlers.get(type) ?? []), fn]);
  }
  removeEventListener(type: string, fn: (e: never) => void) {
    this.handlers.set(type, (this.handlers.get(type) ?? []).filter((h) => h !== fn));
  }
  fire(type: string, e: object = {}) {
    for (const h of this.handlers.get(type) ?? []) h(e as never);
  }
}

function keyEvent(type: string, k: string, code: string, t: KeyTarget | null = target()) {
  return { type, key: k, code, target: t, defaultPrevented: false, preventDefault: vi.fn(), repeat: false };
}

describe('installKeyForwarding', () => {
  it('sends down and up to the game, stops scrolling keys, and releases everything on blur', () => {
    const win = new FakeWindow();
    const sink: KeySink = { key: vi.fn(), releaseKeys: vi.fn() };
    const stop = installKeyForwarding(sink, () => play, win as unknown as Window);
    const down = keyEvent('keydown', 'ArrowRight', 'ArrowRight');
    win.fire('keydown', down);
    expect(sink.key).toHaveBeenCalledWith('down', down);
    expect(down.preventDefault).toHaveBeenCalled();
    win.fire('keyup', keyEvent('keyup', 'ArrowRight', 'ArrowRight'));
    expect(sink.key).toHaveBeenCalledTimes(2);
    win.fire('keydown', keyEvent('keydown', 'x', 'KeyX'));
    win.fire('blur');
    expect(sink.releaseKeys).toHaveBeenCalledTimes(1);
    stop();
    win.fire('keydown', keyEvent('keydown', 'x', 'KeyX'));
    expect(sink.key).toHaveBeenCalledTimes(3);
  });

  it('ignores keys meant for a control, and ups for keys the game never got', () => {
    const win = new FakeWindow();
    const sink: KeySink = { key: vi.fn(), releaseKeys: vi.fn() };
    installKeyForwarding(sink, () => play, win as unknown as Window);
    win.fire('keydown', keyEvent('keydown', ' ', 'Space', target('button')));
    win.fire('keyup', keyEvent('keyup', ' ', 'Space'));
    expect(sink.key).not.toHaveBeenCalled();
  });
});
