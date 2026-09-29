/**
 * Global keys (§2.2). Ctrl-based ones always work: Ctrl+S save, Ctrl+Z / Ctrl+Shift+Z (or Ctrl+Y)
 * undo/redo, Ctrl+Enter submit. Esc closes the top layer, then leaves Change mode, then exits full
 * screen. F6 cycles the regions (header → main → complementary → the cast). Single keys (C, R, F, D in a
 * world) work only when focus is not in a text field and `prefs.singleKeys` is on (WCAG 2.1.4).
 *
 * Screens register what a key does with `useCommand(name, fn)` / `useEscape(fn)`; the newest wins.
 */
import { useEffect, useRef } from 'react';
import { getState } from '../state/store';
import { isTextField } from '../ui/a11y';

export type CommandName = 'save' | 'undo' | 'redo' | 'submit' | 'playChange' | 'restart' | 'fullscreen' | 'drawNext';

/** Returns false when it did not handle the key (the next handler, or the browser, gets it). */
type Handler = () => boolean | void;

const commands = new Map<CommandName, Handler[]>();
const escapes: Array<{ fn: Handler; el: () => HTMLElement | null }> = [];

const SINGLE_KEYS: Record<string, CommandName> = { c: 'playChange', r: 'restart', f: 'fullscreen', d: 'drawNext' };

export function registerCommand(name: CommandName, fn: Handler): () => void {
  const list = commands.get(name) ?? [];
  list.push(fn);
  commands.set(name, list);
  return () => {
    const i = list.indexOf(fn);
    if (i >= 0) list.splice(i, 1);
  };
}

/** Runs the newest handler for a command that accepts it; true when one did. */
export function runCommand(name: CommandName): boolean {
  const list = commands.get(name) ?? [];
  for (let i = list.length - 1; i >= 0; i--) if (list[i]() !== false) return true;
  return false;
}

/**
 * Adds a layer that Esc closes (menus, popovers, Change mode). Newest first. `el` says where the layer
 * lives: while a modal dialog is open, only layers inside it answer Esc (the dialog itself answers next).
 */
export function pushEscape(fn: Handler, el: () => HTMLElement | null = () => null): () => void {
  const entry = { fn, el };
  escapes.push(entry);
  return () => {
    const i = escapes.indexOf(entry);
    if (i >= 0) escapes.splice(i, 1);
  };
}

function topModal(): HTMLDialogElement | null {
  const open = [...document.querySelectorAll<HTMLDialogElement>('dialog[open]')].filter((d) => d.matches(':modal'));
  return open[open.length - 1] ?? null;
}

function runEscape(): boolean {
  const modal = topModal();
  for (let i = escapes.length - 1; i >= 0; i--) {
    const where = escapes[i].el();
    if (modal && (!where || !modal.contains(where))) continue;
    if (escapes[i].fn() !== false) return true;
  }
  return false;
}

/** `useCommand('undo', () => surface.undo())` while the component is mounted (and `active`). */
export function useCommand(name: CommandName, fn: Handler, active = true): void {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => (active ? registerCommand(name, () => ref.current()) : undefined), [name, active]);
}

export function useEscape(fn: Handler, active = true, el?: () => HTMLElement | null): void {
  const ref = useRef(fn);
  ref.current = fn;
  const where = useRef(el);
  where.current = el;
  useEffect(() => (active ? pushEscape(() => ref.current(), () => where.current?.() ?? null) : undefined), [active]);
}

const REGIONS = ['header, [role="banner"]', 'main, [role="main"]', 'aside, [role="complementary"]', '[data-region="cast"]'];

function visible(el: Element): el is HTMLElement {
  return el instanceof HTMLElement && el.getClientRects().length > 0 && !el.closest('[inert], [hidden]');
}

/** F6: moves focus to the next landmark region (Shift+F6: the previous one). */
export function cycleRegion(backwards: boolean): void {
  const regions = REGIONS.map((sel) => [...document.querySelectorAll(sel)].find(visible)).filter((el): el is HTMLElement => !!el);
  if (!regions.length) return;
  const at = regions.findIndex((r) => r.contains(document.activeElement));
  const next = regions[(at + (backwards ? -1 : 1) + regions.length) % regions.length];
  if (!next.hasAttribute('tabindex')) next.setAttribute('tabindex', '-1');
  next.focus();
}

function onKeyDown(e: KeyboardEvent): void {
  if (e.defaultPrevented) return;
  const mod = e.ctrlKey || e.metaKey;
  const key = e.key.toLowerCase();
  const inText = isTextField(e.target);
  const handled = (() => {
    if (mod && !e.altKey && key === 's') {
      runCommand('save');
      return true;
    }
    if (mod && !e.altKey && (key === 'z' || key === 'y') && !inText) {
      return runCommand(key === 'y' || e.shiftKey ? 'redo' : 'undo');
    }
    if (mod && e.key === 'Enter') return runCommand('submit');
    if (e.key === 'Escape') {
      if (runEscape()) return true;
      if (topModal()) return false;
      if (document.fullscreenElement) {
        void document.exitFullscreen();
        return true;
      }
      return false;
    }
    if (e.key === 'F6') {
      cycleRegion(e.shiftKey);
      return true;
    }
    const single = SINGLE_KEYS[key];
    if (single && !mod && !e.altKey && !e.shiftKey && !inText && !e.repeat && getState().prefs.singleKeys) return runCommand(single);
    return false;
  })();
  if (handled) {
    e.preventDefault();
    e.stopImmediatePropagation();
  }
}

/** Installs the global key handler (capture phase, before screens and the game's key forwarding). */
export function installGlobalKeys(win: Window = window): () => void {
  win.addEventListener('keydown', onKeyDown, true);
  return () => win.removeEventListener('keydown', onKeyDown, true);
}
