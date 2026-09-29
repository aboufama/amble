/**
 * The AI core as the app sees it (§8.2): transport (`chatJson`, `chatText`), typed errors, district
 * configuration and class links, the game validator, the AMBLE PATCH parser and applier, and the safety
 * floor. Modules import these only from here. The core's names are re-exported as they are; the spec's
 * names that differ are one-line adapters below (`createPatchParser`, `checkText`, `extractManifest`,
 * `parseClassLink`).
 *
 * vite.config.ts imports `assertNoKeyInEnv` from src/ai/config/secrets.ts directly: this barrel (like the
 * core's index) reads `import.meta.env` and browser APIs.
 */
import { checkStudentText, findPii, looksLikeProviderKey, mergeLayers, readClassLink, type AiErrorKind, type ClassLink } from '../ai';
import type { AiMode, AiStatus, Assignment, ClassLinkV1, CodeFile, Level, SafetyVerdict } from '../model/types';
import type { SourceFile } from './aiCode';

/** 'real': the AI core has merged. */
export const AI_CORE: 'stub' | 'real' = 'real';

export {
  AiError,
  aiError,
  isAiError,
  kidMessage,
  chatJson,
  chatText,
  listModels,
  pingModel,
  DEFAULT_RETRIES,
  DEFAULT_STALL_MS,
  DEFAULT_TIMEOUT_MS,
  s,
  checkJson,
  clampJson,
  wireSchema,
  parseJsonReply,
  resolveAiConfig,
  transportFor,
  aiAvailable,
  describeAiSource,
  modelFor,
  mergeLayers,
  pendingClassLink,
  readClassLink,
  validateClassLink,
  encodeClassLink,
  classLinkUrl,
  saveClassLink,
  loadClassLink,
  clearClassLink,
  isClassLinkExpired,
  stripClassLinkFromUrl,
  loadAiSettings,
  saveAiSettings,
  clearAiSettings,
  DEFAULT_AI_SETTINGS,
  OPENAI_BASE_URL,
  assertNoKeyInEnv,
  findSecretsInEnv,
  looksLikeProviderKey,
  looksLikeSecret,
  safetyIdentifier,
  validateGame,
  validateCode,
  instrument,
  peekStaticLiteral,
  literalValue,
  formatIssue,
  formatIssuesForModel,
  codeFrame,
  ENTRY_FILE,
  isSafeGamePath,
  PatchParser,
  parsePatch,
  applyPatch,
  applyEdits,
  opsFromReply,
  checkStudentText,
  checkOutputText,
  screenRequest,
  screenOutput,
  moderate,
  verdictFromCategories,
  findPii,
  scrubPii,
  CRISIS_CARD,
  PII_MESSAGE,
  PII_BLOCK_MESSAGE,
  refusal,
  toneDownNote,
  toneHint,
  devServerInfo,
  fetchCodexStatus,
  startCodexLogin,
  cancelCodexLogin,
} from '../ai';

export type {
  AiErrorInit,
  AiErrorKind,
  AuthKind,
  Capabilities,
  ChatJsonRequest,
  ChatJsonResult,
  ChatMessage,
  ChatRequestBase,
  ChatStatus,
  ChatTextRequest,
  ChatTextResult,
  ContentPart,
  FallbackFeature,
  ReasoningEffort,
  Transport,
  Usage,
  Infer,
  JsonSchema,
  JsonType,
  JsonValue,
  Schema,
  AgeBand,
  AiAuth,
  AiConfig,
  AiSettings,
  AiSource,
  ConfigLayer,
  DistrictInfo,
  LockKey,
  ModerationMode,
  ResolveOptions,
  AiSourceDescription,
  ModelRole,
  ClassLink,
  ClassLinkRead,
  ClassPolicy,
  AppliedFix,
  Issue,
  KitManifest,
  RuleId,
  Severity,
  ValidateOptions,
  ValidationResult,
  VisibleString,
  Edit,
  FileAction,
  FileOp,
  Patch,
  PatchEvent,
  SafetyStatus,
  ApplyFailure,
  ApplyResult,
  CrisisCard,
  RefuseCategory,
  ToneHint,
  ToneTopic,
  PiiMatch,
  PiiKind,
  OutputCheck,
  FlaggedText,
  ScreenOptions,
  ModerationResult,
  DevServerInfo,
} from '../ai';

/** The core's own safety verdict (richer than the app's `SafetyVerdict` of §4.2; see `checkText`). */
export type { SafetyVerdict as CoreSafetyVerdict } from '../ai';

// ------------------------------------------------------------------ spec-named adapters

// The adapters that need the validator, the kit's API or the patch parser live in ./aiCode, so this
// barrel (which loads with the app) never brings them into the first load.
export { createPatchParser, extractManifest, kitManifest, type SourceFile, type StaticManifest } from './aiCode';

/** The local floor filter (offline, instant) as the app's `SafetyVerdict` (§4.2). */
export function checkText(text: string, level: Level): SafetyVerdict {
  const v = checkStudentText(text, level);
  switch (v.kind) {
    case 'allow':
      return { kind: 'allow' };
    case 'pii':
      return { kind: 'pii', spans: v.pii.map((m) => [m.index, m.index + m.text.length] as [number, number]), block: v.block };
    case 'refuse':
      return { kind: 'refuse', category: v.category, message: v.message, alternatives: v.alternatives };
    case 'crisis':
      return { kind: 'crisis' };
  }
}

/** A world's code files for the validator and the applier. */
export function sourceFilesOf(code: readonly CodeFile[]): SourceFile[] {
  return code.map((f) => ({ path: f.path, content: f.source }));
}

// ------------------------------------------------------------------ class links

/** `class=<value>` in a hash: `#class=…`, or after a route (`#/trail?class=…`). */
const CLASS_PARAM = /(?:^#?|[#&?/])class=([^&#]*)/;

/** Whether a location hash carries a class link (even a damaged one: it is read, then stripped). */
export function hasClassLink(hash: string): boolean {
  return CLASS_PARAM.test(hash);
}

/** A class link read: null when the fragment has no `class=`. */
export type ClassLinkParse = { ok: true; link: ClassLinkV1 } | { ok: false; reason: 'expired' | 'unsafe' | 'damaged' };

const AI_MODES: readonly AiMode[] = ['on', 'explain', 'off'];
const LEVELS: readonly Level[] = ['elementary', 'middle', 'high'];

function fromBase64Url(s: string): string {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

function safeBaseUrl(v: string): boolean {
  try {
    const u = new URL(v);
    if (u.username || u.password) return false;
    return u.protocol === 'https:' || (u.protocol === 'http:' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1'));
  } catch {
    return false;
  }
}

/** Has an expiry passed? A bare date means "through the end of that day" (as the core reads it). */
export function isExpiredOn(expires: string | null | undefined, now: Date = new Date()): boolean {
  if (!expires) return false;
  const end = /^\d{4}-\d{2}-\d{2}$/.test(expires) ? Date.parse(`${expires}T23:59:59.999`) : Date.parse(expires);
  return Number.isFinite(end) && now.getTime() > end;
}

function anyKeyLike(v: unknown): boolean {
  if (typeof v === 'string') return looksLikeProviderKey(v);
  if (Array.isArray(v)) return v.some(anyKeyLike);
  if (typeof v === 'object' && v !== null) return Object.values(v).some(anyKeyLike);
  return false;
}

/** The spec's payload (§4.2 `ClassLinkV1`: `{ v: 1, cls, district, ai, mode, level, exp, asg }`). */
function readSpecPayload(v: Record<string, unknown>, now: Date): ClassLinkParse {
  if (anyKeyLike(v)) return { ok: false, reason: 'unsafe' };
  if (typeof v.cls !== 'string') return { ok: false, reason: 'damaged' };
  let ai: ClassLinkV1['ai'] = null;
  if (v.ai !== null && v.ai !== undefined) {
    const a = v.ai as Record<string, unknown>;
    if (typeof a.baseUrl !== 'string' || typeof a.model !== 'string') return { ok: false, reason: 'damaged' };
    if (!safeBaseUrl(a.baseUrl)) return { ok: false, reason: 'unsafe' };
    const auth = a.auth as Record<string, unknown> | undefined;
    ai = {
      baseUrl: a.baseUrl.replace(/\/+$/, ''),
      model: a.model.slice(0, 80),
      ...(typeof a.fastModel === 'string' ? { fastModel: a.fastModel.slice(0, 80) } : {}),
      ...(typeof a.visionModel === 'string' ? { visionModel: a.visionModel.slice(0, 80) } : {}),
      ...(typeof a.caps === 'string' ? { caps: a.caps.slice(0, 120) } : {}),
      auth:
        auth && auth.type === 'class-code' && typeof auth.code === 'string'
          ? { type: 'class-code', header: typeof auth.header === 'string' ? auth.header : 'X-Amble-Class', code: auth.code.slice(0, 80) }
          : { type: 'none' },
    };
  }
  const exp = typeof v.exp === 'string' ? v.exp : null;
  if (isExpiredOn(exp, now)) return { ok: false, reason: 'expired' };
  return {
    ok: true,
    link: {
      v: 1,
      cls: v.cls.slice(0, 40),
      district: typeof v.district === 'string' ? v.district.slice(0, 60) : null,
      ai,
      mode: AI_MODES.includes(v.mode as AiMode) ? (v.mode as AiMode) : 'on',
      level: LEVELS.includes(v.level as Level) ? (v.level as Level) : 'middle',
      exp,
      asg: typeof v.asg === 'object' && v.asg !== null ? (v.asg as Assignment) : null,
    },
  };
}

/** The core's class link as the app's `ClassLinkV1`. */
export function classLinkFromCore(link: ClassLink): ClassLinkV1 {
  const p = link.policy;
  return {
    v: 1,
    cls: (link.name ?? link.district ?? '').slice(0, 40),
    district: link.district ?? null,
    ai: {
      baseUrl: link.baseUrl,
      model: link.model ?? '',
      ...(link.fastModel ? { fastModel: link.fastModel } : {}),
      ...(link.visionModel ? { visionModel: link.visionModel } : {}),
      ...(p?.caps?.length ? { caps: p.caps.join(',') } : {}),
      auth: link.code ? { type: 'class-code', header: link.header ?? 'X-Amble-Class', code: link.code } : { type: 'none' },
    },
    mode: p?.enabled === false ? 'off' : 'on',
    level: p?.ageBand ?? 'middle',
    exp: p?.expires ?? null,
    asg: null,
  };
}

/** The app's class link in the core's format (what `resolveAiConfig` reads back from `saveClassLink`). */
export function classLinkToCore(link: ClassLinkV1): ClassLink | null {
  if (!link.ai) return null;
  const caps = link.ai.caps
    ?.split(',')
    .map((c) => c.trim())
    .filter(Boolean);
  return {
    v: 1,
    baseUrl: link.ai.baseUrl,
    model: link.ai.model || undefined,
    fastModel: link.ai.fastModel,
    visionModel: link.ai.visionModel,
    ...(link.ai.auth.type === 'class-code' ? { code: link.ai.auth.code, header: link.ai.auth.header } : {}),
    name: link.cls,
    district: link.district ?? undefined,
    policy: { enabled: link.mode !== 'off', ageBand: link.level, ...(caps?.length ? { caps } : {}), ...(link.exp ? { expires: link.exp } : {}) },
  };
}

/**
 * `parseClassLink`: reads `class=<base64url(JSON)>` from a location hash, in the spec's `ClassLinkV1`
 * format or the core's format (`readClassLink`). M7 extends the core's reader to the full payload.
 */
export function parseClassLink(fragment: string, now: Date = new Date()): ClassLinkParse | null {
  const m = CLASS_PARAM.exec(fragment);
  if (!m) return null;
  if (m[1].length > 2800 || !/^[A-Za-z0-9_-]+={0,2}$/.test(m[1])) return { ok: false, reason: 'damaged' };
  const value = m[1].replace(/=+$/, '');
  let raw: unknown;
  try {
    raw = JSON.parse(fromBase64Url(value));
  } catch {
    return { ok: false, reason: 'damaged' };
  }
  if (typeof raw !== 'object' || raw === null || (raw as { v?: unknown }).v !== 1) return { ok: false, reason: 'damaged' };
  if ('cls' in raw) return readSpecPayload(raw as Record<string, unknown>, now);
  const core = readClassLink(`#class=${value}`);
  if (!core) return { ok: false, reason: 'damaged' };
  if (!core.ok) return { ok: false, reason: /key|secret|token|https|safe/i.test(core.error) ? 'unsafe' : 'damaged' };
  const link = classLinkFromCore(core.link);
  if (isExpiredOn(link.exp, now)) return { ok: false, reason: 'expired' };
  return { ok: true, link };
}

// ------------------------------------------------------------------ status

/** The AI chip's status after a failed call (null: the helper is still fine, e.g. a timeout). */
export function aiStatusOf(kind: AiErrorKind, auth: 'none' | 'key' | 'class-code' | 'dev' = 'none'): AiStatus | null {
  switch (kind) {
    case 'no-config':
      return 'off';
    case 'offline':
      return 'offline';
    case 'blocked-by-filter':
      return 'blocked';
    case 'quota':
      return 'quota';
    case 'rate-limited':
      return 'busy';
    case 'auth':
      return auth === 'class-code' ? 'expired' : 'rejected';
    default:
      return null;
  }
}

/** The configuration when nothing is set up (every source empty). */
export function aiConfigOff() {
  return mergeLayers([]);
}

/** PII spans for highlighting ("Remove it"). */
export function piiSpans(text: string): Array<[number, number]> {
  return findPii(text).map((m) => [m.index, m.index + m.text.length]);
}
