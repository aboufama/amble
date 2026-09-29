/**
 * Key forwarding (§2.6, §6.8): in Play mode, keys typed anywhere on the world screen except a text field
 * or a control that uses them go to the game, so a student can play without clicking into it. Escape,
 * Tab, function keys and shortcuts never go (no keyboard trap; Ctrl+S stays Save). Leaving the page, or a
 * dialog opening, lets go of every held key.
 */
import { isScrollKey, shouldForwardKey, type KeyLike } from '../cores/play';

/** Anything with `closest` (a DOM Element, or a test double). */
export interface KeyTarget {
  closest(selector: string): unknown;
}

/** Controls and layers that use keys themselves (Space on a button, arrows on a dial or a menu). */
export const KEY_OWNERS = [
  'input',
  'textarea',
  'select',
  'button',
  'a[href]',
  'summary',
  '[contenteditable=""]',
  '[contenteditable="true"]',
  '[role="button"]',
  '[role="radio"]',
  '[role="slider"]',
  '[role="switch"]',
  '[role="checkbox"]',
  '[role="menu"]',
  '[role="menuitem"]',
  '[role="option"]',
  '[role="listbox"]',
  '[role="tab"]',
  '[role="dialog"]',
  '[role="application"]',
  'dialog',
].join(', ');

export interface ForwardContext {
  mode: 'play' | 'change';
  /** A modal dialog or sheet is open. */
  modal: boolean;
}

/** Whether a key event on `target` goes to the game. */
export function forwardsToGame(e: KeyLike, target: KeyTarget | null, ctx: ForwardContext): boolean {
  if (ctx.mode !== 'play' || ctx.modal) return false;
  if (!shouldForwardKey(e)) return false;
  if (target && target.closest(KEY_OWNERS)) return false;
  return true;
}

export interface KeySink {
  key(phase: 'down' | 'up', e: KeyboardEvent): void;
  releaseKeys(): void;
}

function targetOf(e: Event): KeyTarget | null {
  const t: unknown = e.target;
  return t && typeof (t as Partial<KeyTarget>).closest === 'function' ? (t as KeyTarget) : null;
}

/**
 * Listens on the editor window (bubble phase: global shortcuts, which listen in capture, run first).
 * Returns a function that stops forwarding and lets go of every key.
 */
export function installKeyForwarding(sink: KeySink, context: () => ForwardContext, win: Window = window): () => void {
  const held = new Set<string>();
  const onDown = (e: KeyboardEvent) => {
    if (e.defaultPrevented || !forwardsToGame(e, targetOf(e), context())) return;
    held.add(e.code);
    sink.key('down', e);
    if (isScrollKey(e)) e.preventDefault();
  };
  const onUp = (e: KeyboardEvent) => {
    // A key that went down in the game always comes up in the game, wherever focus went meanwhile.
    if (!held.delete(e.code)) return;
    sink.key('up', e);
  };
  const release = () => {
    if (!held.size) return;
    held.clear();
    sink.releaseKeys();
  };
  win.addEventListener('keydown', onDown);
  win.addEventListener('keyup', onUp);
  win.addEventListener('blur', release);
  return () => {
    win.removeEventListener('keydown', onDown);
    win.removeEventListener('keyup', onUp);
    win.removeEventListener('blur', release);
    release();
  };
}
