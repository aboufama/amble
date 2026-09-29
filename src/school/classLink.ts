/**
 * Class links (§2.14, §5.14): `#class=<base64url(JSON)>` carrying the class name, the district's AI
 * address and class code, the class's AI mode and content level, an expiry and an optional assignment
 * (`ClassLinkV1`, §4.2). The fragment never reaches a web server; Amble sends the class code only to the AI
 * address, in a header.
 *
 * Reading is the AI barrel's `parseClassLink` (https only, nothing key-like, expiry); this file makes links
 * (Teacher desk), caps them to the district's ceiling, and decides between Join and Switch.
 */
import { loadClassLink, looksLikeProviderKey, parseClassLink } from '../cores/ai';
import type { AiMode, ClassLinkIntake, ClassLinkV1, Level } from '../model/types';
import { lowerLevel, lowerMode } from '../state/config';

export const DEFAULT_CLASS_HEADER = 'X-Amble-Class';
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

/** The name of the class this Chromebook is in, from the slice or (at boot, before the store answers) the core's copy. */
export function currentClassName(fromSlice: ClassLinkV1 | null, local: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null): string | null {
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

/** The payload is small enough for a link (and a QR code a class can scan). */
export function payloadFits(link: ClassLinkV1): boolean {
  try {
    return encodeClassLinkV1(link).length <= MAX_PAYLOAD;
  } catch {
    return false;
  }
}
