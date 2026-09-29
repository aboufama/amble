/**
 * Photosensitivity safety (WCAG 2.3.1): at most 3 full-screen flashes or strobes per second, whatever the
 * game code asks for. Flashes are also softened (alpha cap, saturated red damped) and, with reduced motion,
 * limited further. Pure: the runtime wraps camera flashes, `fx.flash` and big background-colour jumps with it.
 */

export interface FlashPolicy {
  /** Flashes allowed in any sliding one-second window. */
  maxPerSecond: number;
  /** Highest alpha a full-screen flash may reach. */
  maxAlpha: number;
}

export const FLASH_POLICY: FlashPolicy = { maxPerSecond: 3, maxAlpha: 0.55 };
export const FLASH_POLICY_REDUCED: FlashPolicy = { maxPerSecond: 2, maxAlpha: 0.3 };

export function flashPolicy(reducedMotion: boolean): FlashPolicy {
  return reducedMotion ? FLASH_POLICY_REDUCED : FLASH_POLICY;
}

/** Sliding-window rate limiter shared by every flash source in a game. */
export class FlashLimiter {
  private times: number[] = [];
  /** When the last flashes were allowed (for tests and the stats). */
  readonly allowed: number[] = [];

  constructor(private policy: FlashPolicy = FLASH_POLICY) {}

  setPolicy(policy: FlashPolicy): void {
    this.policy = policy;
  }

  get maxAlpha(): number {
    return this.policy.maxAlpha;
  }

  /** True (and counted) when a flash may happen at `now` (ms). */
  allow(now: number): boolean {
    this.times = this.times.filter((t) => now - t < 1000);
    if (this.times.length >= this.policy.maxPerSecond) return false;
    this.times.push(now);
    this.allowed.push(now);
    if (this.allowed.length > 64) this.allowed.shift();
    return true;
  }

  /** How many flashes happened in the second before `now`. */
  recent(now: number): number {
    return this.times.filter((t) => now - t < 1000).length;
  }
}

function channels(color: number): [number, number, number] {
  return [(color >> 16) & 255, (color >> 8) & 255, color & 255];
}

/** Relative luminance (0..1) of a 0xRRGGBB colour. */
export function luminance(color: number): number {
  const [r, g, b] = channels(color).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Saturated red flashes are the most dangerous kind (WCAG "red flash": R / (R + G + B) >= 0.8). */
export function isSaturatedRed(color: number): boolean {
  const [r, g, b] = channels(color);
  return r > 80 && r / (r + g + b) >= 0.8;
}

/** The alpha a flash may actually use. */
export function safeFlashAlpha(requested: number, color: number, policy: FlashPolicy): number {
  const a = Math.max(0, Math.min(1, Number.isFinite(requested) ? requested : 1));
  const damp = isSaturatedRed(color) ? 0.5 : 1;
  return Math.min(a, policy.maxAlpha) * damp;
}

/**
 * A change of the whole-screen colour that reads as a flash: a large jump in luminance.
 * Used to rate-limit games that strobe the camera background.
 */
export function isStrobeJump(from: number, to: number): boolean {
  return Math.abs(luminance(from) - luminance(to)) > 0.35 || (isSaturatedRed(to) && !isSaturatedRed(from));
}

/** A colour part-way between two colours (used to soften a strobe jump that the limiter refused). */
export function mixColor(from: number, to: number, t: number): number {
  const a = channels(from);
  const b = channels(to);
  const c = a.map((v, i) => Math.round(v + (b[i] - v) * t));
  return (c[0] << 16) | (c[1] << 8) | c[2];
}
