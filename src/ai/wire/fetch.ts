/**
 * The one door for AI traffic: every request to the configured endpoint goes through `aiFetch`,
 * which refuses any URL whose origin isn't the endpoint's, sends no cookies and no referrer, and
 * adds the endpoint's headers only there.
 */
import { TransportFailure } from './failures';
import type { Transport } from './types';

function pageUrl(): string {
  const href = (globalThis as { location?: { href?: string } }).location?.href;
  return typeof href === 'string' && /^https?:/.test(href) ? href : 'http://localhost/';
}

/** `base` + `/path`, without doubled slashes; a query on the base (Azure's `?api-version=`) stays at the end. */
export function endpointUrl(baseUrl: string, path: string): string {
  const q = baseUrl.indexOf('?');
  const base = q >= 0 ? baseUrl.slice(0, q) : baseUrl;
  const query = q >= 0 ? baseUrl.slice(q) : '';
  return `${base.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}${query}`;
}

export function originOf(url: string): string | null {
  try {
    return new URL(url, pageUrl()).origin;
  } catch {
    return null;
  }
}

export interface AiFetchInit {
  method: 'GET' | 'POST';
  body?: unknown;
  signal: AbortSignal;
}

export async function aiFetch(t: Transport, path: string, init: AiFetchInit): Promise<Response> {
  const url = endpointUrl(t.baseUrl, path);
  const origin = originOf(url);
  if (!origin || origin !== originOf(t.baseUrl)) throw new TransportFailure({ kind: 'config', message: `Refusing to send AI data to ${url}: not the configured endpoint.` });
  const headers: Record<string, string> = { ...t.headers };
  if (init.body !== undefined) headers['Content-Type'] = 'application/json';
  const doFetch = t.fetch ?? globalThis.fetch.bind(globalThis);
  try {
    return await doFetch(url, {
      method: init.method,
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: init.signal,
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      cache: 'no-store',
      mode: 'cors',
    });
  } catch (err) {
    if (init.signal.aborted) throw err;
    throw new TransportFailure({ kind: 'network', message: err instanceof Error ? err.message : String(err), partial: '' });
  }
}

export type AbortCause = 'user' | 'first-byte' | 'stall' | 'total';

/**
 * One attempt's timers: the caller's cancel, the total deadline, an optional wait for the reply
 * to start, and the stall timer that runs only while the reply is being written.
 */
export class Watchdog {
  readonly controller = new AbortController();
  cause: AbortCause | null = null;
  private readonly timers = new Map<AbortCause, ReturnType<typeof setTimeout>>();
  private readonly onParentAbort = () => this.fire('user');

  constructor(
    private readonly parent: AbortSignal | undefined,
    totalMs: number,
    firstByteMs: number | undefined,
  ) {
    if (parent?.aborted) this.fire('user');
    parent?.addEventListener('abort', this.onParentAbort);
    this.set('total', Math.max(0, totalMs));
    if (firstByteMs !== undefined) this.set('first-byte', firstByteMs);
  }

  get signal(): AbortSignal {
    return this.controller.signal;
  }

  /** The reply started: the first-byte limit no longer applies. */
  started(): void {
    this.clear('first-byte');
  }

  /** (Re)arms the stall timer. */
  alive(stallMs: number): void {
    this.set('stall', stallMs);
  }

  dispose(): void {
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
    this.parent?.removeEventListener('abort', this.onParentAbort);
  }

  private set(cause: AbortCause, ms: number): void {
    this.clear(cause);
    this.timers.set(
      cause,
      setTimeout(() => this.fire(cause), ms),
    );
  }

  private clear(cause: AbortCause): void {
    const t = this.timers.get(cause);
    if (t !== undefined) clearTimeout(t);
    this.timers.delete(cause);
  }

  private fire(cause: AbortCause): void {
    if (this.controller.signal.aborted) return;
    this.cause = cause;
    this.controller.abort();
  }
}

/** Waits `ms`, or rejects with a cancel when `signal` aborts first. */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new TransportFailure({ kind: 'cancelled' }));
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(new TransportFailure({ kind: 'cancelled' }));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
