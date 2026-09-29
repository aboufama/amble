import type { Capabilities } from '../transport/types';

/** Content level, by grade band (map-school §2.6): what is refused or toned down. */
export type AgeBand = 'elementary' | 'middle' | 'high';
export const AGE_BANDS: readonly AgeBand[] = ['elementary', 'middle', 'high'];

/** Where the AI endpoint came from, highest precedence first. */
export type AiSource = 'managed' | 'build' | 'class-link' | 'manual' | 'dev' | 'none';

/** `endpoint`: Amble calls `/moderations` too. `provider`: the endpoint filters by itself. `local-only`: Amble's own filter only. */
export type ModerationMode = 'endpoint' | 'provider' | 'local-only';

/** Settings a school can lock so lower sources (class links, manual settings) can't change them. */
export type LockKey = 'ai' | 'content' | 'vision';

export type AiAuth =
  | { type: 'none' }
  /** A provider key typed into Settings: manual settings only, never from a school source. */
  | { type: 'bearer'; key: string }
  /** A class code for the district proxy, sent in a header (default `X-Amble-Class`). */
  | { type: 'class-code'; header: string; code: string };

export interface DistrictInfo {
  name: string;
  privacyUrl: string;
  contact: string;
}

/** Manual settings, stored on this device. Only used when no school source provides the AI. */
export interface AiSettings {
  apiKey: string;
  baseUrl: string;
  model: string;
  fastModel: string;
  visionModel: string;
  visionAllowed: boolean;
  /** The student's own content level; can only lower what a school or teacher set. `null` = not chosen. */
  ageBand: AgeBand | null;
  /** Send a hashed, daily-rotated device id as `safety_identifier`. */
  safetyIdentifier: boolean;
  /** The helper is on for this device (a student can turn it off). */
  enabled: boolean;
  /** Keep the key after the browser closes. Off: it lives in session storage only. */
  rememberKey: boolean;
  /** Dev server only: use "Sign in with ChatGPT" through the local Codex CLI. */
  useChatGpt: boolean;
}

export const DEFAULT_AI_SETTINGS: AiSettings = {
  apiKey: '',
  baseUrl: '',
  model: '',
  fastModel: '',
  visionModel: '',
  visionAllowed: false,
  ageBand: null,
  safetyIdentifier: false,
  enabled: true,
  rememberKey: true,
  useChatGpt: false,
};

/** One source's contribution, before merging. Every field is optional: a source may set only a few. */
export interface ConfigLayer {
  source: Exclude<AiSource, 'none'>;
  enabled?: boolean;
  baseUrl?: string;
  via?: 'endpoint' | 'dev-server' | 'codex';
  auth?: AiAuth;
  /** A build says students authenticate with a class code in this header; the class link supplies the code. */
  classCodeHeader?: string;
  /** A build that lets students type their own key for its endpoint. */
  userKey?: boolean;
  model?: string;
  fastModel?: string;
  visionModel?: string;
  visionAllowed?: boolean;
  caps?: Capabilities;
  moderation?: ModerationMode;
  ageBand?: AgeBand;
  ageBandMax?: AgeBand;
  /** AI is on only for these bands. */
  aiBands?: AgeBand[];
  safetyIdentifier?: boolean;
  district?: DistrictInfo;
  label?: string;
  expires?: string;
  lock?: LockKey[];
  requestsMayBeReviewed?: boolean;
  schoolMode?: boolean;
  sharedDevice?: boolean;
  /** What was wrong with this source (ignored fields), for Settings to show. */
  problems?: string[];
}

/** The configuration the app runs with: one resolved answer for "is there AI, where, and how". */
export interface AiConfig {
  /** Where the endpoint came from; `none` when there is none. */
  source: AiSource;
  /** AI can be used right now. */
  enabled: boolean;
  /**
   * Why AI is off, when it is: nothing set up; a source turned it off; the class link expired; not
   * for this grade band; the school endpoint needs a class code (join with a class link); the build
   * expects students to enter their own key.
   */
  offReason: 'not-configured' | 'turned-off' | 'expired' | 'grade-band' | 'needs-class-link' | 'needs-key' | null;
  /** Which source turned it off. */
  offBy: AiSource | null;
  baseUrl: string;
  via: 'endpoint' | 'dev-server' | 'codex';
  auth: AiAuth;
  model: string;
  fastModel: string;
  visionModel: string;
  /** Pictures (at most an outline of a drawing) may be sent to the AI. */
  visionAllowed: boolean;
  caps: Capabilities;
  moderation: ModerationMode;
  ageBand: AgeBand;
  ageBandMax: AgeBand;
  safetyIdentifier: boolean;
  district: DistrictInfo | null;
  classLabel: string | null;
  expires: string | null;
  /** A class link was stored but has expired. */
  expired: boolean;
  locked: LockKey[];
  schoolMode: boolean;
  sharedDevice: boolean;
  requestsMayBeReviewed: boolean;
  /** Settings may offer the manual endpoint fields. */
  manualAllowed: boolean;
  problems: string[];
}
