/**
 * The robot test's autopilot. It plays by the hero's behaviours, on game time:
 * - platformer or runner: right for 1.5 s, then left for 1 s; jump every 0.7 s, fire held, dash every 2 s;
 * - top-down: walks in a circle with fire held;
 * - flyer or shooter: strafes left and right with fire held, flapping up now and then;
 * - physics toy (Matter, no hero): clicks 5 seeded points, then drags once;
 * - anything else: Space, the arrows, and a click in the middle.
 * Kit games get virtual actions (what the touch overlay uses); plain Phaser games get real key events.
 */
import Phaser from 'phaser';
import type { Action } from '../../play/protocol';
import type { VirtualInput } from '../kit/env';
import { currentScene } from '../kit/scene';
import type { Actor } from '../kit/types';
import { seeded } from '../kit/util';
import type { KeyInjector } from './keys';

type Plan = 'platformer' | 'topdown' | 'flyer' | 'toy' | 'keys';

const KEYS: Partial<Record<Action, { key: string; code: string }>> = {
  left: { key: 'ArrowLeft', code: 'ArrowLeft' },
  right: { key: 'ArrowRight', code: 'ArrowRight' },
  up: { key: 'ArrowUp', code: 'ArrowUp' },
  down: { key: 'ArrowDown', code: 'ArrowDown' },
  jump: { key: ' ', code: 'Space' },
  fire: { key: 'x', code: 'KeyX' },
  dash: { key: 'Shift', code: 'ShiftLeft' },
};

function heroOf(): Actor | null {
  const h = currentScene()?.__kit?.hero;
  return h && h.active ? h : null;
}

function planFor(): Plan {
  const scene = currentScene();
  const h = heroOf();
  if (h?.ctl) return 'platformer';
  if (h?.topdownOpts) return 'topdown';
  if (h?.flyerOpts || h?.shooterState) return 'flyer';
  if (!h && scene?.__kit?.physicsType === 'matter') return 'toy';
  return 'keys';
}

export class RobotBot {
  private readonly rand: () => number;
  private held: Partial<Record<Action, boolean>> = {};
  private readonly clicks: Array<{ at: number; x: number; y: number; to?: { x: number; y: number } }> = [];
  private dragging: { from: { x: number; y: number }; to: { x: number; y: number }; start: number } | null = null;

  constructor(
    private readonly game: Phaser.Game,
    private readonly input: VirtualInput,
    private readonly keys: KeyInjector,
    seed: number,
  ) {
    this.rand = seeded(seed * 7919 + 13);
    const W = game.scale.width;
    const H = game.scale.height;
    for (let i = 0; i < 5; i++) this.clicks.push({ at: 500 + i * 450, x: W * (0.2 + this.rand() * 0.6), y: H * (0.25 + this.rand() * 0.5) });
    this.clicks.push({ at: 3000, x: W * 0.35, y: H * 0.4, to: { x: W * 0.65, y: H * 0.3 } });
  }

  /** Called before every game frame with the game time in ms. */
  tick(t: number): void {
    const want: Partial<Record<Action, boolean>> = {};
    const plan = planFor();
    const pulse = (period: number, width = 120, offset = 0) => (t + offset) % period < width;
    if (plan === 'platformer') {
      const c = t % 2500;
      if (c < 1500) want.right = true;
      else want.left = true;
      want.jump = pulse(700);
      want.fire = true;
      want.dash = pulse(2000, 100, 900);
      this.input.stick = null;
    } else if (plan === 'topdown') {
      const a = t / 600;
      this.input.stick = { x: Math.cos(a), y: Math.sin(a) };
      want.fire = true;
    } else if (plan === 'flyer') {
      if (Math.floor(t / 1000) % 2 === 0) want.right = true;
      else want.left = true;
      want.up = pulse(900, 250);
      want.jump = pulse(900, 120);
      want.fire = true;
      this.input.stick = null;
    } else if (plan === 'toy') {
      this.toy(t);
    } else {
      want.jump = pulse(700);
      want.right = t % 2000 < 1000;
      want.left = t % 2000 >= 1000;
      want.fire = pulse(500, 200);
      if (Math.abs(t - 1000) < 9) this.click(this.game.scale.width / 2, this.game.scale.height / 2);
    }
    this.apply(want, currentScene()?.__kit ? 'virtual' : 'keys');
  }

  private toy(t: number): void {
    for (const c of this.clicks) {
      if (t < c.at || t >= c.at + 17) continue;
      if (c.to) {
        this.dragging = { from: { x: c.x, y: c.y }, to: c.to, start: t };
        this.mouse('mousedown', c.x, c.y);
      } else this.click(c.x, c.y);
    }
    const d = this.dragging;
    if (!d) return;
    const f = Math.min(1, (t - d.start) / 500);
    this.mouse('mousemove', d.from.x + (d.to.x - d.from.x) * f, d.from.y + (d.to.y - d.from.y) * f);
    if (f >= 1) {
      this.mouse('mouseup', d.to.x, d.to.y);
      this.dragging = null;
    }
  }

  private apply(want: Partial<Record<Action, boolean>>, via: 'virtual' | 'keys'): void {
    for (const a of Object.keys(KEYS) as Action[]) {
      const on = !!want[a];
      if (on === !!this.held[a]) continue;
      this.held[a] = on;
      if (via === 'virtual') this.input.actions[a] = on;
      else {
        const k = KEYS[a];
        if (!k) continue;
        if (on) this.keys.down(k.key, k.code);
        else this.keys.up(k.code);
      }
    }
  }

  private click(x: number, y: number): void {
    this.mouse('mousedown', x, y);
    this.mouse('mouseup', x, y);
  }

  /** A mouse event at game coordinates (Phaser listens for mouse events on the canvas). */
  private mouse(type: 'mousedown' | 'mousemove' | 'mouseup', x: number, y: number): void {
    const canvas = this.game.canvas;
    const r = canvas.getBoundingClientRect();
    const sx = r.width / this.game.scale.width || 1;
    const sy = r.height / this.game.scale.height || 1;
    const ev = new MouseEvent(type, { clientX: r.left + x * sx, clientY: r.top + y * sy, button: 0, buttons: type === 'mouseup' ? 0 : 1, bubbles: true, cancelable: true });
    canvas.dispatchEvent(ev);
  }

  /** Lets go of everything at the end. */
  stop(): void {
    this.apply({}, currentScene()?.__kit ? 'virtual' : 'keys');
    this.input.stick = null;
  }
}
