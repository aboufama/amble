/**
 * In-memory localStorage / sessionStorage. In a sandbox without allow-same-origin the real ones throw a
 * SecurityError, and game code loves `localStorage.getItem('best')`. Local storage is saved per game by the
 * editor: changes are posted (debounced) and come back in the next `init`. Also supports
 * `localStorage.best = 5` and `localStorage.best`.
 */

export interface MemoryStorage extends Storage {
  snapshot(): Record<string, string>;
}

const MAX_KEYS = 500;
const MAX_VALUE = 100_000;
/** Writes are saved together 250 ms after they stop, but never later than this after the first one. */
const MAX_WAIT_MS = 1000;

export function createStorage(initial: Record<string, string>, onChange: ((data: Record<string, string>) => void) | null): MemoryStorage {
  const map = new Map<string, string>(Object.entries(initial));
  let timer = 0;
  /** When the oldest unsaved change happened. */
  let since: number | null = null;
  const flush = (): void => {
    clearTimeout(timer);
    since = null;
    onChange?.(Object.fromEntries(map));
  };
  const changed = (): void => {
    if (!onChange) return;
    const now = Date.now();
    since ??= now;
    clearTimeout(timer);
    // A game that saves every frame never pauses long enough for a plain debounce: save it every second.
    if (now - since >= MAX_WAIT_MS) flush();
    else timer = window.setTimeout(flush, 250);
  };
  const api = {
    get length() {
      return map.size;
    },
    key(i: number): string | null {
      return [...map.keys()][i] ?? null;
    },
    getItem(k: string): string | null {
      return map.get(String(k)) ?? null;
    },
    setItem(k: string, v: unknown): void {
      const key = String(k);
      if (!map.has(key) && map.size >= MAX_KEYS) return;
      map.set(key, String(v).slice(0, MAX_VALUE));
      changed();
    },
    removeItem(k: string): void {
      if (map.delete(String(k))) changed();
    },
    clear(): void {
      map.clear();
      changed();
    },
    snapshot(): Record<string, string> {
      return Object.fromEntries(map);
    },
  };
  return new Proxy(api, {
    get(t, p) {
      if (typeof p === 'symbol' || p in t) return Reflect.get(t, p);
      return t.getItem(p);
    },
    set(t, p, v) {
      if (typeof p === 'symbol' || p in t) return false;
      t.setItem(p, v);
      return true;
    },
    deleteProperty(t, p) {
      if (typeof p !== 'symbol') t.removeItem(p);
      return true;
    },
    has(t, p) {
      return typeof p === 'symbol' ? p in t : p in t || map.has(p);
    },
    ownKeys() {
      return [...map.keys()];
    },
    getOwnPropertyDescriptor(_t, p) {
      return typeof p === 'string' && map.has(p) ? { configurable: true, enumerable: true, writable: true, value: map.get(p) } : undefined;
    },
  }) as unknown as MemoryStorage;
}

/** Installs the shims on window (replacing earlier ones, e.g. when `init` brings saved data). */
export function installStorage(local: MemoryStorage, session: MemoryStorage): void {
  for (const [name, value] of [['localStorage', local], ['sessionStorage', session]] as const) {
    try {
      Object.defineProperty(window, name, { value, configurable: true, writable: false });
    } catch {
      /* already non-configurable in this browser: leave it */
    }
  }
}
