/** Combos: `this.combo.hit()` bumps a counter that expires after `window` ms and multiplies the score. */
import type { Kit } from './state';

export class Combo {
  count = 0;
  best = 0;
  /** ms without a hit before the combo ends. */
  window = 1800;
  private left = 0;

  constructor(private readonly k: Kit) {}

  /** Score multiplier: 1, then +1 every 3 hits. */
  get mult(): number {
    return 1 + Math.floor(this.count / 3);
  }

  hit(_x?: number, _y?: number): number {
    this.count++;
    this.best = Math.max(this.best, this.count);
    this.left = this.window;
    if (this.count >= 2) {
      this.k.ui.comboText(this.count);
      this.k.scene.sfx('combo', { pitch: 1 + Math.min(1, this.count * 0.06) });
      if (this.count % 5 === 0) {
        this.k.fx.punch(0.04);
        this.k.fx.chroma(0.008, 250);
      }
    }
    return this.count;
  }

  reset(): void {
    if (this.count >= 2) this.k.ui.comboEnd();
    this.count = 0;
  }

  tick(dt: number): void {
    if (this.count && (this.left -= dt) <= 0) this.reset();
  }
}
