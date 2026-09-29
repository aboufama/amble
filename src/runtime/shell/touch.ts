/**
 * The on-screen controls for touchscreens: a stick (or ◀ ▶ for side-scrollers) on the left and up to three
 * worded buttons on the right, built from the actions the game reads. DOM inside the iframe (multi-touch
 * with pointer capture), 64 px targets at 55 % opacity, kept out of the top 60 px where the HUD lives.
 * Shown on the first touch, always with `touch: 'on'`, never with 'off'. Writes the kit's virtual input.
 */
import type { Action } from '../../play/protocol';
import type { VirtualInput } from '../kit/env';

const CSS = `
.amble-touch{position:absolute;inset:60px 0 0 0;z-index:20;pointer-events:none;display:none;touch-action:none;-webkit-user-select:none;user-select:none}
.amble-touch.on{display:block}
.amble-touch .t-btn{position:absolute;width:64px;height:64px;border-radius:50%;pointer-events:auto;opacity:.55;
  background:rgba(23,19,43,.78);border:2px solid rgba(244,236,220,.85);color:#f4ecdc;display:flex;flex-direction:column;
  align-items:center;justify-content:center;gap:1px;font:700 11px/1 system-ui,sans-serif;letter-spacing:.04em;touch-action:none}
.amble-touch .t-btn.down{opacity:.85;background:rgba(134,243,203,.35);border-color:#86f3cb}
.amble-touch .t-btn svg{width:22px;height:22px}
.amble-touch .t-stick{position:absolute;left:22px;bottom:22px;width:132px;height:132px;border-radius:50%;pointer-events:auto;
  opacity:.55;background:rgba(23,19,43,.55);border:2px solid rgba(244,236,220,.7);touch-action:none}
.amble-touch .t-knob{position:absolute;left:50%;top:50%;width:58px;height:58px;margin:-29px 0 0 -29px;border-radius:50%;
  background:rgba(244,236,220,.85)}
`;

const ICONS: Record<string, string> = {
  jump: '<path d="M12 19V6M6 11l6-6 6 6" />',
  fire: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M6 18l2.5-2.5M15.5 8.5L18 6" />',
  dash: '<path d="M5 6l6 6-6 6M13 6l6 6-6 6" />',
  action: '<circle cx="12" cy="12" r="6" /><path d="M12 9v6M9 12h6" />',
  left: '<path d="M15 5l-7 7 7 7" />',
  right: '<path d="M9 5l7 7-7 7" />',
};

const DEFAULT_LABELS: Partial<Record<Action, string>> = { jump: 'JUMP', fire: 'FIRE', dash: 'DASH', action: 'ACTION' };
const BUTTON_ORDER: Action[] = ['jump', 'fire', 'dash', 'action'];

function icon(name: string): string {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] ?? ''}</svg>`;
}

export class TouchOverlay {
  private readonly root: HTMLDivElement;
  private mode: 'auto' | 'on' | 'off' = 'auto';
  private touched = false;
  private actions: Action[] = [];
  private labels: Partial<Record<Action, string>> = {};
  private layoutKey = '';

  constructor(private readonly input: VirtualInput) {
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.append(style);
    this.root = document.createElement('div');
    this.root.className = 'amble-touch';
    document.body.append(this.root);
    window.addEventListener(
      'pointerdown',
      (e) => {
        if (e.pointerType !== 'touch' || this.touched) return;
        this.touched = true;
        this.update();
      },
      { capture: true },
    );
  }

  setMode(mode: 'auto' | 'on' | 'off'): void {
    this.mode = mode;
    this.update();
  }

  /** The actions the game reads (and its own button words from `config.controls`). */
  setActions(actions: Action[], labels: Partial<Record<Action, string>>): void {
    this.actions = actions;
    this.labels = labels;
    this.update();
  }

  get visible(): boolean {
    return this.root.classList.contains('on');
  }

  private update(): void {
    const show = this.mode === 'on' || (this.mode === 'auto' && this.touched);
    const hasControls = this.actions.some((a) => a !== 'pause');
    this.root.classList.toggle('on', show && hasControls);
    const key = JSON.stringify([this.actions, this.labels]);
    if (key === this.layoutKey) return;
    this.layoutKey = key;
    this.build();
  }

  private build(): void {
    this.release();
    this.root.replaceChildren();
    const used = new Set(this.actions);
    if (used.has('up') || used.has('down')) this.buildStick();
    else if (used.has('left') || used.has('right')) {
      this.button('left', '', 22, null, 'left');
      this.button('right', '', 100, null, 'right');
    }
    const buttons = BUTTON_ORDER.filter((a) => used.has(a)).slice(0, 3);
    buttons.forEach((a, i) => {
      // A triangle of buttons: the first one lowest and furthest right.
      const right = 22 + (i % 2) * 78 + (i === 2 ? 39 : 0);
      const bottom = 22 + (i === 1 ? 26 : 0) + (i === 2 ? 84 : 0);
      this.button(a, this.labels[a] ?? DEFAULT_LABELS[a] ?? a.toUpperCase(), bottom, right, a);
    });
  }

  private button(action: Action, label: string, bottomOrLeft: number, right: number | null, iconName: string): void {
    const b = document.createElement('div');
    b.className = 't-btn';
    b.setAttribute('aria-hidden', 'true');
    b.innerHTML = icon(iconName) + (label ? `<span>${label.replace(/[<>&"]/g, '')}</span>` : '');
    if (right === null) {
      b.style.left = `${bottomOrLeft}px`;
      b.style.bottom = '22px';
    } else {
      b.style.right = `${right}px`;
      b.style.bottom = `${bottomOrLeft}px`;
    }
    const set = (on: boolean) => {
      this.input.actions[action] = on;
      b.classList.toggle('down', on);
    };
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      b.setPointerCapture(e.pointerId);
      set(true);
    });
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) b.addEventListener(type, () => set(false));
    this.root.append(b);
  }

  private buildStick(): void {
    const pad = document.createElement('div');
    pad.className = 't-stick';
    const knob = document.createElement('div');
    knob.className = 't-knob';
    pad.append(knob);
    let id: number | null = null;
    const move = (e: PointerEvent) => {
      const r = pad.getBoundingClientRect();
      const radius = r.width / 2;
      let x = (e.clientX - (r.left + radius)) / radius;
      let y = (e.clientY - (r.top + radius)) / radius;
      const len = Math.hypot(x, y);
      if (len > 1) {
        x /= len;
        y /= len;
      }
      this.input.stick = { x, y };
      knob.style.transform = `translate(${x * radius * 0.55}px, ${y * radius * 0.55}px)`;
    };
    const end = () => {
      id = null;
      this.input.stick = null;
      knob.style.transform = '';
    };
    pad.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      id = e.pointerId;
      pad.setPointerCapture(e.pointerId);
      move(e);
    });
    pad.addEventListener('pointermove', (e) => {
      if (e.pointerId === id) move(e);
    });
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) pad.addEventListener(type, end);
    this.root.append(pad);
  }

  /** Lets go of everything (blur, pause, rebuild). */
  release(): void {
    for (const a of Object.keys(this.input.actions) as Action[]) this.input.actions[a] = false;
    this.input.stick = null;
    for (const b of this.root.querySelectorAll('.down')) b.classList.remove('down');
  }
}
