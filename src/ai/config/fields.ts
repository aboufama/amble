/** Readers for untrusted configuration values (managed config, build variables, class links). */
import type { Capabilities } from '../wire/types';
import { looksLikeProviderKey, looksLikeSecret } from './secrets';
import { AGE_BANDS, type AgeBand, type DistrictInfo, type LockKey, type ModerationMode } from './types';

export function str(v: unknown, max = 200): string | undefined {
  if (typeof v !== 'string') return undefined;
  const t = v.trim();
  return t && t.length <= max ? t : undefined;
}

export function bool(v: unknown): boolean | undefined {
  if (typeof v === 'boolean') return v;
  if (typeof v !== 'string') return undefined;
  const t = v.trim().toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(t)) return true;
  if (['false', '0', 'no', 'off'].includes(t)) return false;
  return undefined;
}

export function band(v: unknown): AgeBand | undefined {
  const t = typeof v === 'string' ? v.trim().toLowerCase() : '';
  return (AGE_BANDS as readonly string[]).includes(t) ? (t as AgeBand) : undefined;
}

/** A list given as an array or a comma-separated string. */
export function list(v: unknown): string[] | undefined {
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === 'string').map((x) => x.trim().toLowerCase()).filter(Boolean);
  if (typeof v === 'string') return v.split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
  return undefined;
}

export function bands(v: unknown): AgeBand[] | undefined {
  const l = list(v);
  return l ? l.map(band).filter((b): b is AgeBand => b !== undefined) : undefined;
}

export function locks(v: unknown): LockKey[] | undefined {
  const l = list(v);
  if (!l) return undefined;
  const out = new Set<LockKey>();
  for (const x of l) {
    if (x === 'ai' || x === 'content') out.add(x);
    if (x === 'vision' || x === 'art') out.add('vision');
  }
  return [...out];
}

export function moderation(v: unknown): ModerationMode | undefined {
  const t = typeof v === 'string' ? v.trim().toLowerCase() : '';
  return t === 'endpoint' || t === 'provider' || t === 'local-only' ? t : undefined;
}

/** A capability list: what's listed is on, everything else off. */
export function caps(v: unknown): Capabilities | undefined {
  const l = list(v);
  if (!l) return undefined;
  const has = (...names: string[]) => names.some((n) => l.includes(n));
  return {
    jsonSchema: has('json_schema', 'json-schema', 'structured'),
    stream: has('stream', 'streaming'),
    reasoning: has('reasoning', 'reasoning_effort'),
    images: has('images', 'vision'),
    moderation: has('moderation', 'moderations'),
  };
}

/** "Can the AI see pictures": `true`, or the allowArtToAI levels `silhouette`/`drawing`. */
export function artToAi(v: unknown): boolean | undefined {
  if (typeof v === 'string' && ['silhouette', 'drawing', 'outline'].includes(v.trim().toLowerCase())) return true;
  return bool(v);
}

/** An https link that is safe to show as a link (never `javascript:` and the like). */
export function httpsUrl(v: unknown): string | undefined {
  const t = str(v, 500);
  if (!t) return undefined;
  try {
    return new URL(t).protocol === 'https:' ? t : undefined;
  } catch {
    return undefined;
  }
}

export function district(v: unknown): DistrictInfo | undefined {
  if (typeof v === 'string') return str(v) ? { name: str(v) as string, privacyUrl: '', contact: '' } : undefined;
  if (!v || typeof v !== 'object') return undefined;
  const o = v as Record<string, unknown>;
  const name = str(o.name);
  return name ? { name, privacyUrl: httpsUrl(o.privacyUrl) ?? '', contact: str(o.contact) ?? '' } : undefined;
}

/**
 * A class code: short and printable (spaces inside are fine: "MAPLE 7Q2K" is a valid header value). It may
 * look random, but it must not be a provider key.
 */
export function code(v: unknown): string | undefined {
  const t = str(v, 80);
  if (!t || !/^[\x21-\x7e](?:[\x20-\x7e]*[\x21-\x7e])?$/.test(t)) return undefined;
  return looksLikeProviderKey(t) ? undefined : t;
}

export function headerName(v: unknown): string | undefined {
  const t = str(v, 64);
  return t && /^[A-Za-z0-9-]+$/.test(t) && !/^(cookie|host|origin|referer|content-length|content-type)$/i.test(t) ? t : undefined;
}

export const DEFAULT_CLASS_HEADER = 'X-Amble-Class';

/**
 * An OpenAI-compatible base URL, checked: https (or http on this computer), no credentials in it.
 * Returns the URL without trailing slashes, or a problem to show.
 */
export function baseUrl(v: unknown): { url: string } | { problem: string } | undefined {
  const raw = str(v, 500);
  if (!raw) return undefined;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return { problem: `"${raw.slice(0, 80)}" isn't a web address.` };
  }
  const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname === '[::1]';
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && local)) return { problem: 'The AI address must start with https://.' };
  if (u.username || u.password || looksLikeSecret(raw)) return { problem: 'The AI address contains a key or password, so Amble ignored it. Keys belong on the district proxy.' };
  return { url: raw.replace(/\/+$/, '') };
}
