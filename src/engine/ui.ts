import { STAGE_HEIGHT, STAGE_WIDTH } from '../player/protocol';
import { normalizeKey } from './input';

export interface TextOptions {
  /** Anchor in stage coordinates: x -240..240, y -180..180 (0,0 = center of the screen). */
  x?: number;
  y?: number;
  /** Font size in stage pixels (default 20). */
  size?: number;
  color?: string;
  /** Background color, e.g. "rgba(0,0,0,0.5)" (default none). */
  background?: string;
  bold?: boolean;
  align?: 'left' | 'center' | 'right';
}

export interface ValueOptions {
  x?: number;
  y?: number;
  color?: string;
}

export interface ButtonOptions extends TextOptions {
  width?: number;
  height?: number;
  /** false greys the button out and ignores clicks (too dear, not ready yet). Default true. */
  enabled?: boolean;
  /** true rings the button: the tool or tower picked in a build bar. */
  selected?: boolean;
  /** A keyboard shortcut ("1", "q", "space"...): pressing it clicks the button. Shown in its corner. */
  key?: string;
}

interface ValueEntry {
  el: HTMLDivElement;
  valueEl: HTMLSpanElement;
  get: () => unknown;
  last: string;
}

export const UI_CSS = `
.amble-ui { position: absolute; left: 0; top: 0; width: ${STAGE_WIDTH}px; height: ${STAGE_HEIGHT}px; transform-origin: 0 0; pointer-events: none; overflow: hidden; font-family: "Trebuchet MS", "Helvetica Neue", Arial, sans-serif; user-select: none; }
.amble-ui__text { position: absolute; white-space: pre; line-height: 1.15; border-radius: 8px; text-shadow: 0 2px 0 rgba(0,0,0,0.35), 0 0 6px rgba(0,0,0,0.25); }
.amble-ui__value { position: absolute; display: flex; gap: 6px; align-items: center; padding: 3px 4px 3px 8px; background: rgba(255,255,255,0.92); border: 1px solid rgba(0,0,0,0.15); border-radius: 7px; font-size: 12px; font-weight: 700; color: #585c78; }
.amble-ui__value span { min-width: 30px; padding: 1px 6px; border-radius: 5px; background: #f87d21; color: white; text-align: center; }
.amble-ui__button { position: absolute; pointer-events: auto; cursor: pointer; border: none; border-radius: 12px; padding: 8px 18px; font: inherit; font-weight: 700; line-height: 1.15; white-space: pre; color: white; background: #149deb; box-shadow: 0 4px 0 rgba(0,0,0,0.25); transform: translate(-50%, -50%); transition: transform 70ms ease-out, filter 90ms, box-shadow 70ms; }
.amble-ui__button:hover { filter: brightness(1.12); transform: translate(-50%, -50%) scale(1.05); }
.amble-ui__button:active { transform: translate(-50%, calc(-50% + 3px)); box-shadow: 0 1px 0 rgba(0,0,0,0.25); }
.amble-ui__button--off, .amble-ui__button--off:hover, .amble-ui__button--off:active { cursor: default; filter: grayscale(0.9) brightness(0.8); opacity: 0.6; transform: translate(-50%, -50%); box-shadow: 0 4px 0 rgba(0,0,0,0.25); }
.amble-ui__button--picked { outline: 3px solid #ffe066; outline-offset: 2px; }
.amble-ui__button kbd { position: absolute; top: -7px; right: -7px; min-width: 16px; padding: 0 4px; border-radius: 6px; background: rgba(0,0,0,0.72); color: white; font-family: inherit; font-size: 10px; font-weight: 700; line-height: 15px; text-align: center; }
.amble-ui__button:active { transform: translate(-50%, calc(-50% + 3px)); box-shadow: 0 1px 0 rgba(0,0,0,0.25); }
.amble-ui__bubble { position: absolute; width: max-content; max-width: 170px; padding: 6px 10px; background: white; color: #333; border: 2px solid rgba(0,0,0,0.2); border-radius: 14px; font-size: 13px; line-height: 1.25; transform: translate(-50%, -100%); white-space: pre-wrap; word-break: break-word; }
.amble-ui__bubble::after { content: ""; position: absolute; left: var(--tail, 50%); bottom: -9px; width: 12px; height: 12px; background: white; border-right: 2px solid rgba(0,0,0,0.2); border-bottom: 2px solid rgba(0,0,0,0.2); transform: translateX(-50%) rotate(45deg); }
.amble-ui__ask { position: absolute; left: 10px; right: 10px; bottom: 10px; padding: 10px; display: flex; flex-direction: column; gap: 6px; background: white; border: 2px solid #ddd; border-radius: 10px; pointer-events: auto; box-shadow: 0 2px 8px rgba(0,0,0,0.15); }
.amble-ui__ask b { font-size: 13px; color: #333; }
.amble-ui__ask form { display: flex; gap: 6px; }
.amble-ui__ask input { flex: 1; border: 1px solid #ccc; border-radius: 6px; padding: 5px 8px; font: inherit; font-size: 13px; }
.amble-ui__ask button { border: none; border-radius: 6px; background: #149deb; color: white; font-weight: 700; padding: 0 12px; cursor: pointer; }
.amble-ui__banner { position: absolute; left: 0; right: 0; top: 50%; transform: translateY(-50%); padding: 18px 0; text-align: center; font-size: 34px; font-weight: 800; color: white; background: rgba(0,0,0,0.55); text-shadow: 0 3px 0 rgba(0,0,0,0.4); }
.amble-ui__banner small { display: block; margin-top: 4px; font-size: 13px; font-weight: 600; opacity: 0.85; }
.amble-ui__hint { position: absolute; left: 50%; bottom: 12px; transform: translateX(-50%); padding: 4px 10px; font-size: 12px; color: white; background: rgba(0,0,0,0.45); border-radius: 10px; }
`;

/** How far to move a box of `size` starting at `start` so it sits inside 0..`span`, a few pixels from the edge. */
export function nudge(start: number, size: number, span: number, margin = 4): number {
  if (size >= span - 2 * margin) return margin - start;
  if (start < margin) return margin - start;
  if (start + size > span - margin) return span - margin - size - start;
  return 0;
}

function place(el: HTMLElement, x: number, y: number): void {
  el.style.left = `${STAGE_WIDTH / 2 + x}px`;
  el.style.top = `${STAGE_HEIGHT / 2 - y}px`;
}

/**
 * On-screen UI drawn over the game: text, live values, buttons, questions, speech bubbles.
 * Coordinates are stage coordinates (x -240..240, y -180..180) and stay fixed on screen.
 */
export class Ui {
  readonly root: HTMLDivElement;
  private texts = new Map<string, HTMLDivElement>();
  /** What each text last showed, to skip setting it again. */
  private readonly textKeys = new Map<string, string>();
  private buttons = new Map<string, HTMLButtonElement>();
  private values = new Map<string, ValueEntry>();
  private banner: HTMLDivElement | null = null;
  private hint: HTMLDivElement | null = null;
  private asking: Promise<string> | null = null;

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'amble-ui';
    parent.append(this.root);
  }

  /** Shows (or updates) a piece of text identified by `id`. */
  text(id: string, text: unknown, opts: TextOptions = {}): void {
    let el = this.texts.get(id);
    if (!el) {
      el = document.createElement('div');
      el.className = 'amble-ui__text';
      this.root.append(el);
      this.texts.set(id, el);
    }
    const align = opts.align ?? 'center';
    const x = Number(opts.x) || 0;
    const y = Number(opts.y) || 0;
    // A HUD is set again every frame with the same words: only touch the page when something changed.
    const key = JSON.stringify([String(text), x, y, opts.size, opts.color, opts.bold, opts.background, align]);
    if (this.textKeys.get(id) === key && el.style.display !== 'none') return;
    this.textKeys.set(id, key);
    el.textContent = String(text);
    place(el, x, y);
    el.style.fontSize = `${opts.size ?? 20}px`;
    el.style.color = opts.color ?? '#ffffff';
    el.style.fontWeight = opts.bold === false ? '400' : '700';
    el.style.background = opts.background ?? 'transparent';
    el.style.padding = opts.background ? '4px 10px' : '0';
    el.style.textAlign = align;
    el.style.display = '';
    // The whole text stays on the stage: centered text placed near an edge (a score at x = -215)
    // would be cut in half, so it is nudged back in.
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const left = STAGE_WIDTH / 2 + x - (align === 'left' ? 0 : align === 'right' ? w : w / 2);
    const top = STAGE_HEIGHT / 2 - y - h / 2;
    const tx = align === 'left' ? '0px' : align === 'right' ? '-100%' : '-50%';
    el.style.transform = `translate(calc(${tx} + ${w ? nudge(left, w, STAGE_WIDTH) : 0}px), calc(-50% + ${h ? nudge(top, h, STAGE_HEIGHT) : 0}px))`;
  }

  /** Shows a labelled live value (like a Scratch variable monitor). Stacks down the left edge by default. */
  value(label: string, get: () => unknown, opts: ValueOptions = {}): void {
    let entry = this.values.get(label);
    if (!entry) {
      const el = document.createElement('div');
      el.className = 'amble-ui__value';
      el.append(document.createTextNode(label));
      const valueEl = document.createElement('span');
      el.append(valueEl);
      this.root.append(el);
      entry = { el, valueEl, get, last: '' };
      this.values.set(label, entry);
      const index = this.values.size - 1;
      el.style.left = `${6}px`;
      el.style.top = `${6 + index * 28}px`;
    }
    entry.get = get;
    if (opts.x !== undefined || opts.y !== undefined) {
      entry.el.style.left = `${STAGE_WIDTH / 2 + (opts.x ?? -234)}px`;
      entry.el.style.top = `${STAGE_HEIGHT / 2 - (opts.y ?? 174)}px`;
    }
    if (opts.color) entry.valueEl.style.background = opts.color;
    entry.el.style.display = '';
  }

  /**
   * Shows a clickable button (call it again with the same id to change it). `onClick` runs on the
   * next game tick. A button with `enabled: false` is greyed out and ignores clicks and its key.
   */
  button(id: string, label: string, opts: ButtonOptions = {}, onClick: () => void = () => {}): void {
    opts = opts ?? {};
    let el = this.buttons.get(id);
    if (!el) {
      el = document.createElement('button');
      el.className = 'amble-ui__button';
      this.root.append(el);
      this.buttons.set(id, el);
    }
    const key = opts.key === undefined || opts.key === null || opts.key === '' ? '' : normalizeKey(String(opts.key));
    const shown = String(label ?? '');
    const badge = key ? (key.length === 1 ? key.toUpperCase() : key[0].toUpperCase() + key.slice(1)) : '';
    if (el.dataset.label !== shown || el.dataset.badge !== badge) {
      el.textContent = shown;
      if (badge) {
        const kbd = document.createElement('kbd');
        kbd.textContent = badge;
        el.append(kbd);
      }
      el.dataset.label = shown;
      el.dataset.badge = badge;
    }
    const enabled = opts.enabled !== false;
    el.classList.toggle('amble-ui__button--off', !enabled);
    el.classList.toggle('amble-ui__button--picked', opts.selected === true);
    el.setAttribute('aria-disabled', String(!enabled));
    place(el, opts.x ?? 0, opts.y ?? 0);
    el.style.fontSize = `${opts.size ?? 16}px`;
    if (opts.background) el.style.background = opts.background;
    if (opts.color) el.style.color = opts.color;
    if (opts.width) el.style.width = `${opts.width}px`;
    if (opts.height) el.style.height = `${opts.height}px`;
    const press = () => {
      if (enabled) this.queue.push(onClick);
    };
    el.onclick = (e) => {
      e.stopPropagation();
      press();
    };
    el.onpointerdown = (e) => e.stopPropagation();
    el.style.display = '';
    if (key) this.shortcuts.set(id, { key, press, el });
    else this.shortcuts.delete(id);
  }

  /** Keyboard shortcuts of the buttons showing: a key pressed this tick clicks its button. */
  private shortcuts = new Map<string, { key: string; press: () => void; el: HTMLButtonElement }>();

  /** @internal The game calls this for each key pressed this tick. */
  pressKey(key: string): void {
    for (const s of this.shortcuts.values()) if (s.key === key && s.el.isConnected && s.el.style.display !== 'none') s.press();
  }

  /** Callbacks from UI events, run by the game during the next tick. */
  queue: Array<() => void> = [];

  hide(id: string): void {
    const el = this.texts.get(id) ?? this.buttons.get(id) ?? this.values.get(id)?.el;
    if (el) el.style.display = 'none';
  }

  remove(id: string): void {
    this.texts.get(id)?.remove();
    this.buttons.get(id)?.remove();
    this.values.get(id)?.el.remove();
    this.shortcuts.delete(id);
    this.texts.delete(id);
    this.textKeys.delete(id);
    this.buttons.delete(id);
    this.values.delete(id);
  }

  clear(): void {
    [...this.texts.keys(), ...this.buttons.keys(), ...this.values.keys()].forEach((id) => this.remove(id));
    this.banner?.remove();
    this.banner = null;
  }

  showBanner(title: string, subtitle?: string): void {
    this.banner?.remove();
    const el = document.createElement('div');
    el.className = 'amble-ui__banner';
    el.textContent = title;
    if (subtitle) {
      const small = document.createElement('small');
      small.textContent = subtitle;
      el.append(small);
    }
    this.root.append(el);
    this.banner = el;
  }

  showHint(text: string | null): void {
    if (!text) {
      this.hint?.remove();
      this.hint = null;
      return;
    }
    if (!this.hint) {
      this.hint = document.createElement('div');
      this.hint.className = 'amble-ui__hint';
      this.root.append(this.hint);
    }
    this.hint.textContent = text;
  }

  /** Asks the player a question; resolves with their answer. */
  ask(question: string): Promise<string> {
    const previous = this.asking ?? Promise.resolve('');
    const next = previous.then(
      () =>
        new Promise<string>((resolve) => {
          const box = document.createElement('div');
          box.className = 'amble-ui__ask';
          const label = document.createElement('b');
          label.textContent = question;
          const form = document.createElement('form');
          const input = document.createElement('input');
          input.type = 'text';
          const ok = document.createElement('button');
          ok.type = 'submit';
          ok.textContent = 'OK';
          form.append(input, ok);
          box.append(label, form);
          box.addEventListener('pointerdown', (e) => e.stopPropagation());
          box.addEventListener('keydown', (e) => e.stopPropagation());
          form.addEventListener('submit', (e) => {
            e.preventDefault();
            box.remove();
            resolve(input.value);
          });
          this.root.append(box);
          setTimeout(() => input.focus(), 0);
        }),
    );
    this.asking = next;
    return next;
  }

  /** Updates live values; called once per rendered frame. */
  refresh(): void {
    for (const entry of this.values.values()) {
      if (entry.el.style.display === 'none') continue;
      let text: string;
      try {
        const v = entry.get();
        text = typeof v === 'number' && !Number.isInteger(v) ? String(Math.round(v * 100) / 100) : String(v);
      } catch {
        text = '?';
      }
      if (text !== entry.last) {
        entry.last = text;
        entry.valueEl.textContent = text;
      }
    }
  }

  createBubble(): HTMLDivElement {
    const el = document.createElement('div');
    el.className = 'amble-ui__bubble';
    el.style.display = 'none';
    this.root.append(el);
    return el;
  }

  dispose(): void {
    this.root.remove();
  }
}
