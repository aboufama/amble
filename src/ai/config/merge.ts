/**
 * Combines the configuration sources into one AiConfig. Precedence, highest first:
 *
 *   ChromeOS managed config > build-time VITE_AMBLE_* > the teacher's class link > manual settings > dev server
 *
 * - The endpoint (address, credential, models, capabilities) comes whole from the highest source
 *   that has one, so a class code is never sent to an endpoint it wasn't made for. A class link may
 *   add its code to a school endpoint with the same origin.
 * - Anything a source locks (`ai`, `content`, `vision`) can't be changed by sources below it.
 * - Turning AI off, and refusing pictures, win at any level: the most careful answer holds.
 * - The content level: schools set a ceiling and a default, a teacher's link sets the class level,
 *   and a student can only go lower.
 * - School mode ignores manual settings and the dev server as endpoints.
 */
import { CODEX_MODEL } from '../wire/codex';
import { originOf } from '../wire/fetch';
import { isExpired } from './classLink';
import { OPENAI_BASE_URL } from './settings';
import { AGE_BANDS, type AgeBand, type AiAuth, type AiConfig, type AiSource, type ConfigLayer, type LockKey, type ModerationMode } from './types';

const ORDER: ReadonlyArray<ConfigLayer['source']> = ['managed', 'build', 'class-link', 'manual', 'dev'];
const rank = (s: ConfigLayer['source']) => ORDER.indexOf(s);
const isSchool = (l: ConfigLayer) => l.source === 'managed' || l.source === 'build' || l.source === 'class-link';

const LABEL: Record<ConfigLayer['source'], string> = {
  managed: "Your school's device settings",
  build: "This school's version of Amble",
  'class-link': 'The class link',
  manual: 'Your settings',
  dev: 'The dev server',
};

function lowest(bands: AgeBand[]): AgeBand | undefined {
  return bands.length ? bands.reduce((a, b) => (AGE_BANDS.indexOf(a) <= AGE_BANDS.indexOf(b) ? a : b)) : undefined;
}

function sameOrigin(a: string | undefined, b: string | undefined): boolean {
  return Boolean(a && b && originOf(a) === originOf(b));
}

function hasEndpoint(l: ConfigLayer): boolean {
  return Boolean(l.baseUrl);
}

function defaultModel(l: ConfigLayer): string {
  if (l.via === 'codex') return CODEX_MODEL;
  return l.baseUrl === OPENAI_BASE_URL || l.via === 'dev-server' ? 'gpt-5' : 'amble-default';
}

export function mergeLayers(input: ReadonlyArray<ConfigLayer | null | undefined>, now = new Date()): AiConfig {
  const all = input.filter((l): l is ConfigLayer => Boolean(l)).sort((a, b) => rank(a.source) - rank(b.source));
  const problems = all.flatMap((l) => (l.problems ?? []).map((p) => `${LABEL[l.source]}: ${p}`));
  const schoolMode = all.some((l) => (l.source === 'managed' || l.source === 'build') && l.schoolMode === true);

  const link = all.find((l) => l.source === 'class-link');
  const expired = Boolean(link && isExpired(link.expires, now));
  const layers = all.filter((l) => !(l.source === 'class-link' && expired));

  // Locks: only school sources lock, and a lock holds for everything below it.
  const lockRank = (key: LockKey) => {
    const r = layers.filter((l) => isSchool(l) && l.lock?.includes(key)).map((l) => rank(l.source));
    return r.length ? Math.min(...r) : Infinity;
  };
  const locked = (['ai', 'content', 'vision'] as LockKey[]).filter((k) => lockRank(k) !== Infinity);
  const upTo = (key: LockKey) => layers.filter((l) => rank(l.source) <= lockRank(key));

  // The endpoint, whole, from the highest source that has one.
  const aiLayers = upTo('ai');
  const endpoint =
    aiLayers.find((l) => hasEndpoint(l) && !((l.source === 'manual' || l.source === 'dev') && schoolMode)) ?? null;
  const activeLink = layers.find((l) => l.source === 'class-link');
  const companion = endpoint && activeLink && activeLink !== endpoint && sameOrigin(activeLink.baseUrl, endpoint.baseUrl) ? activeLink : null;
  const manual = layers.find((l) => l.source === 'manual');

  let auth: AiAuth = endpoint?.auth ?? { type: 'none' };
  let missing: 'needs-class-link' | 'needs-key' | null = null;
  if (endpoint?.classCodeHeader) {
    const codeAuth = companion?.auth?.type === 'class-code' ? companion.auth : null;
    if (codeAuth) auth = { type: 'class-code', header: endpoint.classCodeHeader, code: codeAuth.code };
    else missing = 'needs-class-link';
  } else if (endpoint?.userKey) {
    // Only a key typed for this address (Settings keeps it with the address), never a key meant for another.
    if (!schoolMode && manual?.auth?.type === 'bearer' && sameOrigin(manual.baseUrl, endpoint.baseUrl)) auth = manual.auth;
    else missing = 'needs-key';
  }

  const from = <K extends keyof ConfigLayer>(key: K): ConfigLayer[K] | undefined => endpoint?.[key] ?? companion?.[key];
  const model = from('model') ?? (endpoint ? defaultModel(endpoint) : '');
  const endpointIsSchool = Boolean(endpoint && isSchool(endpoint));
  // Policy fields come from the school sources when the school provides the AI, else from the endpoint's own source.
  const policyLayers = endpointIsSchool ? aiLayers.filter(isSchool) : endpoint ? [endpoint] : [];
  const first = <K extends keyof ConfigLayer>(ls: ConfigLayer[], key: K): ConfigLayer[K] | undefined => ls.find((l) => l[key] !== undefined)?.[key];

  // On or off: any source (above an `ai` lock) can turn it off.
  const offLayer = aiLayers.find((l) => l.enabled === false);

  // Content level.
  const contentLayers = upTo('content');
  const schoolContent = contentLayers.filter(isSchool);
  const ageBandMax = lowest(schoolContent.flatMap((l) => (l.ageBandMax ? [l.ageBandMax] : []))) ?? 'high';
  const specific = ['class-link', 'build', 'managed'].map((s) => schoolContent.find((l) => l.source === s)?.ageBand).find(Boolean);
  const own = contentLayers.find((l) => l.source === 'manual')?.ageBand;
  const chosen = own ? (specific ? lowest([own, specific]) : own) : specific;
  const ageBand = lowest([chosen ?? 'middle', ageBandMax]) as AgeBand;

  const aiBands = aiLayers.filter(isSchool).flatMap((l) => (l.aiBands ? [l.aiBands] : []));
  const bandAllowed = aiBands.every((bs) => bs.includes(ageBand));

  // Pictures: a school decides for its endpoint (every school source that says anything must allow it).
  const visionLayers = upTo('vision').filter(isSchool).filter((l) => l.visionAllowed !== undefined);
  const visionAllowed = endpointIsSchool ? visionLayers.length > 0 && visionLayers.every((l) => l.visionAllowed) : Boolean(endpoint?.visionAllowed);

  const moderationDefault: ModerationMode = endpoint?.baseUrl === OPENAI_BASE_URL ? 'endpoint' : 'local-only';
  const district = first(layers.filter((l) => l.source === 'managed' || l.source === 'build'), 'district') ?? activeLink?.district ?? null;

  let offReason: AiConfig['offReason'] = null;
  let offBy: AiSource | null = null;
  if (!endpoint) offReason = expired ? 'expired' : 'not-configured';
  else if (missing) offReason = missing === 'needs-class-link' && expired ? 'expired' : missing;
  else if (offLayer) {
    offReason = 'turned-off';
    offBy = offLayer.source;
  } else if (!bandAllowed) offReason = 'grade-band';

  return {
    source: endpoint ? endpoint.source : 'none',
    enabled: offReason === null,
    offReason,
    offBy,
    baseUrl: endpoint?.baseUrl ?? '',
    via: endpoint?.via ?? 'endpoint',
    auth: missing ? { type: 'none' } : auth,
    model,
    fastModel: from('fastModel') ?? model,
    visionModel: from('visionModel') ?? model,
    visionAllowed,
    caps: { ...(companion?.caps ?? {}), ...(endpoint?.caps ?? {}) },
    moderation: first(policyLayers, 'moderation') ?? (endpoint?.via === 'codex' ? 'local-only' : moderationDefault),
    ageBand,
    ageBandMax,
    safetyIdentifier: first(policyLayers, 'safetyIdentifier') ?? false,
    district: district ?? null,
    classLabel: link?.label ?? null,
    expires: link?.expires ?? null,
    expired,
    locked,
    schoolMode,
    sharedDevice: layers.some((l) => isSchool(l) && l.sharedDevice === true),
    requestsMayBeReviewed: layers.some((l) => isSchool(l) && l.requestsMayBeReviewed === true),
    manualAllowed: !schoolMode && !locked.includes('ai') && !endpointIsSchool,
    userKeyFor: endpoint?.userKey && !schoolMode ? (endpoint.baseUrl ?? null) : null,
    problems,
  };
}
