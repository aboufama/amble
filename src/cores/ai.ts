/**
 * The AI core as the app sees it (§8.2): transport (`chatJson`, `chatText`), typed errors, district
 * configuration and class links, the game validator and manifest reader, the AMBLE PATCH parser and
 * applier, and the local safety floor.
 *
 * FOUNDATION-STUB: the AI core (`src/ai`) has not merged yet. The transport and config types mirror the
 * core's working copy; the validator, patch and moderation types are the contract M5 codes against (the
 * barrel adapts the core to them when it merges). Until then the transport rejects with `no-config`, the
 * config resolves to "off", the safety floor allows everything, and the parser and applier throw.
 */
import { NotBuiltYet } from '../model/notBuilt';
import type { AiMode, Assignment, ClassLinkV1, Level, PlanReply, SafetyVerdict } from '../model/types';
import type { GameFile } from './play';

/** 'stub' until the AI core merges. */
export const AI_CORE: 'stub' | 'real' = 'stub';

// ------------------------------------------------------------------ configuration

export type AgeBand = 'elementary' | 'middle' | 'high';
export type AiSource = 'managed' | 'build' | 'class-link' | 'manual' | 'dev' | 'none';
export type ModerationMode = 'endpoint' | 'provider' | 'local-only';
export type LockKey = 'ai' | 'content' | 'vision';

export type AiAuth =
  | { type: 'none' }
  | { type: 'bearer'; key: string }
  | { type: 'class-code'; header: string; code: string };

export interface DistrictInfo {
  name: string;
  privacyUrl: string;
  contact: string;
}

/** What an endpoint supports; `undefined` = unknown (tried, and dropped if rejected). */
export interface Capabilities {
  jsonSchema?: boolean;
  stream?: boolean;
  reasoning?: boolean;
  images?: boolean;
  moderation?: boolean;
}

/** The configuration the app runs with: one resolved answer for "is there AI, where, and how". */
export interface AiConfig {
  source: AiSource;
  enabled: boolean;
  offReason: 'not-configured' | 'turned-off' | 'expired' | 'grade-band' | 'needs-class-link' | 'needs-key' | null;
  offBy: AiSource | null;
  baseUrl: string;
  via: 'endpoint' | 'dev-server' | 'codex';
  auth: AiAuth;
  model: string;
  fastModel: string;
  visionModel: string;
  visionAllowed: boolean;
  caps: Capabilities;
  moderation: ModerationMode;
  ageBand: AgeBand;
  ageBandMax: AgeBand;
  safetyIdentifier: boolean;
  district: DistrictInfo | null;
  classLabel: string | null;
  expires: string | null;
  expired: boolean;
  locked: LockKey[];
  schoolMode: boolean;
  sharedDevice: boolean;
  requestsMayBeReviewed: boolean;
  manualAllowed: boolean;
  problems: string[];
}

/** The configuration when nothing is set up. */
export const AI_OFF: AiConfig = {
  source: 'none',
  enabled: false,
  offReason: 'not-configured',
  offBy: null,
  baseUrl: '',
  via: 'endpoint',
  auth: { type: 'none' },
  model: '',
  fastModel: '',
  visionModel: '',
  visionAllowed: false,
  caps: {},
  moderation: 'local-only',
  ageBand: 'middle',
  ageBandMax: 'high',
  safetyIdentifier: false,
  district: null,
  classLabel: null,
  expires: null,
  expired: false,
  locked: [],
  schoolMode: false,
  sharedDevice: false,
  requestsMayBeReviewed: false,
  manualAllowed: true,
  problems: [],
};

export interface ResolveOptions {
  env?: Record<string, unknown>;
  managed?: Record<string, unknown> | null;
  dev?: boolean;
  now?: Date;
}

/** District config precedence: managed config > VITE_AMBLE_* > the class link > manual settings. */
export function resolveAiConfig(_o: ResolveOptions = {}): Promise<AiConfig> {
  return Promise.resolve(AI_OFF);
}

/** A class link fragment read: null when the fragment has no `class=`. */
export type ClassLinkParse = { ok: true; link: ClassLinkV1 } | { ok: false; reason: 'expired' | 'unsafe' | 'damaged' };

const PROVIDER_KEY = /\b(sk-[A-Za-z0-9_-]{8,}|AIza[0-9A-Za-z_-]{20,}|eyJ[A-Za-z0-9_-]{10,}\.)/;
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

/**
 * Reads `class=<base64url(JSON)>` from a location hash (§4.2 `ClassLinkV1`, ≤ 2 KB). FOUNDATION-STUB: a
 * basic reader until the AI core's class link reader is extended to the full payload (M7).
 */
export function parseClassLink(fragment: string, now: Date = new Date()): ClassLinkParse | null {
  const m = /(?:^#?|[&?])class=([A-Za-z0-9_-]+)/.exec(fragment);
  if (!m) return null;
  if (m[1].length > 2800) return { ok: false, reason: 'damaged' };
  let raw: unknown;
  try {
    raw = JSON.parse(fromBase64Url(m[1]));
  } catch {
    return { ok: false, reason: 'damaged' };
  }
  if (typeof raw !== 'object' || raw === null) return { ok: false, reason: 'damaged' };
  if (PROVIDER_KEY.test(JSON.stringify(raw))) return { ok: false, reason: 'unsafe' };
  const v = raw as Record<string, unknown>;
  if (v.v !== 1 || typeof v.cls !== 'string') return { ok: false, reason: 'damaged' };
  let ai: ClassLinkV1['ai'] = null;
  if (v.ai !== null && v.ai !== undefined) {
    const a = v.ai as Record<string, unknown>;
    if (typeof a.baseUrl !== 'string' || typeof a.model !== 'string') return { ok: false, reason: 'damaged' };
    if (!safeBaseUrl(a.baseUrl)) return { ok: false, reason: 'unsafe' };
    const auth = a.auth as Record<string, unknown> | undefined;
    const authOut: NonNullable<ClassLinkV1['ai']>['auth'] =
      auth && auth.type === 'class-code' && typeof auth.code === 'string'
        ? { type: 'class-code', header: typeof auth.header === 'string' ? auth.header : 'X-Amble-Class', code: auth.code.slice(0, 80) }
        : { type: 'none' };
    ai = {
      baseUrl: a.baseUrl.replace(/\/+$/, ''),
      model: a.model.slice(0, 80),
      ...(typeof a.fastModel === 'string' ? { fastModel: a.fastModel.slice(0, 80) } : {}),
      ...(typeof a.visionModel === 'string' ? { visionModel: a.visionModel.slice(0, 80) } : {}),
      ...(typeof a.caps === 'string' ? { caps: a.caps.slice(0, 120) } : {}),
      auth: authOut,
    };
  }
  const exp = typeof v.exp === 'string' ? v.exp : null;
  if (exp && !Number.isNaN(Date.parse(exp)) && Date.parse(exp) < now.getTime()) return { ok: false, reason: 'expired' };
  const link: ClassLinkV1 = {
    v: 1,
    cls: v.cls.slice(0, 40),
    district: typeof v.district === 'string' ? v.district.slice(0, 60) : null,
    ai,
    mode: AI_MODES.includes(v.mode as AiMode) ? (v.mode as AiMode) : 'on',
    level: LEVELS.includes(v.level as Level) ? (v.level as Level) : 'middle',
    exp,
    asg: typeof v.asg === 'object' && v.asg !== null ? (v.asg as Assignment) : null,
  };
  return { ok: true, link };
}

/** Fails a build whose `VITE_*` variables look like keys (every VITE_ value is published in the app). */
export function assertNoKeyInEnv(env: Record<string, unknown>): void {
  const found = Object.entries(env)
    .filter(([name, value]) => name.startsWith('VITE_') && typeof value === 'string' && (/(KEY|TOKEN|SECRET|PASSWORD)/.test(name) || PROVIDER_KEY.test(value)))
    .map(([name]) => name);
  if (found.length) throw new Error(`These build variables look like API keys or tokens: ${found.join(', ')}. Keys must stay on the district AI proxy.`);
}

// ------------------------------------------------------------------ transport

export type ReasoningEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';

export type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string; detail?: 'low' | 'high' | 'auto' } };

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | ContentPart[];
}

export type AuthKind = 'none' | 'key' | 'class-code' | 'dev';

/** Where AI requests go and how. Built from the resolved config by `transportFor`. */
export interface Transport {
  baseUrl: string;
  headers: Readonly<Record<string, string>>;
  via: 'endpoint' | 'dev-server' | 'codex';
  auth: AuthKind;
  caps: Capabilities;
  host: string;
  safetyIdentifier?: () => Promise<string | null>;
  fetch?: typeof fetch;
  isOnline?: () => boolean;
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  reasoningTokens: number;
  cachedTokens: number;
  requests: number;
}

export type FallbackFeature = 'stream' | 'stream_options' | 'json_schema' | 'json_object' | 'reasoning_effort' | 'max_completion_tokens' | 'max_tokens' | 'store' | 'safety_identifier' | 'images';

export type ChatStatus =
  | { phase: 'waiting' }
  | { phase: 'writing'; chars: number }
  | { phase: 'thinking' | 'working' }
  | { phase: 'retrying'; attempt: number; delayMs: number; reason: 'rate-limited' | 'server' | 'network' }
  | { phase: 'fallback'; dropped: FallbackFeature }
  | { phase: 'repairing'; problems: string[] };

export interface ChatRequestBase {
  model: string;
  system: string;
  user: string | ContentPart[];
  messages?: ChatMessage[];
  maxTokens?: number;
  reasoningEffort?: ReasoningEffort;
  signal?: AbortSignal;
  /** Total time for the call, retries included. */
  timeoutMs?: number;
  /** Off by default: slow district models may queue. */
  firstByteMs?: number;
  /** Longest silence once the reply is being written. */
  stallMs?: number;
  retries?: number;
  onStatus?(status: ChatStatus): void;
}

export interface ChatTextRequest extends ChatRequestBase {
  onDelta?(delta: string, text: string): void;
  onDone?(result: ChatTextResult): void;
}

export interface ChatTextResult {
  text: string;
  finishReason: string | null;
  truncated: boolean;
  usage: Usage | null;
  imagesDropped: boolean;
}

export type JsonType = 'object' | 'array' | 'string' | 'number' | 'integer' | 'boolean' | 'null';
export type JsonPrimitive = string | number | boolean | null;

export interface JsonSchema {
  type?: JsonType | JsonType[];
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  additionalProperties?: boolean;
  items?: JsonSchema;
  enum?: JsonPrimitive[];
  const?: JsonPrimitive;
  anyOf?: JsonSchema[];
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  minimum?: number;
  maximum?: number;
  minItems?: number;
  maxItems?: number;
}

declare const schemaType: unique symbol;

/** A JSON Schema that carries the TypeScript type of the values it accepts. */
export interface Schema<T> {
  readonly json: JsonSchema;
  readonly [schemaType]?: T;
}

export interface ChatJsonRequest<T> extends ChatRequestBase {
  schema: Schema<T>;
  /** A stable name, e.g. `amble_plan`. */
  schemaName: string;
  repairs?: number;
  clamp?: boolean;
  onDelta?(delta: string, text: string): void;
}

export interface ChatJsonResult<T> {
  value: T;
  usage: Usage | null;
  format: 'json_schema' | 'json_object' | 'prompt';
  imagesDropped: boolean;
  repaired: boolean;
}

export type AiErrorKind =
  | 'no-config'
  | 'auth'
  | 'quota'
  | 'rate-limited'
  | 'blocked-by-filter'
  | 'offline'
  | 'timeout'
  | 'too-long'
  | 'refused'
  | 'bad-reply'
  | 'setup'
  | 'server'
  | 'cancelled';

export interface AiErrorInit {
  detail?: string;
  status?: number;
  code?: string;
  host?: string;
  retryAfterMs?: number;
}

/** Every transport failure; `kind` is what the UI switches on, `message` is readable by a student. */
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

/** The transport for a config, or null when AI is off. */
export function transportFor(config: AiConfig): Transport | null {
  if (!config.enabled || !config.baseUrl) return null;
  let host = config.baseUrl;
  try {
    host = new URL(config.baseUrl, 'http://localhost').host;
  } catch {
    // keep the raw text
  }
  const headers: Record<string, string> = {};
  if (config.auth.type === 'bearer') headers.Authorization = `Bearer ${config.auth.key}`;
  if (config.auth.type === 'class-code') headers[config.auth.header] = config.auth.code;
  return { baseUrl: config.baseUrl, headers, via: config.via, auth: config.auth.type === 'bearer' ? 'key' : config.auth.type === 'class-code' ? 'class-code' : 'none', caps: config.caps, host };
}

const NOT_SET_UP = "The AI helper isn't turned on here. You can still draw, tune your game and change its code.";

/** Streams a text reply (AMBLE PATCH). */
export function chatText(_t: Transport, _req: ChatTextRequest): Promise<ChatTextResult> {
  return Promise.reject(new AiError('no-config', NOT_SET_UP));
}

/** A strict-schema JSON call with fallbacks and shape checks. */
export function chatJson<T>(_t: Transport, _req: ChatJsonRequest<T>): Promise<ChatJsonResult<T>> {
  return Promise.reject(new AiError('no-config', NOT_SET_UP));
}

// ------------------------------------------------------------------ the game validator

export type ProblemLevel = 'error' | 'warning' | 'info';

export interface GameProblem {
  /** 'syntax', 'unknown-api', 'art-manifest'... */
  rule: string;
  level: ProblemLevel;
  /** Kid-readable ("`this.spawnPlayer()` doesn't exist. Did you mean `this.spawnHero()`?"). */
  message: string;
  file: string;
  /** 1-based. */
  line: number;
  column: number;
  endLine?: number;
  endColumn?: number;
  /** Set when an automatic fix exists (the code view's **Fix**). */
  fix?: { label: string };
}

/** What `static config`, `static art` and `static dials` say, read without running the game. */
export interface StaticManifest {
  title: string;
  subtitle: string;
  physics: 'arcade' | 'matter' | 'none';
  /** Keys in declaration order; values as written (unknown fields dropped). */
  art: Array<{ key: string; spec: Record<string, string | number | boolean> }>;
  dials: Array<{ key: string; spec: Record<string, string | number | boolean> }>;
  sounds: string[];
}

export interface ValidateOptions {
  /** Plan keys that must stay declared (`plan-keys`). */
  plan?: PlanReply | null;
  /** 'ai': apply auto-fixes; 'student': report only (the code view). */
  mode?: 'ai' | 'student';
}

export interface ValidateResult {
  /** No errors left. Warnings never block. */
  ok: boolean;
  /** The files after auto-fixes (unchanged in 'student' mode). */
  files: GameFile[];
  problems: GameProblem[];
  /** Rules whose auto-fix was applied. */
  fixed: string[];
  manifest: StaticManifest | null;
}

/** The validator (rules, auto-fixes, forbidden APIs). FOUNDATION-STUB: reports nothing. */
export function validateGame(files: GameFile[], _o: ValidateOptions = {}): ValidateResult {
  return { ok: true, files, problems: [], fixed: [], manifest: null };
}

/** The static manifest reader. FOUNDATION-STUB: null (the running game's manifest is the source). */
export function extractManifest(_files: GameFile[]): StaticManifest | null {
  return null;
}

// ------------------------------------------------------------------ AMBLE PATCH

export type PatchAction = 'create' | 'replace' | 'edit' | 'delete';

export type PatchSafety = { kind: 'ok' } | { kind: 'toned-down'; note: string } | { kind: 'refused'; note: string } | { kind: 'crisis' };

export interface PatchEdit {
  find: string;
  replace: string;
}

export interface PatchFileOp {
  path: string;
  action: PatchAction;
  /** create / replace. */
  body?: string;
  /** edit. */
  edits?: PatchEdit[];
}

export interface ParsedPatch {
  summary: string;
  play: string;
  next: string[];
  safety: PatchSafety;
  files: PatchFileOp[];
  /** `@@end` arrived. */
  complete: boolean;
  /** The file the reply stopped inside, when it was cut short. */
  truncatedIn: string | null;
  warnings: string[];
}

/** Events for the UI while a reply streams ("Writing boss.js +34 lines"). */
export type PatchEvent =
  | { type: 'header'; name: 'summary' | 'play' | 'next' | 'safety'; value: string }
  | { type: 'file'; path: string; action: PatchAction }
  | { type: 'lines'; path: string; n: number }
  | { type: 'artManifest'; keys: string[] }
  | { type: 'warning'; message: string }
  | { type: 'end' };

export interface PatchParser {
  /** Feeds streamed text; returns the events it produced. */
  feed(chunk: string): PatchEvent[];
  /** The reply ended: returns what was parsed (complete blocks only when truncated). */
  end(): ParsedPatch;
}

export function createPatchParser(): PatchParser {
  throw new NotBuiltYet('createPatchParser (AI core)');
}

export interface PatchApplyResult {
  files: GameFile[];
  applied: string[];
  /** Edits whose find text did not match (one resend each). */
  mismatches: Array<{ path: string; find: string }>;
  refused: string[];
}

/** The tolerant applier: a candidate file set, never written to the world until it passes. */
export function applyPatch(_files: GameFile[], _patch: ParsedPatch): PatchApplyResult {
  throw new NotBuiltYet('applyPatch (AI core)');
}

// ------------------------------------------------------------------ safety

/** The local floor filter (offline, instant). FOUNDATION-STUB: allows everything. */
export function checkText(_text: string, _level: Level): SafetyVerdict {
  return { kind: 'allow' };
}

/** Optional `/moderations` on the district endpoint. FOUNDATION-STUB: allows everything. */
export function moderate(_text: string, _o: { transport: Transport; level: Level; signal?: AbortSignal }): Promise<SafetyVerdict> {
  return Promise.resolve({ kind: 'allow' });
}
