import type { AuthKind } from '../errors';
import type { Schema } from '../json/schema';

export type ReasoningEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';

export type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string; detail?: 'low' | 'high' | 'auto' } };

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | ContentPart[];
}

/**
 * What an endpoint supports. `undefined` means unknown: the feature is tried and dropped
 * automatically if the endpoint rejects it. `false` means never send it.
 */
export interface Capabilities {
  /** Strict `response_format: json_schema` (Structured Outputs). */
  jsonSchema?: boolean;
  /** Server-sent events for `stream: true`. */
  stream?: boolean;
  /** `reasoning_effort`. `undefined` sends it only to models whose names look like reasoning models. */
  reasoning?: boolean;
  /** Image parts in user messages. */
  images?: boolean;
  /** `POST {base}/moderations`. */
  moderation?: boolean;
}

/** Where AI requests go and how. Built from the resolved config by `transportFor`. */
export interface Transport {
  /** OpenAI-compatible base URL without a trailing slash (`https://amble-ai.sau99.org/v1`), or a dev-server path. */
  baseUrl: string;
  /** Sent with every request to `baseUrl` and nowhere else: `Authorization`, or the class-code header. */
  headers: Readonly<Record<string, string>>;
  /** `endpoint`: any OpenAI-compatible URL. `dev-server`: the dev server's key proxy. `codex`: the dev-only ChatGPT bridge. */
  via: 'endpoint' | 'dev-server' | 'codex';
  /** Which credential is in `headers`; picks the words for auth errors. */
  auth: AuthKind;
  caps: Capabilities;
  /** Shown in errors ("Amble couldn't reach amble-ai.sau99.org"). */
  host: string;
  /** Returns the hashed safety identifier to send, or null. Absent when the config doesn't enable it. */
  safetyIdentifier?: () => Promise<string | null>;
  /** For tests and harnesses; defaults to the global `fetch`. */
  fetch?: typeof fetch;
  /** Defaults to `navigator.onLine`. */
  isOnline?: () => boolean;
}

/** Token counts, summed over every request a call made (retries after a rejection have none). */
export interface Usage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  reasoningTokens: number;
  cachedTokens: number;
  /** How many requests reported usage. */
  requests: number;
}

/** Request features the transport drops automatically when an endpoint rejects them. */
export type FallbackFeature =
  | 'stream'
  | 'stream_options'
  | 'json_schema'
  | 'json_object'
  | 'reasoning_effort'
  | 'max_completion_tokens'
  | 'max_tokens'
  | 'store'
  | 'safety_identifier'
  | 'images';

/** Progress for the UI. `writing` fires on every streamed piece; throttle it in the view if needed. */
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
  /** Further turns after the user message, e.g. an earlier reply and a follow-up. */
  messages?: ChatMessage[];
  /** Sent as `max_completion_tokens` (or `max_tokens` where that is all the endpoint knows). */
  maxTokens?: number;
  reasoningEffort?: ReasoningEffort;
  signal?: AbortSignal;
  /** Total time for the call, retries included. Default 10 minutes. */
  timeoutMs?: number;
  /** Optional limit on waiting for the reply to start. Off by default: slow district models may queue. */
  firstByteMs?: number;
  /** Longest silence allowed once the reply is being written. Default 90 s. */
  stallMs?: number;
  /** Retries for 429, 5xx and network errors. Default 3. */
  retries?: number;
  onStatus?(status: ChatStatus): void;
}

export interface ChatTextRequest extends ChatRequestBase {
  /** Called for every streamed piece with the text so far. */
  onDelta?(delta: string, text: string): void;
  /** Called once with the final result (also when it was cut short). */
  onDone?(result: ChatTextResult): void;
}

export interface ChatTextResult {
  text: string;
  /** `stop`, `length`, `interrupted` (the stream stopped early), or whatever else the endpoint said. */
  finishReason: string | null;
  /** The reply was cut short (token limit, a stall, a dropped connection); `text` holds what arrived. */
  truncated: boolean;
  usage: Usage | null;
  /** The endpoint couldn't take pictures, so they were left out. */
  imagesDropped: boolean;
}

export interface ChatJsonRequest<T> extends ChatRequestBase {
  /** The reply's shape. Sent as a strict `json_schema` (local-only limits stripped) and checked on arrival. */
  schema: Schema<T>;
  /** A stable name, e.g. `amble_plan`; providers cache schemas by it. */
  schemaName: string;
  /** Rounds that send the problems back when the reply isn't valid JSON of the right shape. Default 1. */
  repairs?: number;
  /** Trim over-long strings and arrays and clamp numbers instead of failing on them. Default true. */
  clamp?: boolean;
  /** The raw JSON text as it streams (e.g. to show which file is being written). */
  onDelta?(delta: string, text: string): void;
}

export interface ChatJsonResult<T> {
  value: T;
  usage: Usage | null;
  /** How the JSON was asked for in the end. */
  format: 'json_schema' | 'json_object' | 'prompt';
  imagesDropped: boolean;
  /** A repair round was needed to get a valid reply. */
  repaired: boolean;
}
