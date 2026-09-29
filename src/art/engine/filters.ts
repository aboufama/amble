/**
 * Input conditioning: the 1-euro filter (adaptive low-pass: heavy smoothing when slow, light when fast),
 * a pulled-string stabilizer (the "Steady" slider), speed-based simulated pressure for mouse, trackpad and
 * finger, and pen pressure calibration. Positions are in (virtual) screen pixels so the feel does not change
 * with zoom.
 */

function alpha(cutoffHz: number, dt: number): number {
  const tau = 1 / (2 * Math.PI * cutoffHz);
  return 1 / (1 + tau / dt);
}

export class OneEuro2D {
  x = 0;
  y = 0;
  /** Filtered velocity, px/s. */
  vx = 0;
  vy = 0;
  private t = 0;
  private ready = false;

  constructor(
    public minCutoff = 3.0,
    public beta = 0.04,
    public dCutoff = 1.5,
  ) {}

  reset(): void {
    this.ready = false;
  }

  filter(x: number, y: number, tMs: number): void {
    if (!this.ready) {
      this.ready = true;
      this.x = x;
      this.y = y;
      this.vx = this.vy = 0;
      this.t = tMs;
      return;
    }
    let dt = (tMs - this.t) / 1000;
    // Coalesced events can share a timestamp.
    if (!(dt > 0.0005)) dt = 0.0005;
    this.t = tMs;
    const ad = alpha(this.dCutoff, dt);
    this.vx += ad * ((x - this.x) / dt - this.vx);
    this.vy += ad * ((y - this.y) / dt - this.vy);
    const cutoff = this.minCutoff + this.beta * Math.hypot(this.vx, this.vy);
    const a = alpha(cutoff, dt);
    this.x += a * (x - this.x);
    this.y += a * (y - this.y);
  }
}

/** Lazy brush: the ink point only moves when the pen is more than `radius` px away, then is pulled along. */
export class PulledString {
  x = 0;
  y = 0;

  constructor(public radius = 0) {}

  reset(x: number, y: number): void {
    this.x = x;
    this.y = y;
  }

  /** Returns true when the ink point moved. */
  update(px: number, py: number): boolean {
    if (this.radius <= 0) {
      const moved = px !== this.x || py !== this.y;
      this.x = px;
      this.y = py;
      return moved;
    }
    const dx = px - this.x;
    const dy = py - this.y;
    const d = Math.hypot(dx, dy);
    if (d <= this.radius) return false;
    const k = (d - this.radius) / d;
    this.x += dx * k;
    this.y += dy * k;
    return true;
  }
}

/** Speed-based pressure for mouse, trackpad and finger (slow = full width, fast = thinner), smoothed over time. */
export class SimulatedPressure {
  p = 0.85;

  reset(): void {
    this.p = 0.85;
  }

  update(speedPxPerMs: number, dtMs: number, thinning: number): number {
    const target = 1 - thinning * Math.min(1, Math.max(0, (speedPxPerMs - 0.15) / 2.2));
    const k = 1 - Math.exp(-Math.max(1, dtMs) / 45);
    this.p += (target - this.p) * k;
    return this.p;
  }
}

export type PressureFeel = 'light' | 'normal' | 'firm';

const FEEL_GAMMA: Record<PressureFeel, number> = { light: 0.7, normal: 1, firm: 1.4 };

/**
 * Pen pressure shaping: auto-calibration to the session's 95th-percentile pressure (cheap pens that top out
 * at 0.6 still reach full width) and a feel curve. The shaped value is what gets drawn and logged.
 */
export class PressureCalibrator {
  private hist = new Uint32Array(64);
  private count = 0;
  private cachedScale = 1;
  feel: PressureFeel = 'normal';
  enabled = true;

  observe(p: number): void {
    if (!(p > 0.02)) return;
    this.hist[Math.min(63, Math.floor(p * 64))]++;
    this.count++;
    if (this.count % 32 === 0) this.cachedScale = this.computeScale();
  }

  /** The multiplier applied to raw pressure (1 until enough samples were seen). */
  scale(): number {
    return this.enabled ? this.cachedScale : 1;
  }

  apply(p: number): number {
    const v = Math.min(1, Math.max(0, p * this.scale()));
    const g = FEEL_GAMMA[this.feel];
    return g === 1 ? v : Math.pow(v, g);
  }

  private computeScale(): number {
    if (this.count < 240) return 1;
    const target = this.count * 0.95;
    let acc = 0;
    for (let i = 0; i < 64; i++) {
      acc += this.hist[i];
      if (acc >= target) {
        const p95 = (i + 1) / 64;
        return Math.min(1.6, Math.max(1, 0.92 / p95));
      }
    }
    return 1;
  }
}
