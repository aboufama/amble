/**
 * Class links: how a teacher hands a class the district's AI endpoint on unmanaged devices.
 * The link's fragment carries base64url JSON (fragments never reach the web host):
 *
 *   https://<amble>/#class=<base64url({ v: 1, baseUrl, model, fastModel, visionAllowed, code, name, policy })>
 *
 * `code` is a class code the district proxy checks, sent in a header. A link never carries a
 * provider key: one that looks like it does is refused whole.
 */
import * as F from './fields';
import { looksLikeProviderKey, looksLikeSecret } from './secrets';
import type { AgeBand, ConfigLayer, LockKey, ModerationMode } from './types';

export interface ClassPolicy {
  /** false: AI off for this class. */
  enabled?: boolean;
  ageBand?: AgeBand;
  moderation?: ModerationMode;
  lock?: LockKey[];
  safetyIdentifier?: boolean;
  /** Capabilities the endpoint supports, e.g. ['json_schema', 'stream']. */
  caps?: string[];
  /** The link stops working after this date (YYYY-MM-DD or ISO time). */
  expires?: string;
  requestsMayBeReviewed?: boolean;
}

export interface ClassLink {
  v: 1;
  baseUrl: string;
  model?: string;
  fastModel?: string;
  visionModel?: string;
  visionAllowed?: boolean;
  /** Class code for the district proxy. Not a provider key. */
  code?: string;
  /** Header for the code (default X-Amble-Class). */
  header?: string;
  /** What the student sees: "Room 12 · Period 3". */
  name?: string;
  /** The district's name, for "Connect to SAU 99's AI helper?". */
  district?: string;
  policy?: ClassPolicy;
}

export type ClassLinkRead = { ok: true; link: ClassLink } | { ok: false; error: string };

const MAX_ENCODED = 4096;
const SECRET_FIELD = /^(api[-_]?key|key|token|access[-_]?token|secret|password|passwd|authorization|auth[-_]?token|bearer)$/i;

function toBase64Url(text: string): string {
  let bin = '';
  for (const b of new TextEncoder().encode(text)) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(s: string): string {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

/** Any field named like a credential, or any value that looks like a provider key (or, outside `code`, any secret). */
function carriesSecret(v: unknown, key = ''): boolean {
  if (SECRET_FIELD.test(key)) return true;
  if (typeof v === 'string') return looksLikeProviderKey(v) || (key !== 'code' && looksLikeSecret(v));
  if (Array.isArray(v)) return v.some((x) => carriesSecret(x));
  if (v && typeof v === 'object') return Object.entries(v).some(([k, x]) => carriesSecret(x, k));
  return false;
}

/** The object without its undefined fields (so stored and compared links hold only what was set). */
function defined<T extends object>(o: { [K in keyof T]: T[K] | undefined }): T {
  const out: Partial<T> = {};
  for (const key of Object.keys(o) as Array<keyof T>) if (o[key] !== undefined) out[key] = o[key];
  return out as T;
}

function validDate(v: unknown): string | undefined {
  const t = F.str(v, 40);
  return t && Number.isFinite(Date.parse(t)) ? t : undefined;
}

/** Checks a decoded payload and keeps only the known, valid fields. */
export function validateClassLink(raw: unknown): ClassLinkRead {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: "This class link isn't readable." };
  const o = raw as Record<string, unknown>;
  if (o.v !== 1) return { ok: false, error: 'This class link is from a newer or older Amble. Ask your teacher for a new one.' };
  if (carriesSecret(o)) return { ok: false, error: "This link contains a secret key, so Amble won't use it. Ask your teacher for a class link without a key." };
  const url = F.baseUrl(o.baseUrl);
  if (!url) return { ok: false, error: "This class link doesn't say where the AI helper is." };
  if ('problem' in url) return { ok: false, error: url.problem };
  const p = o.policy && typeof o.policy === 'object' ? (o.policy as Record<string, unknown>) : {};
  const policy = defined<ClassPolicy>({
    enabled: F.bool(p.enabled),
    ageBand: F.band(p.ageBand ?? p.level),
    moderation: F.moderation(p.moderation),
    lock: F.locks(p.lock),
    safetyIdentifier: F.bool(p.safetyIdentifier),
    caps: F.list(p.caps),
    expires: validDate(p.expires ?? o.exp),
    requestsMayBeReviewed: F.bool(p.requestsMayBeReviewed),
  });
  const link: ClassLink = {
    v: 1,
    baseUrl: url.url,
    ...defined<Omit<ClassLink, 'v' | 'baseUrl'>>({
      model: F.str(o.model, 120),
      fastModel: F.str(o.fastModel, 120),
      visionModel: F.str(o.visionModel, 120),
      visionAllowed: F.artToAi(o.visionAllowed),
      code: F.code(o.code),
      header: F.headerName(o.header),
      name: F.str(o.name, 80),
      district: F.str(o.district, 80),
    }),
  };
  if (Object.keys(policy).length) link.policy = policy;
  return { ok: true, link };
}

/** The `class=` value in a URL fragment such as `#class=…` or `#/home?class=…`, or null. */
export function classLinkParam(hash: string): string | null {
  const m = /(?:^#|[#&?/])class=([A-Za-z0-9_-]+)/.exec(hash);
  return m ? m[1] : null;
}

/** Reads a class link from a URL fragment: null when there is none, else the link or why it can't be used. */
export function readClassLink(hash: string): ClassLinkRead | null {
  const param = classLinkParam(hash);
  if (param === null) return null;
  if (param.length > MAX_ENCODED) return { ok: false, error: 'This class link is too long.' };
  try {
    return validateClassLink(JSON.parse(fromBase64Url(param)));
  } catch {
    return { ok: false, error: "This class link is damaged. Try copying it again." };
  }
}

/** The fragment value for a link, for Teacher tools. Throws if the payload carries a key. */
export function encodeClassLink(link: ClassLink): string {
  const checked = validateClassLink(link);
  if (!checked.ok) throw new Error(checked.error);
  return toBase64Url(JSON.stringify(checked.link));
}

/** A whole class link: the app's address plus `#class=…`. */
export function classLinkUrl(appUrl: string, link: ClassLink): string {
  return `${appUrl.replace(/#.*$/, '')}#class=${encodeClassLink(link)}`;
}

/** Has an expiry date passed? A bare date means "through the end of that day"; no date never expires. */
export function isExpired(expires: string | undefined, now = new Date()): boolean {
  if (!expires) return false;
  const end = /^\d{4}-\d{2}-\d{2}$/.test(expires) ? Date.parse(`${expires}T23:59:59.999`) : Date.parse(expires);
  return Number.isFinite(end) && now.getTime() > end;
}

export function isClassLinkExpired(link: ClassLink, now = new Date()): boolean {
  return isExpired(link.policy?.expires, now);
}

export function layerFromClassLink(link: ClassLink | null): ConfigLayer | null {
  if (!link) return null;
  const p = link.policy ?? {};
  return {
    source: 'class-link',
    baseUrl: link.baseUrl,
    auth: link.code ? { type: 'class-code', header: link.header ?? F.DEFAULT_CLASS_HEADER, code: link.code } : { type: 'none' },
    model: link.model,
    fastModel: link.fastModel,
    visionModel: link.visionModel,
    visionAllowed: link.visionAllowed,
    enabled: p.enabled,
    ageBand: p.ageBand,
    moderation: p.moderation,
    lock: p.lock,
    safetyIdentifier: p.safetyIdentifier,
    caps: p.caps ? F.caps(p.caps) : undefined,
    expires: p.expires,
    requestsMayBeReviewed: p.requestsMayBeReviewed,
    label: link.name,
    district: link.district ? { name: link.district, privacyUrl: '', contact: '' } : undefined,
  };
}

// -----------------------------------------------------------------------------
// Storage: a connected class link lives on this device until "Disconnect".
// -----------------------------------------------------------------------------

const STORAGE_KEY = 'amble:class-link';

type KeyValue = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export function saveClassLink(link: ClassLink, storage: KeyValue | null): void {
  storage?.setItem(STORAGE_KEY, JSON.stringify({ link, savedAt: new Date().toISOString() }));
}

export function loadClassLink(storage: KeyValue | null): ClassLink | null {
  try {
    const raw: unknown = JSON.parse(storage?.getItem(STORAGE_KEY) ?? 'null');
    if (!raw || typeof raw !== 'object') return null;
    const checked = validateClassLink((raw as { link?: unknown }).link);
    return checked.ok ? checked.link : null;
  } catch {
    return null;
  }
}

export function clearClassLink(storage: KeyValue | null): void {
  storage?.removeItem(STORAGE_KEY);
}

/**
 * Removes `class=…` from the address bar (and so from later bookmarks and shares), keeping the
 * rest of the fragment. Call it after the student confirms or declines.
 */
export function stripClassLinkFromUrl(win: { location: Pick<Location, 'hash' | 'pathname' | 'search'>; history: Pick<History, 'replaceState' | 'state'> } = window): void {
  const hash = win.location.hash;
  if (classLinkParam(hash) === null) return;
  const rest = hash
    .replace(/([#&?/])class=[A-Za-z0-9_-]+/, '$1')
    .replace(/[?&]$/, '')
    .replace(/\?&/, '?')
    .replace(/&&/, '&');
  const clean = rest === '#' || rest === '#/' || rest === '' ? '' : rest;
  win.history.replaceState(win.history.state, '', `${win.location.pathname}${win.location.search}${clean}`);
}
