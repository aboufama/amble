/**
 * Play mode, seen from inside the game: when the student has not touched a key, the pointer or the screen
 * for 5 seconds, the runtime sends one `objects` report (what is on screen), which is the editor's cue that
 * it may gently ask for a drawing. And a tap on a "just bones" character or thing while the game runs
 * pauses it and tells the editor which one it was (`artClicked`), so the student can draw it: the ghost
 * loop. Games that use the pointer keep their taps (the editor coaches "Pause, then tap" instead).
 */
import type Phaser from 'phaser';
import type { Rect } from '../../play/protocol';
import { currentScene, type AmbleScene } from '../kit/scene';
import { isActor, type Actor } from '../kit/types';
import type { EditorShell } from '../shell/editor';
import { collectObjects } from './objects';

export const IDLE_MS = 5000;

/** Roles a running-game tap lifts to the Desk (big scenery and fast shots are left alone). */
const TAPPABLE = new Set(['hero', 'enemy', 'boss', 'npc', 'item', 'hazard', 'prop', 'decor']);

const INPUT_EVENTS = ['keydown', 'pointerdown', 'touchstart', 'wheel'] as const;

type Shooter = Actor & { shooterState?: { opts: { aim?: string } } };

/** True when the game reads the pointer, so a tap is part of playing. */
export function usesPointer(scene: AmbleScene): boolean {
  const k = scene.__kit;
  if (k?.physicsType === 'matter') return true;
  const input = scene.input;
  if (input && input.listenerCount('pointerdown') + input.listenerCount('pointerup') + input.listenerCount('gameobjectdown') > 0) return true;
  return scene.children.list.some((o) => isActor(o) && (o as Shooter).shooterState?.opts.aim === 'pointer');
}

function kitRunning(scene: AmbleScene | null): boolean {
  const k = scene?.__kit;
  return !!k && k.state === 'play' && !k.paused;
}

export class PlayWatch {
  private lastInput = performance.now();
  private reported = false;
  private timer = 0;

  constructor(
    private readonly shell: EditorShell,
    private readonly active: () => boolean,
  ) {
    const onInput = () => {
      this.lastInput = performance.now();
      this.reported = false;
    };
    for (const type of INPUT_EVENTS) window.addEventListener(type, onInput, { capture: true, passive: true });
    window.addEventListener('pointerdown', (e) => this.onTap(e), { capture: true });
    this.timer = window.setInterval(() => this.tick(), 500);
  }

  /** Starts the idle count again (a new game, or back to Play). */
  reset(): void {
    this.lastInput = performance.now();
    this.reported = false;
  }

  private tick(): void {
    if (!this.active() || this.reported || this.shell.paused()) return;
    const game = this.shell.game();
    const scene = currentScene();
    if (!game || !scene?.__kit || scene.__kit.paused) return;
    if (performance.now() - this.lastInput < IDLE_MS) return;
    this.reported = true;
    this.shell.post({ type: 'objects', items: collectObjects(game).map((f) => f.item) });
  }

  private onTap(e: PointerEvent): void {
    if (!this.active() || this.shell.paused()) return;
    const game = this.shell.game();
    const scene = currentScene();
    if (!game || !scene || !kitRunning(scene) || usesPointer(scene)) return;
    const hit = this.hitTest(game, e.clientX, e.clientY);
    if (!hit) return;
    e.stopImmediatePropagation();
    e.preventDefault();
    this.shell.pause();
    this.shell.post({ type: 'artClicked', key: hit.key, rect: hit.rect });
  }

  private hitTest(game: Phaser.Game, x: number, y: number): { key: string; rect: Rect } | null {
    const found = collectObjects(game, 512).filter((f) => {
      const it = f.item;
      return it.key && !it.drawn && TAPPABLE.has(it.role) && x >= it.x && x <= it.x + it.w && y >= it.y && y <= it.y + it.h;
    });
    if (!found.length) return null;
    // The frontmost, then the smallest (a Grumble in front of the Moon King wins).
    found.sort((a, b) => ((b.obj as { depth?: number }).depth ?? 0) - ((a.obj as { depth?: number }).depth ?? 0) || a.item.w * a.item.h - b.item.w * b.item.h);
    const it = found[0].item;
    return it.key ? { key: it.key, rect: { x: it.x, y: it.y, w: it.w, h: it.h } } : null;
  }

  dispose(): void {
    window.clearInterval(this.timer);
  }
}
