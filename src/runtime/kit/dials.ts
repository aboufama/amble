/**
 * Dials: the numbers a student tunes live (jump power, speed, boss health...).
 *
 * A game declares them in `static dials = { jump: { label, value, min, max, step, live, words } }` or at
 * runtime with `this.tune('jump', 780, { min, max, step, label })`. `this.dials.jump` (alias `this.dial`)
 * and `tune()` always return the current value.
 *
 * How a new value reaches the game:
 * - read every frame (in update(), or through a kit option given as a function: `jump: () => this.dials.jump`),
 *   or not read at all yet (a function option read only when the hero first jumps): it applies at the next
 *   read;
 * - read while the level was being built (create()) and not since, or declared `live: false`: the level
 *   restarts in place (`scene.restart()`, textures kept) so the new value takes effect.
 * Pure: no Phaser, no DOM.
 */
import type { DialInfo, DialSpec } from '../../play/protocol';

export const MAX_DIALS = 16;
const LABEL_MAX = 24;

function finite(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

/** "jumpPower" -> "Jump power" */
export function labelFromKey(key: string): string {
  const words = key
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .trim()
    .toLowerCase();
  return (words.charAt(0).toUpperCase() + words.slice(1)).slice(0, LABEL_MAX) || 'Dial';
}

/** A readable step for a range when the game did not give one (1, 5, 10, 0.1...). */
export function defaultStep(min: number, max: number): number {
  const span = max - min;
  if (!(span > 0)) return 1;
  const raw = span / 100;
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const unit = [1, 2, 5, 10].map((m) => m * pow).find((s) => s >= raw) ?? pow * 10;
  return Number(unit.toPrecision(6));
}

/**
 * Normalizes whatever a game declared into a valid DialSpec: min < max, a positive step, the value inside
 * the range and on a step, a short label. Returns null when there is nothing usable.
 */
export function normalizeDial(key: string, input: unknown, fallbackValue?: number): DialSpec | null {
  const o = typeof input === 'object' && input !== null ? (input as Record<string, unknown>) : {};
  let value = finite(o.value) ?? finite(o.default) ?? fallbackValue;
  let min = finite(o.min);
  let max = finite(o.max);
  if (value === undefined && min === undefined && max === undefined) return null;
  if (value === undefined) value = min !== undefined && max !== undefined ? (min + max) / 2 : (min ?? max ?? 0);
  if (min === undefined) min = value > 0 ? 0 : value - Math.max(1, Math.abs(value));
  if (max === undefined) max = value > 0 ? value * 2 : value + Math.max(1, Math.abs(value));
  if (min > max) [min, max] = [max, min];
  if (min === max) max = min + Math.max(1, Math.abs(min));
  const stepIn = finite(o.step);
  const step = stepIn !== undefined && stepIn > 0 && stepIn <= max - min ? stepIn : defaultStep(min, max);
  const label = typeof o.label === 'string' && o.label.trim() ? o.label.trim().slice(0, LABEL_MAX) : labelFromKey(key);
  const words = typeof o.words === 'string' ? o.words.slice(0, 120) : '';
  const spec: DialSpec = { label, value: 0, min, max, step, live: o.live !== false, words };
  if (typeof o.for === 'string' && /^[A-Za-z_][\w-]{0,63}$/.test(o.for)) spec.for = o.for;
  if (typeof o.unit === 'string' && o.unit.trim()) spec.unit = o.unit.trim().slice(0, 8);
  spec.value = clampDial(spec, value);
  return spec;
}

/** Clamps a value into the dial's range and snaps it to the step grid (anchored at min). */
export function clampDial(spec: Pick<DialSpec, 'min' | 'max' | 'step'>, value: number): number {
  if (!Number.isFinite(value)) return spec.min;
  const v = Math.max(spec.min, Math.min(spec.max, value));
  if (!(spec.step > 0)) return v;
  const snapped = spec.min + Math.round((v - spec.min) / spec.step) * spec.step;
  const clamped = Math.max(spec.min, Math.min(spec.max, snapped));
  return Number(clamped.toPrecision(12));
}

export interface DialChange {
  key: string;
  value: number;
  /** The level must restart for the value to take effect. */
  restart: boolean;
}

interface DialEntry {
  spec: DialSpec;
  current: number;
  source: 'static' | 'tune';
  /** Read while the level was being built: that read is baked into the level. */
  readInBuild: boolean;
  /** Read after the level was built (every frame), so a change applies live. */
  readLive: boolean;
}

/** Holds a game's dials, their current values and how the game reads them. */
export class DialRegistry {
  private readonly dials = new Map<string, DialEntry>();
  /** Values the editor sent before the game declared the dial. */
  private readonly pending = new Map<string, number>();
  private building = true;
  private changed = false;

  constructor(initial: Record<string, number> = {}) {
    for (const [k, v] of Object.entries(initial)) if (Number.isFinite(v)) this.pending.set(k, v);
  }

  /** Declares the dials from `static dials`. Unknown or broken entries are skipped. */
  declareAll(dials: unknown): void {
    if (typeof dials !== 'object' || dials === null) return;
    for (const [key, input] of Object.entries(dials as Record<string, unknown>)) {
      const spec = normalizeDial(key, typeof input === 'number' ? { value: input } : input);
      if (spec) this.add(key, spec, 'static');
    }
  }

  private add(key: string, spec: DialSpec, source: 'static' | 'tune'): DialEntry | null {
    const known = this.dials.get(key);
    if (known) return known;
    if (this.dials.size >= MAX_DIALS) return null;
    const wanted = this.pending.get(key);
    const entry: DialEntry = { spec, current: wanted === undefined ? spec.value : clampDial(spec, wanted), source, readInBuild: this.building, readLive: false };
    this.dials.set(key, entry);
    this.changed = true;
    return entry;
  }

  /** `this.tune(key, default, opts)`: declares the dial on first use and returns its current value. */
  tune(key: string, fallback: number, opts?: unknown): number {
    let entry = this.dials.get(key);
    if (!entry) {
      const o = typeof opts === 'object' && opts !== null ? opts : {};
      const spec = normalizeDial(key, { ...o, value: finite((o as Record<string, unknown>).value) ?? fallback }, fallback);
      entry = (spec && this.add(key, spec, 'tune')) || undefined;
      if (!entry) return Number.isFinite(fallback) ? fallback : 0;
    }
    return this.read(key) ?? entry.current;
  }

  /** The current value (and notes how the game reads it). Undefined for unknown dials. */
  read(key: string): number | undefined {
    const entry = this.dials.get(key);
    if (!entry) return undefined;
    if (this.building) entry.readInBuild = true;
    else entry.readLive = true;
    return entry.current;
  }

  has(key: string): boolean {
    return this.dials.has(key);
  }

  /** The level is being built (create()) until `doneBuilding()`; reads during that time are not live. */
  startBuilding(): void {
    this.building = true;
    for (const entry of this.dials.values()) {
      entry.readInBuild = false;
      entry.readLive = false;
    }
  }

  doneBuilding(): void {
    this.building = false;
  }

  /** A value from the editor. Returns what happened, or null for an unknown dial (kept for later). */
  set(key: string, value: number): DialChange | null {
    const entry = this.dials.get(key);
    if (!entry) {
      if (Number.isFinite(value)) this.pending.set(key, value);
      return null;
    }
    const next = clampDial(entry.spec, value);
    if (next === entry.current) return { key, value: next, restart: false };
    entry.current = next;
    return { key, value: next, restart: !entry.spec.live || (entry.readInBuild && !entry.readLive) };
  }

  values(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [k, e] of this.dials) out[k] = e.current;
    return out;
  }

  list(): DialInfo[] {
    return [...this.dials].map(([key, e]) => ({ key, ...e.spec, current: e.current, source: e.source }));
  }

  /** True once after the set of dials changed (for re-sending the manifest). */
  takeChanged(): boolean {
    const c = this.changed;
    this.changed = false;
    return c;
  }

  /** A read-only live view: `dials.jump` is always the current value. */
  view(): Record<string, number> {
    return new Proxy(Object.create(null) as Record<string, number>, {
      get: (_t, prop) => (typeof prop === 'string' ? this.read(prop) : undefined),
      has: (_t, prop) => typeof prop === 'string' && this.dials.has(prop),
      ownKeys: () => [...this.dials.keys()],
      getOwnPropertyDescriptor: (_t, prop) =>
        typeof prop === 'string' && this.dials.has(prop) ? { configurable: true, enumerable: true, writable: false, value: this.dials.get(prop)?.current } : undefined,
      set: () => false,
    });
  }
}

/** A kit option that may be live: a number, or a function returning one (read every frame). */
export type Num = number | (() => number);

/** Reads a live-or-fixed option; falls back when the function throws or returns garbage. */
export function numOf(v: unknown, fallback: number): number {
  if (typeof v === 'function') {
    try {
      const r: unknown = (v as () => unknown)();
      return typeof r === 'number' && Number.isFinite(r) ? r : fallback;
    } catch {
      return fallback;
    }
  }
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}
