/**
 * What can go wrong on the wire, before it becomes a typed `AiError`: kept separate so that retry,
 * fallback and error-copy decisions are pure functions with tests.
 */
import { aiError, type AiError, type AuthKind } from '../errors';

export type Failure =
  | { kind: 'cancelled' }
  /** fetch threw (DNS, CORS, reset). `partial` is what arrived before it broke. */
  | { kind: 'network'; message: string; partial: string }
  | { kind: 'timeout'; which: 'first-byte' | 'stall' | 'total'; partial: string }
  | { kind: 'http'; status: number; message: string; code?: string; param?: string; retryAfterMs?: number; html: boolean }
  /** An `error` event inside a 200 reply. */
  | { kind: 'stream'; message: string; code?: string; partial: string }
  /** A web page came back where JSON was expected: a filter's block page or a captive portal. */
  | { kind: 'html'; status: number }
  /** The request can't be sent as configured (e.g. the base URL isn't a URL). */
  | { kind: 'config'; message: string };

/** Carries a Failure through promise chains. */
export class TransportFailure extends Error {
  constructor(readonly failure: Failure) {
    super('message' in failure ? failure.message : failure.kind);
    this.name = 'TransportFailure';
  }
}

export function failureOf(err: unknown): Failure {
  if (err instanceof TransportFailure) return err.failure;
  return { kind: 'network', message: err instanceof Error ? err.message : String(err), partial: '' };
}

const QUOTA = /quota|billing|budget|credit balance|spend limit|usage limit/i;
const CONTEXT = /context[_ ]length|context window|maximum context|too many tokens|prompt is too long|reduce the length|input is too long/i;
const FILTERED = /content[_ ]?filter|content management policy|flagged by|safety system|responsible ai policy/i;

function isQuota(f: { status: number; message: string; code?: string }): boolean {
  return f.code === 'insufficient_quota' || f.code === 'quota_exceeded' || f.code === 'billing_hard_limit_reached' || QUOTA.test(f.message);
}

/** Statuses and failures worth another try after a pause. */
export function isRetryable(f: Failure): boolean {
  switch (f.kind) {
    case 'network':
      return true;
    case 'stream':
      return !FILTERED.test(f.message) && f.code !== 'content_filter' && !CONTEXT.test(f.message);
    case 'http':
      if (f.html) return false;
      if (f.status === 429) return !isQuota(f);
      return [408, 409, 425, 500, 502, 503, 504, 520, 521, 522, 523, 524, 529].includes(f.status);
    default:
      return false;
  }
}

export function retryReason(f: Failure): 'rate-limited' | 'server' | 'network' {
  if (f.kind === 'http' && f.status === 429) return 'rate-limited';
  return f.kind === 'network' ? 'network' : 'server';
}

/** `Retry-After` (seconds or an HTTP date) or `retry-after-ms`, in milliseconds. */
export function parseRetryAfter(headers: Headers, now = Date.now()): number | undefined {
  const ms = Number(headers.get('retry-after-ms'));
  if (headers.get('retry-after-ms') !== null && Number.isFinite(ms) && ms >= 0) return ms;
  const raw = headers.get('retry-after');
  if (raw === null || raw.trim() === '') return undefined;
  const seconds = Number(raw);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(raw);
  return Number.isFinite(date) ? Math.max(0, date - now) : undefined;
}

const BACKOFF_MS = [1500, 4000, 9000];
/** A Retry-After longer than this isn't waited out; the student gets "try again in a minute" instead. */
export const MAX_RETRY_WAIT_MS = 60_000;

/**
 * How long to wait before retry number `attempt` (0-based), or null to stop retrying. Honors the
 * server's Retry-After; otherwise backs off exponentially with ±30% jitter, so a class sharing one
 * endpoint doesn't retry in lockstep.
 */
export function retryDelay(f: Failure, attempt: number, random: () => number = Math.random): number | null {
  const asked = f.kind === 'http' ? f.retryAfterMs : undefined;
  if (asked !== undefined) {
    if (asked > MAX_RETRY_WAIT_MS) return null;
    return Math.max(250, Math.round(asked * (1 + 0.1 * random())));
  }
  const base = BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)];
  return Math.round(base * (0.7 + 0.6 * random()));
}

/** Turns a failure into the typed error the UI shows. */
export function classify(f: Failure, ctx: { host: string; auth: AuthKind; online: boolean }): AiError {
  const base = { host: ctx.host, auth: ctx.auth };
  switch (f.kind) {
    case 'cancelled':
      return aiError('cancelled', base);
    case 'network':
      return aiError(ctx.online ? 'blocked-by-filter' : 'offline', { ...base, detail: `Network error: ${f.message}` });
    case 'timeout':
      return aiError('timeout', {
        ...base,
        detail: f.which === 'stall' ? 'The reply stopped arriving.' : f.which === 'first-byte' ? 'The reply never started.' : 'The request ran out of time.',
      });
    case 'html':
      return aiError('blocked-by-filter', { ...base, status: f.status, detail: `Got a web page (HTTP ${f.status}) instead of an AI reply: probably a filter's block page.` });
    case 'config':
      return aiError('setup', { ...base, detail: f.message });
    case 'stream': {
      const detail = `The reply stopped with an error: ${f.message}`;
      if (f.code === 'content_filter' || FILTERED.test(f.message)) return aiError('refused', { ...base, code: f.code, detail });
      if (CONTEXT.test(f.message)) return aiError('too-long', { ...base, code: f.code, detail });
      return aiError('server', { ...base, code: f.code, detail });
    }
    case 'http': {
      const init = { ...base, status: f.status, code: f.code, retryAfterMs: f.retryAfterMs, detail: `HTTP ${f.status}${f.code ? ` (${f.code})` : ''}: ${f.message}` };
      if (f.html) return aiError('blocked-by-filter', init);
      if (f.code === 'content_filter' || (f.status === 400 && FILTERED.test(f.message))) return aiError('refused', init);
      if (f.status === 413 || f.code === 'context_length_exceeded' || CONTEXT.test(f.message)) return aiError('too-long', init);
      if (f.status === 401) return aiError('auth', init);
      if (f.status === 403) return aiError(isQuota(f) ? 'quota' : 'auth', init);
      if (f.status === 429) return aiError(isQuota(f) ? 'quota' : 'rate-limited', init);
      if (f.status >= 500 || f.status === 408) return aiError('server', init);
      if (f.status >= 400) return aiError('setup', init);
      return aiError('server', init);
    }
  }
}
