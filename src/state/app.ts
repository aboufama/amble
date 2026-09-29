/**
 * The `app` slice (FOUNDATION): where the student is, the layout class, toasts, the dialog stack and the
 * two live regions. Also the class-link intake the router read at boot, for the Join card (M7).
 */
import { screenKeyOf, type Route } from '../app/routes';
import type { ClassLinkIntake } from '../model/types';
import { setState, getState, type LayoutClass } from './store';

/** `ai` is kept for older callers: a wish that landed reads as a success. */
export type ToastKind = 'info' | 'success' | 'error' | 'ai';

export interface Toast {
  id: string;
  text: string;
  kind: ToastKind;
  /** One button ([Undo], [See what changed]). A toast with an action still goes by itself (8 s). */
  action: { label: string; run: () => void } | null;
  /** Stays until dismissed or acted on: only for a toast that must be answered. */
  sticky: boolean;
  at: number;
  /**
   * The screen it belongs to (`screenKeyOf`): it goes when the student moves to another screen. Null
   * for a toast that stays relevant everywhere (errors, by default).
   */
  screen: string | null;
}

interface DialogBase {
  id: string;
  title: string;
  body: string;
}

/** The promise dialogs of `src/ui/dialogs.ts`, rendered by the dialog layer. */
export type DialogEntry =
  | (DialogBase & { kind: 'alert'; ok: string; resolve(): void })
  | (DialogBase & { kind: 'confirm'; ok: string; cancel: string; danger: boolean; resolve(ok: boolean): void })
  | (DialogBase & {
      kind: 'ask';
      label: string;
      value: string;
      placeholder: string;
      maxLength: number;
      ok: string;
      cancel: string;
      danger: boolean;
      resolve(value: string | null): void;
    });

export interface AppSlice {
  route: Route;
  layout: LayoutClass;
  toasts: Toast[];
  dialogs: DialogEntry[];
  announce: { polite: string; assertive: string };
  /** A `#class=` link read at boot, waiting for the Join card (M7); cleared when answered. */
  joinIntake: ClassLinkIntake | null;
}

export function initialApp(): AppSlice {
  return {
    route: { name: 'home' },
    layout: 'full',
    toasts: [],
    dialogs: [],
    announce: { polite: '', assertive: '' },
    joinIntake: null,
  };
}

/** At most two toasts show at once (§3.4); the oldest non-sticky one goes first. */
const MAX_TOASTS = 2;

/**
 * A toast shown this soon before the screen changes came with the change (a toast, then `navigate`, in
 * one click): it moves to the new screen instead of going.
 */
export const TOAST_GRACE_MS = 1000;

let toastCounter = 0;

/**
 * Where the student is. Moving to another screen takes away the toasts that belonged to the one they
 * left, unless a toast stays relevant everywhere (no screen), must be answered (sticky), or came with
 * this very move.
 */
export function setRoute(route: Route): void {
  setState((s) => {
    const from = screenKeyOf(s.app.route);
    const to = screenKeyOf(route);
    s.app.route = route;
    if (from === to || !s.app.toasts.length) return;
    const now = Date.now();
    s.app.toasts = s.app.toasts
      .filter((x) => x.sticky || x.screen === null || x.screen === to || now - x.at < TOAST_GRACE_MS)
      .map((x) => (x.screen === from && now - x.at < TOAST_GRACE_MS ? { ...x, screen: to } : x));
  });
}

export function setLayout(layout: LayoutClass): void {
  if (getState().app.layout === layout) return;
  setState((s) => {
    s.app.layout = layout;
  });
}

export interface ToastOptions {
  kind?: ToastKind;
  action?: { label: string; run: () => void };
  /** Stays until dismissed (default false: every toast goes by itself, even one with an action). */
  sticky?: boolean;
  /**
   * 'screen' (the default) goes when the student moves to another screen; 'app' follows them, for
   * news that stays true anywhere. Errors default to 'app'.
   */
  scope?: 'screen' | 'app';
}

/**
 * Shows a toast (`role=status`); returns its id. It goes after 4 s, or 8 s for errors and toasts with an
 * action (longer while the pointer or focus is on it), and when the student leaves its screen.
 */
export function showToast(text: string, o: ToastOptions = {}): string {
  const id = `t${++toastCounter}`;
  const kind = o.kind ?? 'info';
  const scope = o.scope ?? (kind === 'error' ? 'app' : 'screen');
  const toast: Toast = {
    id,
    text,
    kind,
    action: o.action ?? null,
    sticky: o.sticky ?? false,
    at: Date.now(),
    screen: scope === 'app' ? null : screenKeyOf(getState().app.route),
  };
  setState((s) => {
    s.app.toasts = s.app.toasts.filter((x) => x.text !== text);
    s.app.toasts.push(toast);
    while (s.app.toasts.length > MAX_TOASTS) {
      const i = s.app.toasts.findIndex((x) => !x.sticky);
      s.app.toasts.splice(i >= 0 ? i : 0, 1);
    }
  });
  return id;
}

export function dismissToast(id: string): void {
  setState((s) => {
    s.app.toasts = s.app.toasts.filter((x) => x.id !== id);
  });
}

/** How long a toast stays, in ms; null = until dismissed. The clock stops while it is pointed at or focused. */
export function toastDuration(t: Toast): number | null {
  if (t.sticky) return null;
  return t.kind === 'error' || t.action ? 8000 : 4000;
}

export function pushDialog(entry: DialogEntry): void {
  setState((s) => {
    s.app.dialogs.push(entry);
  });
}

export function removeDialog(id: string): void {
  setState((s) => {
    s.app.dialogs = s.app.dialogs.filter((d) => d.id !== id);
  });
}

/**
 * Says something through a live region. Polite for saves, AI phases, tool changes; assertive only for
 * failures that stop work. Repeating the same words still announces them.
 */
export function announce(text: string, level: 'polite' | 'assertive' = 'polite'): void {
  setState((s) => {
    const same = s.app.announce[level].replace(/ $/, '') === text;
    s.app.announce[level] = same && !s.app.announce[level].endsWith(' ') ? `${text} ` : text;
  });
}

export function setJoinIntake(intake: ClassLinkIntake | null): void {
  setState((s) => {
    s.app.joinIntake = intake;
  });
}
