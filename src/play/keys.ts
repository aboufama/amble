/**
 * Which keys the editor forwards to a running game while the editor (not the game) has focus.
 * Games read `keyCode` (Phaser does), so the runtime re-dispatches synthetic KeyboardEvents with it.
 * Pure: no DOM.
 */

export interface KeyLike {
  key: string;
  code: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
}

const NAMED_CODES: Record<string, number> = {
  Backspace: 8, Tab: 9, Enter: 13, NumpadEnter: 13, ShiftLeft: 16, ShiftRight: 16, ControlLeft: 17, ControlRight: 17,
  AltLeft: 18, AltRight: 18, Escape: 27, Space: 32, PageUp: 33, PageDown: 34, End: 35, Home: 36,
  ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40, Delete: 46,
  Semicolon: 186, Equal: 187, Comma: 188, Minus: 189, Period: 190, Slash: 191, Backquote: 192,
  BracketLeft: 219, Backslash: 220, BracketRight: 221, Quote: 222,
};

const NAMED_KEYS: Record<string, number> = {
  ' ': 32, Enter: 13, Shift: 16, Control: 17, Alt: 18, Escape: 27, Tab: 9, Backspace: 8,
  ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40,
};

/** The legacy keyCode for a key, which is what Phaser's keyboard plugin reads. */
export function keyCodeFor(key: string, code: string): number {
  if (NAMED_CODES[code] !== undefined) return NAMED_CODES[code];
  if (/^Key[A-Z]$/.test(code)) return code.charCodeAt(3);
  if (/^Digit[0-9]$/.test(code)) return code.charCodeAt(5);
  if (/^Numpad[0-9]$/.test(code)) return 96 + Number(code.slice(6));
  if (/^F([1-9]|1[0-2])$/.test(code)) return 111 + Number(code.slice(1));
  if (NAMED_KEYS[key] !== undefined) return NAMED_KEYS[key];
  if (key.length === 1) {
    const upper = key.toUpperCase();
    if (/[A-Z0-9]/.test(upper)) return upper.charCodeAt(0);
  }
  return 0;
}

/**
 * Keys the game should get: letters, digits, arrows, Space, Enter, Shift and friends.
 * Never: Escape and Tab (they leave the game, so there is no keyboard trap), shortcuts with Ctrl/Cmd/Alt
 * (they belong to the editor and the browser), and function keys.
 */
export function shouldForwardKey(e: KeyLike): boolean {
  if (e.ctrlKey || e.metaKey || e.altKey) return false;
  if (e.key === 'Escape' || e.key === 'Tab' || e.code === 'Escape' || e.code === 'Tab') return false;
  if (/^F\d+$/.test(e.code)) return false;
  return keyCodeFor(e.key, e.code) !== 0;
}

/** Keys whose default action (scrolling the editor page) must be stopped while they drive the game. */
export function isScrollKey(e: KeyLike): boolean {
  return e.code === 'Space' || e.code.startsWith('Arrow') || e.code === 'PageUp' || e.code === 'PageDown';
}
