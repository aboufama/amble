/**
 * The Chat Completions request body, and the automatic fallbacks: when an endpoint answers 400
 * because it doesn't know a feature, the feature is dropped (or downgraded) and the request sent
 * again. One feature per rejection, so every retry stays explainable.
 */
import { wireSchema, type JsonSchema } from '../json/schema';
import type { Failure } from './failures';
import type { Capabilities, ChatMessage, ChatRequestBase, ContentPart, FallbackFeature } from './types';

export type ReplyFormat = 'json_schema' | 'json_object' | 'prompt' | 'text';

export interface WireOptions {
  stream: boolean;
  /** `stream_options: { include_usage: true }`, for token counts at the end of a stream. */
  streamUsage: boolean;
  format: ReplyFormat;
  effort: boolean;
  tokensField: 'max_completion_tokens' | 'max_tokens' | null;
  store: boolean;
  safetyId: boolean;
  images: boolean;
}

export interface JsonSpec {
  schema: JsonSchema;
  name: string;
}

export function isReasoningModel(model: string): boolean {
  return /^(o\d|gpt-[5-9])/i.test(model.trim());
}

export function hasImages(content: string | ContentPart[]): boolean {
  return Array.isArray(content) && content.some((p) => p.type === 'image_url');
}

export function initialOptions(caps: Capabilities, req: ChatRequestBase, json: JsonSpec | null, opts: { noVision: boolean; safetyId: boolean }): WireOptions {
  const stream = caps.stream !== false;
  const effort = Boolean(req.reasoningEffort) && caps.reasoning !== false && (caps.reasoning === true || isReasoningModel(req.model));
  return {
    stream,
    streamUsage: stream,
    format: json ? (caps.jsonSchema === false ? 'json_object' : 'json_schema') : 'text',
    effort,
    tokensField: req.maxTokens ? 'max_completion_tokens' : null,
    store: true,
    safetyId: opts.safetyId,
    images: hasImages(req.user) && caps.images !== false && !opts.noVision,
  };
}

const SCHEMA_NOTE = 'Reply with a single JSON object and nothing else. It must follow this JSON schema:';

/** Text-only content: image parts are left out and the text parts joined. */
export function textOnly(content: string | ContentPart[]): string {
  if (typeof content === 'string') return content;
  return content
    .flatMap((p) => (p.type === 'text' ? [p.text] : []))
    .join('\n\n');
}

function content(c: string | ContentPart[], images: boolean): string | ContentPart[] {
  if (typeof c === 'string') return c;
  return images ? c : textOnly(c);
}

export function buildBody(req: ChatRequestBase, o: WireOptions, json: JsonSpec | null, safetyId: string | null): Record<string, unknown> {
  const system = json && (o.format === 'json_object' || o.format === 'prompt') ? `${req.system}\n\n${SCHEMA_NOTE}\n${JSON.stringify(wireSchema(json.schema))}` : req.system;
  const messages: ChatMessage[] = [
    { role: 'system', content: system },
    { role: 'user', content: content(req.user, o.images) },
    ...(req.messages ?? []).map((m) => ({ role: m.role, content: content(m.content, o.images) })),
  ];
  const body: Record<string, unknown> = { model: req.model, messages, stream: o.stream };
  if (o.stream && o.streamUsage) body.stream_options = { include_usage: true };
  if (json && o.format === 'json_schema') body.response_format = { type: 'json_schema', json_schema: { name: json.name, strict: true, schema: wireSchema(json.schema) } };
  if (json && o.format === 'json_object') body.response_format = { type: 'json_object' };
  if (o.effort && req.reasoningEffort) body.reasoning_effort = req.reasoningEffort;
  if (o.tokensField && req.maxTokens) body[o.tokensField] = req.maxTokens;
  if (o.store) body.store = false;
  if (o.safetyId && safetyId) body.safety_identifier = safetyId;
  return body;
}

/** Does this rejection name `word` as a parameter (in `param` or the message; "streaming" counts for "stream")? */
function names(f: Extract<Failure, { kind: 'http' }>, word: string): boolean {
  if (f.param === word || f.param?.startsWith(`${word}.`)) return true;
  return new RegExp(`(^|[^a-z_])${word}(ing|ed|s)?([^a-z_]|$)`, 'i').test(f.message);
}

const IMAGE_TROUBLE = /image|vision|multimodal|content.{0,40}(string|str\b|array|list|type)|(string|array).{0,40}content/i;

/**
 * Drops or downgrades the one feature a 400/422 rejection points at. Returns what was dropped, or
 * null when the rejection isn't about an optional feature (then it is a real error).
 */
export function downgrade(o: WireOptions, f: Failure, req: ChatRequestBase): FallbackFeature | null {
  if (f.kind !== 'http' || (f.status !== 400 && f.status !== 422) || f.html) return null;
  if (o.images && hasImages(req.user) && IMAGE_TROUBLE.test(`${f.param ?? ''} ${f.message}`)) {
    o.images = false;
    return 'images';
  }
  if (o.stream && o.streamUsage && names(f, 'stream_options')) {
    o.streamUsage = false;
    return 'stream_options';
  }
  if (o.stream && names(f, 'stream')) {
    o.stream = false;
    o.streamUsage = false;
    return 'stream';
  }
  if (o.tokensField === 'max_completion_tokens' && names(f, 'max_completion_tokens')) {
    o.tokensField = 'max_tokens';
    return 'max_completion_tokens';
  }
  if (o.tokensField === 'max_tokens' && names(f, 'max_tokens')) {
    o.tokensField = null;
    return 'max_tokens';
  }
  if (o.effort && /reasoning/i.test(`${f.param ?? ''} ${f.message}`)) {
    o.effort = false;
    return 'reasoning_effort';
  }
  if (o.store && names(f, 'store')) {
    o.store = false;
    return 'store';
  }
  if (o.safetyId && names(f, 'safety_identifier')) {
    o.safetyId = false;
    return 'safety_identifier';
  }
  if ((o.format === 'json_schema' || o.format === 'json_object') && /response_format|json_schema|json_object|schema|structured output/i.test(`${f.param ?? ''} ${f.message}`)) {
    const from = o.format;
    o.format = o.format === 'json_schema' ? 'json_object' : 'prompt';
    return from;
  }
  return null;
}
