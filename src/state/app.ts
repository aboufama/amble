/**
 * The `app` slice (FOUNDATION): where the student is, the layout class, toasts, the dialog stack and the
 * two live regions. Also the class-link intake the router read at boot, for the Join card (M7).
 */
import type { Route } from '../app/routes';
import type { ClassLinkIntake } from '../model/types';
import { setState, getState, type LayoutClass } from './store';

export type ToastKind = 'info' | 'success' | 'error' | 'ai';

export interface Toast {
  id: string;
  text: string;
  kind: ToastKind;
  /** A toast with an action stays until dismissed or acted on. */
  action: { label: string; run: () => void } | null;
  sticky: boolean;
  at: number;
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

let toastCounter = 0;

export function setRoute(route: Route): void {
  setState((s) => {
    s.app.route = route;
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
  /** Stays until dismissed (default: only when there is an action). */
  sticky?: boolean;
}

/** Shows a toast (`role=status`); returns its id. 4 s, 8 s for errors, sticky with an action. */
export function showToast(text: string, o: ToastOptions = {}): string {
  const id = `t${++toastCounter}`;
  const toast: Toast = { id, text, kind: o.kind ?? 'info', action: o.action ?? null, sticky: o.sticky ?? Boolean(o.action), at: Date.now() };
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

/** How long a toast stays, in ms; null = until dismissed. */
export function toastDuration(t: Toast): number | null {
  if (t.sticky) return null;
  return t.kind === 'error' ? 8000 : 4000;
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
