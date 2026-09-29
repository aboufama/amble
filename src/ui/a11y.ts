/**
 * Accessibility helpers (§3.9): text-field detection for single-key shortcuts, reduced motion, focus,
 * roving tabindex maths and read-aloud with local voices only.
 */
import { useEffect, useState } from 'react';
import { announce } from '../state/app';
import { useStore } from '../state/store';

export { announce };

/** True for anything that takes typing: inputs, text areas, selects and contenteditable (CodeMirror). */
export function isTextField(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true;
  if (target instanceof HTMLInputElement) {
    return !['button', 'checkbox', 'radio', 'range', 'color', 'file', 'image', 'reset', 'submit'].includes(target.type);
  }
  return false;
}

/** Whether motion is reduced right now (the in-app setting wins over the system's). */
export function motionReduced(): boolean {
  return typeof document !== 'undefined' && document.documentElement.dataset.motion === 'reduced';
}

/** Reduced motion for components: the Reduce motion setting, else the system preference. */
export function useReducedMotion(): boolean {
  const setting = useStore((s) => s.prefs.reduceMotion);
  const [system, setSystem] = useState(() => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    if (typeof matchMedia === 'undefined') return;
    const mq = matchMedia('(prefers-reduced-motion: reduce)');
    const on = () => setSystem(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return setting === 'on' || (setting === 'system' && system);
}

/** Moves focus without scrolling the page (the page never scrolls at 1280x600 and up). */
export function focusElement(el: HTMLElement | null | undefined): void {
  if (!el) return;
  if (!el.hasAttribute('tabindex') && !/^(A|BUTTON|INPUT|SELECT|TEXTAREA)$/.test(el.tagName)) el.setAttribute('tabindex', '-1');
  el.focus({ preventScroll: true });
}

export type Orientation = 'horizontal' | 'vertical' | 'both';

/** The next index for a roving-tabindex key (arrows, Home, End), or null when the key does not move. */
export function rovingIndex(key: string, index: number, count: number, orientation: Orientation = 'horizontal', loop = true): number | null {
  if (count <= 0) return null;
  const prevKeys = orientation === 'vertical' ? ['ArrowUp'] : orientation === 'horizontal' ? ['ArrowLeft'] : ['ArrowLeft', 'ArrowUp'];
  const nextKeys = orientation === 'vertical' ? ['ArrowDown'] : orientation === 'horizontal' ? ['ArrowRight'] : ['ArrowRight', 'ArrowDown'];
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  if (prevKeys.includes(key)) return index > 0 ? index - 1 : loop ? count - 1 : 0;
  if (nextKeys.includes(key)) return index < count - 1 ? index + 1 : loop ? 0 : count - 1;
  return null;
}

/** Type-ahead: the first label after `from` that starts with the typed text. */
export function typeAhead(labels: string[], typed: string, from: number): number | null {
  const t = typed.toLowerCase();
  for (let k = 1; k <= labels.length; k++) {
    const i = (from + k) % labels.length;
    if (labels[i].toLowerCase().startsWith(t)) return i;
  }
  return null;
}

/** Reads text aloud with an on-device voice only (`localService`); false when there is none. */
export function readAloud(text: string, lang = 'en'): boolean {
  if (typeof speechSynthesis === 'undefined') return false;
  const voice = speechSynthesis.getVoices().find((v) => v.localService && v.lang.startsWith(lang));
  if (!voice) return false;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.voice = voice;
  u.lang = voice.lang;
  u.rate = 0.95;
  speechSynthesis.speak(u);
  return true;
}

/**
 * Where floating layers (menus, popovers, tooltips) are rendered: inside the topmost modal dialog when one
 * is open (everything outside a modal dialog is inert), else the body.
 */
export function layerRoot(): HTMLElement {
  const open = [...document.querySelectorAll<HTMLDialogElement>('dialog[open]')].filter((d) => d.matches(':modal'));
  return open[open.length - 1] ?? document.body;
}

const LAYERS_EVENT = 'amble:layers';

/** Dialog calls this after a modal dialog opens or closes, so floating layers follow the top modal. */
export function notifyLayers(): void {
  if (typeof document !== 'undefined') document.dispatchEvent(new Event(LAYERS_EVENT));
}

/**
 * The element app-wide floating layers (toasts, live regions) render into: the top modal dialog, else
 * the body. Content outside a modal dialog is inert, so a toast's button or a live region there would
 * be unreachable. Null before the first effect.
 */
export function useLayerRoot(): HTMLElement | null {
  const [root, setRoot] = useState<HTMLElement | null>(null);
  useEffect(() => {
    const update = () => setRoot(layerRoot());
    update();
    document.addEventListener(LAYERS_EVENT, update);
    return () => document.removeEventListener(LAYERS_EVENT, update);
  }, []);
  return root;
}
