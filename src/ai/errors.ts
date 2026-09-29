/**
 * Typed AI errors. Every failure the transport can hit becomes one `AiError` whose `kind` the UI
 * switches on and whose `message` a student can read. Technical text goes in `detail` (for "More"),
 * and never contains a key or class code.
 */

export type AiErrorKind =
  /** No AI endpoint is configured, or it is turned off for this device or class. */
  | 'no-config'
  /** The key or class code was rejected (401/403). */
  | 'auth'
  /** The class or account used up its AI budget (403 quota, 429 insufficient_quota). */
  | 'quota'
  /** Still rate limited after the automatic retries (429). */
  | 'rate-limited'
  /** The endpoint can't be reached although the device is online: a web filter, CORS, or a block page. */
  | 'blocked-by-filter'
  /** The device is offline. */
  | 'offline'
  /** The endpoint went quiet mid-reply or the whole request ran past its time limit. */
  | 'timeout'
  /** The reply or the request was too long (finish_reason length, context length, 413). */
  | 'too-long'
  /** The model refused, or a content filter blocked the request or reply. */
  | 'refused'
  /** The reply couldn't be read: not JSON, or the wrong shape even after a repair round. */
  | 'bad-reply'
  /** The endpoint is misconfigured: unknown model, wrong path, a request it will never accept. */
  | 'setup'
  /** The service failed (5xx) and kept failing through the retries. */
  | 'server'
  /** The caller cancelled. */
  | 'cancelled';

/** How the transport authenticates; it picks the right words for an auth error. */
export type AuthKind = 'none' | 'key' | 'class-code' | 'dev';

export interface AiErrorInit {
  /** Technical detail for a "More" section: status, provider message. Never credentials. */
  detail?: string;
  status?: number;
  /** Provider error code, e.g. `content_filter`, `insufficient_quota`. */
  code?: string;
  /** The endpoint's host, e.g. `amble-ai.sau99.org`. */
  host?: string;
  /** How long the service asked us to wait, when it said. */
  retryAfterMs?: number;
}

export class AiError extends Error {
  readonly kind: AiErrorKind;
  readonly detail: string;
  readonly status?: number;
  readonly code?: string;
  readonly host?: string;
  readonly retryAfterMs?: number;

  constructor(kind: AiErrorKind, message: string, init: AiErrorInit = {}) {
    super(message);
    this.name = 'AiError';
    this.kind = kind;
    this.detail = init.detail ?? '';
    this.status = init.status;
    this.code = init.code;
    this.host = init.host;
    this.retryAfterMs = init.retryAfterMs;
  }
}

export function isAiError(err: unknown): err is AiError {
  return err instanceof AiError;
}

export interface KidMessageContext {
  host?: string;
  auth?: AuthKind;
}

/** The default words a student sees for each kind of failure. UI string tables may override them. */
export function kidMessage(kind: AiErrorKind, ctx: KidMessageContext = {}): string {
  const host = ctx.host || 'the AI helper';
  switch (kind) {
    case 'no-config':
      return "The AI helper isn't turned on here. You can still draw, tune your game and change its code. Ask your teacher to turn it on.";
    case 'auth':
      if (ctx.auth === 'class-code') return 'Your class link has expired. Ask your teacher for a new one.';
      if (ctx.auth === 'key') return "The AI service didn't accept the key. Check it in Settings.";
      return 'The AI service said no to Amble. Ask your teacher to check the AI settings.';
    case 'quota':
      return "Your class used today's AI time. It comes back tomorrow.";
    case 'rate-limited':
      return 'Lots of people are using the AI helper right now. Try again in a minute.';
    case 'blocked-by-filter':
      return `Amble couldn't reach ${host}. Your school's web filter may be blocking it. Everything else still works.`;
    case 'offline':
      return "You're offline. The AI helper needs the internet, but everything else still works.";
    case 'timeout':
      return 'The AI helper took too long to answer. Try again?';
    case 'too-long':
      return 'That was too big for one go. Try a smaller step.';
    case 'refused':
      return "Amble can't make that one. Try a different idea!";
    case 'bad-reply':
      return "The AI helper's answer came back jumbled. Try again?";
    case 'setup':
      return "The AI helper isn't set up right. Ask your teacher to check the AI settings.";
    case 'server':
      return 'The AI service had a problem. Try again in a minute.';
    case 'cancelled':
      return 'Stopped.';
  }
}

/** Builds an AiError with the default student-facing message. */
export function aiError(kind: AiErrorKind, init: AiErrorInit & { auth?: AuthKind } = {}): AiError {
  return new AiError(kind, kidMessage(kind, { host: init.host, auth: init.auth }), init);
}
