/** A tiny typed event emitter. */
export class Emitter<Events extends object> {
  private handlers = new Map<keyof Events, Set<(e: never) => void>>();

  on<K extends keyof Events>(type: K, fn: (e: Events[K]) => void): () => void {
    let set = this.handlers.get(type);
    if (!set) {
      set = new Set();
      this.handlers.set(type, set);
    }
    set.add(fn as (e: never) => void);
    return () => set.delete(fn as (e: never) => void);
  }

  emit<K extends keyof Events>(type: K, e: Events[K]): void {
    const set = this.handlers.get(type);
    if (!set) return;
    for (const fn of [...set]) {
      try {
        (fn as (e: Events[K]) => void)(e);
      } catch (err) {
        // A broken listener must never break drawing.
        console.error(err);
      }
    }
  }

  clear(): void {
    this.handlers.clear();
  }
}

/** Rolling sample window with percentiles (for the perf HUD and tests). */
export class Rolling {
  private data: number[] = [];
  constructor(private readonly size = 600) {}

  push(v: number): void {
    this.data.push(v);
    if (this.data.length > this.size) this.data.splice(0, this.data.length - this.size);
  }

  summary(): { n: number; p50: number; p95: number; max: number } {
    const s = [...this.data].sort((a, b) => a - b);
    const q = (p: number): number => (s.length ? Math.round(s[Math.min(s.length - 1, Math.floor(p * (s.length - 1) + 0.5))] * 100) / 100 : 0);
    return { n: s.length, p50: q(0.5), p95: q(0.95), max: s.length ? Math.round(s[s.length - 1] * 100) / 100 : 0 };
  }

  clear(): void {
    this.data = [];
  }
}
