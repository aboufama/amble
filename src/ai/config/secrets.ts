/**
 * Keeps provider keys out of places that are public: build-time `VITE_*` variables are baked into
 * the JavaScript every visitor downloads, and class links travel through chats and browser history.
 * Pure and dependency-free, so `vite.config.ts` can import it (`assertNoKeyInEnv`).
 */

const KEY_PREFIXES = [
  /(^|[^A-Za-z0-9])(sk|rk)[-_][A-Za-z0-9_-]{8,}/, // OpenAI, Anthropic, LiteLLM virtual keys, Stripe-style keys
  /(^|[^A-Za-z0-9])(AIza[0-9A-Za-z_-]{20,}|ghp_[A-Za-z0-9]{20,}|gho_[A-Za-z0-9]{20,}|github_pat_\w{20,}|hf_[A-Za-z0-9]{20,}|gsk_[A-Za-z0-9]{20,}|xai-[A-Za-z0-9]{20,}|glpat-[A-Za-z0-9_-]{16,}|AKIA[0-9A-Z]{16}|xox[abprs]-[A-Za-z0-9-]{10,})/,
];
const JWT = /(^|[^A-Za-z0-9_-])eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]*/;
const BEARER = /\bbearer\s+\S/i;
const ASSIGNMENT = /(api[-_ ]?key|secret|password|passwd|token|credential)s?\s*[:=]/i;
const URL_SECRET = /[?&](api[-_]?key|key|token|access_token|secret|sig|signature|password)=/i;
const URL_USER = /^[a-z][a-z0-9+.-]*:\/\/[^/@\s]+:[^/@\s]*@/i;

function entropy(s: string): number {
  const counts = new Map<string, number>();
  for (const ch of s) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  let bits = 0;
  for (const n of counts.values()) {
    const p = n / s.length;
    bits -= p * Math.log2(p);
  }
  return bits;
}

/** A long unbroken run of letters and digits: what keys look like and names, URLs and model ids don't. */
function hasRandomRun(value: string): boolean {
  for (const seg of value.split(/[-_./:@?&=#,;\s]+/)) {
    if (seg.length >= 24) return true;
    if (seg.length >= 16 && /[A-Za-z]/.test(seg) && /\d/.test(seg) && entropy(seg) >= 3.5) return true;
  }
  return false;
}

function parseHttpUrl(v: string): URL | null {
  if (!/^https?:\/\//i.test(v)) return null;
  try {
    return new URL(v);
  } catch {
    return null;
  }
}

/** A provider's key or token format (sk-..., AIza..., a JWT, "Bearer ..."), as opposed to any random-looking text. */
export function looksLikeProviderKey(value: string): boolean {
  const v = value.trim();
  return KEY_PREFIXES.some((re) => re.test(v)) || JWT.test(v) || BEARER.test(v);
}

/** Does this look like an API key, a bearer token, or a URL carrying credentials? */
export function looksLikeSecret(value: string): boolean {
  const v = value.trim();
  if (!v) return false;
  if (KEY_PREFIXES.some((re) => re.test(v)) || JWT.test(v) || BEARER.test(v) || ASSIGNMENT.test(v) || URL_SECRET.test(v) || URL_USER.test(v)) return true;
  // Ids in a URL's host and path are not secrets (a gateway's account id is 32 hex digits); only
  // the query and fragment are checked for random runs.
  const url = parseHttpUrl(v);
  return url ? hasRandomRun(`${url.search} ${url.hash}`) : hasRandomRun(v);
}

const SECRET_NAME = /(^|_)(KEY|APIKEY|API_KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIALS?|PRIVATE)(_|$)/;
/** Version and commit ids look random but aren't secrets. */
const BUILD_ID_NAME = /_(VERSION|COMMIT|SHA|BUILD|BUILD_ID)$/;
const BUILD_ID_VALUE = /^([0-9a-f]{7,40}|v?\d+\.\d+\.\d+[\w.+-]*)$/i;

/**
 * Names of `VITE_*` variables that must not be in a build: any whose name says it holds a key or
 * token, and any `VITE_AMBLE_*` whose value looks like one. Values are never returned.
 */
export function findSecretsInEnv(env: Record<string, unknown>): string[] {
  const found: string[] = [];
  for (const [name, raw] of Object.entries(env)) {
    if (!name.startsWith('VITE_') || typeof raw !== 'string' || raw.trim() === '') continue;
    if (SECRET_NAME.test(name.slice('VITE_'.length))) found.push(name);
    else if (name.startsWith('VITE_AMBLE_') && !(BUILD_ID_NAME.test(name) && BUILD_ID_VALUE.test(raw.trim())) && looksLikeSecret(raw)) found.push(name);
  }
  return found.sort();
}

/**
 * Fails a build that would publish a key. `VITE_` values end up in the public JavaScript, so a
 * district build carries its endpoint and model names there, and the key stays on its proxy.
 * Call it from vite.config.ts with the loaded env.
 */
export function assertNoKeyInEnv(env: Record<string, unknown>): void {
  const found = findSecretsInEnv(env);
  if (found.length === 0) return;
  throw new Error(
    `These build variables look like API keys or tokens: ${found.join(', ')}. ` +
      'Every VITE_ value is published inside the app, so keys must stay on the district AI proxy. ' +
      'Remove them (the values were not printed).',
  );
}
