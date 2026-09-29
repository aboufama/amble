/**
 * Synthetic keys: keys forwarded by the editor, the touch overlay and the robot bot are re-dispatched as
 * KeyboardEvents with `keyCode` (what Phaser reads). A key is held for at least one game frame: when down
 * and up land inside the same frame, Phaser's polling (`isDown`, `JustDown`) would never see the press.
 */
import { keyCodeFor } from '../../play/keys';

interface Held {
  key: string;
  code: string;
  keyCode: number;
  /** Frame counter when it went down. */
  frame: number;
  releaseWanted: boolean;
}

export class KeyInjector {
  private readonly held = new Map<string, Held>();
  private frame = 0;

  private dispatch(type: 'keydown' | 'keyup', h: { key: string; code: string; keyCode: number }): void {
    const ev = new KeyboardEvent(type, { key: h.key, code: h.code, keyCode: h.keyCode, which: h.keyCode, bubbles: true, cancelable: true } as KeyboardEventInit);
    window.dispatchEvent(ev);
  }

  down(key: string, code: string, keyCode = keyCodeFor(key, code)): void {
    const known = this.held.get(code);
    if (known) {
      known.releaseWanted = false;
      return;
    }
    const h: Held = { key, code, keyCode, frame: this.frame, releaseWanted: false };
    this.held.set(code, h);
    this.dispatch('keydown', h);
  }

  up(code: string): void {
    const h = this.held.get(code);
    if (!h) return;
    if (this.frame > h.frame) this.release(h);
    else h.releaseWanted = true;
  }

  private release(h: Held): void {
    this.held.delete(h.code);
    this.dispatch('keyup', h);
  }

  isDown(code: string): boolean {
    const h = this.held.get(code);
    return !!h && !h.releaseWanted;
  }

  /** Call once per game frame: releases keys whose up arrived too early. */
  frameDone(): void {
    this.frame++;
    for (const h of [...this.held.values()]) if (h.releaseWanted && this.frame > h.frame) this.release(h);
  }

  releaseAll(): void {
    for (const h of [...this.held.values()]) this.release(h);
  }
}
