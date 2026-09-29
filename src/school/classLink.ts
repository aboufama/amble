/**
 * Class links (§2.14, §5.14): `#class=<base64url(JSON)>` carrying the class name, the district's AI
 * address and class code, the class's AI mode and content level, an expiry and an optional assignment
 * (`ClassLinkV1`, §4.2). The fragment never reaches a web server; Amble sends the class code only to the AI
 * address, in a header.
 *
 * Reading is the AI barrel's `parseClassLink` (https only, nothing key-like, expiry); this file makes links
 * (Teacher desk), caps them to the district's ceiling, and decides between Join and Switch.
 */
import { classLinkFromCore, classLinkToCore, loadClassLink, looksLikeProviderKey, parseClassLink, validateClassLink, type AiConfig, type ClassLink } from '../cores/ai';
import { isClassLinkV1 } from '../model/guards';
import type { AiMode, ClassLinkIntake, ClassLinkV1, Level } from '../model/types';
import { lowerLevel, lowerMode } from '../state/config';

export const DEFAULT_CLASS_HEADER = 'X-Amble-Class';

/**
 * The header a class code travels in, for the Teacher desk's links and live test: the one the district set
 * for its AI address (a build's `VITE_AMBLE_AI_AUTH_HEADER`, or the managed configuration's `auth.header`),
 * else `X-Amble-Class`.
 */
export function classCodeHeaderFor(ai: Pick<AiConfig, 'source' | 'classCodeHeader'> | null): string {
  return ai && (ai.source === 'managed' || ai.source === 'build') && ai.classCodeHeader ? ai.classCodeHeader : DEFAULT_CLASS_HEADER;
}
/** The proxy alias most district setups map to their real model (map-school §2.3). */
export const DEFAULT_MODEL = 'amble-default';
/** §4.2: a class link payload is at most 2 KB. */
export const MAX_PAYLOAD = 2048;

export function toBase64Url(text: string): string {
  let bin = '';
  for (const b of new TextEncoder().encode(text)) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function anyKeyLike(v: unknown): boolean {
  if (typeof v === 'string') return looksLikeProviderKey(v);
  if (Array.isArray(v)) return v.some(anyKeyLike);
  if (typeof v === 'object' && v !== null) return Object.values(v).some(anyKeyLike);
  return false;
}

/** Why a link can't be made: a value that looks like a provider key (keys belong on the district's proxy). */
export class UnsafeLinkError extends Error {
  constructor() {
    super('A class link never carries a provider key.');
    this.name = 'UnsafeLinkError';
  }
}

/** The `#class=` value for a link. Throws `UnsafeLinkError` when anything looks like a provider key. */
export function encodeClassLinkV1(link: ClassLinkV1): string {
  if (anyKeyLike(link)) throw new UnsafeLinkError();
  return toBase64Url(JSON.stringify(link));
}

/** The whole link: this copy of Amble's address plus `#class=…`. */
export function classLinkHref(link: ClassLinkV1, appUrl: string = globalThis.location?.href ?? 'https://amble.example/'): string {
  const u = new URL(appUrl);
  return `${u.origin}${u.pathname}#class=${encodeClassLinkV1(link)}`;
}

/** The link for display, at most `total` characters: the host and path, then the start of the payload ("amble.sau99.org/#class=eyJ2Ijox…"). */
export function shortHref(href: string, total = 58): string {
  const u = new URL(href);
  const payload = u.hash.replace(/^#class=/, '');
  const head = `${u.host}${u.pathname.replace(/\/$/, '')}/#class=`;
  const keep = Math.max(8, total - head.length - 1);
  return payload.length > keep ? `${head}${payload.slice(0, keep)}…` : `${head}${payload}`;
}

type KeyValue = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/**
 * The app's own copy of the joined class in localStorage, beside the AI core's (`saveClassLink`): the core's
 * format has no place for the assignment, and a class without an AI address has no core copy at all. When
 * the main copy (the store's `settings.classLink`) is lost, boot rebuilds it from these two.
 */
const CLASS_COPY_KEY = 'amble:class-link:app';

/** Keeps (or, with null, forgets) the app's copy of the joined class. */
export function saveClassCopy(link: ClassLinkV1 | null, storage: KeyValue | null): void {
  if (link) storage?.setItem(CLASS_COPY_KEY, JSON.stringify(link));
  else storage?.removeItem(CLASS_COPY_KEY);
}

/** The app's copy of the joined class, when it is one. */
export function loadClassCopy(storage: KeyValue | null): ClassLinkV1 | null {
  try {
    const raw: unknown = JSON.parse(storage?.getItem(CLASS_COPY_KEY) ?? 'null');
    return isClassLinkV1(raw) ? raw : null;
  } catch {
    return null;
  }
}

/** The link in the AI core's format, as the core checks and stores it: null for a class with no AI part, undefined when the core would refuse it. */
function coreForm(link: ClassLinkV1): ClassLink | null | undefined {
  const core = classLinkToCore(link);
  if (!core) return null;
  const checked = validateClassLink(core);
  return checked.ok ? checked.link : undefined;
}

/**
 * The joined class, rebuilt from the copies in localStorage: the app's own copy when it is the class the AI
 * core has (so its assignment comes back), else the core's copy converted (which has no assignment). Null
 * when neither is there.
 */
export function restoredClassLink(core: ClassLink | null, copy: ClassLinkV1 | null): ClassLinkV1 | null {
  const mine = copy ? coreForm(copy) : undefined;
  if (copy && mine !== undefined) {
    // No core copy: the app's copy is the whole class (a class with no AI part never has one).
    if (!core) return copy;
    // The two are saved together; when they disagree the core's wins (it is what the AI helper uses).
    const theirs = validateClassLink(core);
    if (mine && theirs.ok && JSON.stringify(mine) === JSON.stringify(theirs.link)) return copy;
  }
  return core ? classLinkFromCore(core) : null;
}

/** The name of the class this Chromebook is in, from the slice or (at boot, before the store answers) the core's copy. */
export function currentClassName(fromSlice: ClassLinkV1 | null, local: KeyValue | null): string | null {
  if (fromSlice) return fromSlice.cls;
  try {
    return loadClassLink(local)?.name ?? null;
  } catch {
    return null;
  }
}

/**
 * A `#class=` fragment as the Join card's intake: null when the hash has no class link; otherwise the link
 * (and the class being left, when this Chromebook is in another one) or why it was ignored.
 */
export function readIntake(fragment: string, currentClass: string | null, now: Date = new Date()): ClassLinkIntake | null {
  const read = parseClassLink(fragment, now);
  if (!read) return null;
  if (!read.ok) return read;
  const switchingFrom = currentClass && currentClass !== read.link.cls ? currentClass : null;
  return { ok: true, link: read.link, switchingFrom };
}

export interface DistrictCap {
  /** The highest content level the district allows. */
  levelMax: Level;
  /** false when the district turned the AI helper off. */
  aiAllowed: boolean;
}

/** A link lowered to the district's ceiling: a class link can lower the AI mode and level, never raise them. */
export function capLink(link: ClassLinkV1, cap: DistrictCap): ClassLinkV1 {
  const mode: AiMode = cap.aiAllowed ? link.mode : 'off';
  const asg = link.asg ? { ...link.asg, ai: lowerMode(link.asg.ai, mode), level: link.asg.level ? lowerLevel(link.asg.level, cap.levelMax) : null } : null;
  return { ...link, mode, level: lowerLevel(link.level, cap.levelMax), asg };
}

function isoDate(y: number, m: number, d: number): string {
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/**
 * The default "Link works until": the end of the current semester in a New Hampshire school year (fall
 * ends January 31, spring June 30, summer August 31). A link made in the last days of a semester is for the
 * next one.
 */
export function semesterEnd(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = now.getMonth();
  const d = now.getDate();
  if (m === 0 && d < 20) return isoDate(y, 0, 31);
  if (m < 5 || (m === 5 && d <= 20)) return isoDate(y, 5, 30);
  if (m < 7) return isoDate(y, 7, 31);
  return isoDate(y + 1, 0, 31);
}

/** Why students could not use a link, as the Teacher desk words it. */
export type LinkProblem = 'key' | 'unreadable' | 'long';

/**
 * Why a link would fail on a student's Chromebook, checked with the reader those Chromebooks run: `key`
 * (something in it looks like a provider key, so it is never made), `unreadable` (students would be told
 * the link is damaged, e.g. a class code with letters a header can't carry), `long`; null when it works.
 */
export function linkProblem(link: ClassLinkV1, now: Date = new Date()): LinkProblem | null {
  let encoded: string;
  try {
    encoded = encodeClassLinkV1(link);
  } catch {
    return 'key';
  }
  if (encoded.length > MAX_PAYLOAD) return 'long';
  const read = parseClassLink(`#class=${encoded}`, now);
  if (!read || read.ok || read.reason === 'expired') return null;
  return read.reason === 'unsafe' ? 'key' : 'unreadable';
}

/** The payload is small enough for a link (and a QR code a class can scan). */
export function payloadFits(link: ClassLinkV1): boolean {
  try {
    return encodeClassLinkV1(link).length <= MAX_PAYLOAD;
  } catch {
    return false;
  }
}
