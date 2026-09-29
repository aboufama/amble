/**
 * Dial bursts (§2.7): a student dragging a dial sends dozens of values; Footsteps gets one step per dial
 * once it has rested for 1.5 s ("You turned Orb speed down to 160"). Each dial keeps the value it had
 * before the burst, so a drag that ends where it started records nothing.
 */

export const DIAL_REST_MS = 1500;

export interface DialCommit {
  key: string;
  from: number;
  to: number;
}

export interface Timers {
  set(fn: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

const realTimers: Timers = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

interface Burst {
  from: number;
  to: number;
  timer: unknown;
}

export class DialBurst {
  private readonly bursts = new Map<string, Burst>();
  private readonly timers: Timers;
  private readonly restMs: number;

  constructor(
    private readonly onCommit: (c: DialCommit) => void,
    o: { restMs?: number; timers?: Timers } = {},
  ) {
    this.restMs = o.restMs ?? DIAL_REST_MS;
    this.timers = o.timers ?? realTimers;
  }

  /** A dial moved from `from` to `to` (from is ignored while its burst is open). */
  change(key: string, from: number, to: number): void {
    const open = this.bursts.get(key);
    if (open) this.timers.clear(open.timer);
    const burst: Burst = { from: open ? open.from : from, to, timer: null };
    burst.timer = this.timers.set(() => this.commit(key), this.restMs);
    this.bursts.set(key, burst);
  }

  private commit(key: string): void {
    const b = this.bursts.get(key);
    if (!b) return;
    this.bursts.delete(key);
    this.timers.clear(b.timer);
    if (b.from !== b.to) this.onCommit({ key, from: b.from, to: b.to });
  }

  /** Records every open burst now (leaving the world, the tab hiding). */
  flush(): void {
    for (const key of [...this.bursts.keys()]) this.commit(key);
  }

  /** Forgets open bursts without recording them (the world was replaced). */
  cancel(): void {
    for (const b of this.bursts.values()) this.timers.clear(b.timer);
    this.bursts.clear();
  }

  pending(): boolean {
    return this.bursts.size > 0;
  }
}
