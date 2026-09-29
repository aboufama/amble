/**
 * Amble's AI plumbing and safety: framework-free, one import for UI modules.
 *
 * - Transport: `chatJson` (strict JSON of a known shape) and `chatText` (streamed text, e.g. an
 *   AMBLE PATCH), to one OpenAI-compatible endpoint, with retries, timeouts, fallbacks and typed errors.
 * - Config: `resolveAiConfig` (managed > build > class link > manual), `transportFor`, `describeAiSource`.
 * - Validate: `validateGame` for model-written code, `instrument` before it runs.
 * - Patch: `PatchParser`/`parsePatch` and `applyPatch` for AMBLE PATCH replies.
 * - Safety: `checkStudentText`/`screenRequest` before a request, `checkOutputText`/`screenOutput` after.
 *
 * vite.config.ts must import `assertNoKeyInEnv` from './src/ai/config/secrets.ts' directly: this
 * barrel reads `import.meta.env` and browser APIs.
 */

// Errors
export { AiError, aiError, isAiError, kidMessage, type AiErrorInit, type AiErrorKind, type AuthKind, type KidMessageContext } from './errors';

// JSON replies
export { parseJsonReply, type JsonParseResult } from './json/parse';
export { checkJson, clampJson, s, strictSchemaProblems, wireSchema, type Infer, type JsonSchema, type JsonType, type JsonValue, type Schema } from './json/schema';

// Transport (src/ai/transport.ts; the wire details are in src/ai/wire/)
export { chatJson, chatText, DEFAULT_RETRIES, DEFAULT_STALL_MS, DEFAULT_TIMEOUT_MS, listModels, pingModel } from './transport';
export { isReasoningModel } from './wire/body';
export { forgetLearnedCaps } from './wire/learned';
export {
  cancelCodexLogin,
  CODEX_MODEL,
  CODEX_MODEL_NAME,
  devServerInfo,
  fetchCodexStatus,
  startCodexLogin,
  type DevServerInfo,
} from './wire/codex';
export type {
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
} from './transport';
export type { CodexStatus } from './codexTypes';

// Configuration
export {
  aiAvailable,
  describeAiSource,
  modelFor,
  pendingClassLink,
  resolveAiConfig,
  transportFor,
  type AiSourceDescription,
  type ModelRole,
  type ResolveOptions,
  type TransportOptions,
} from './config/resolve';
export { mergeLayers } from './config/merge';
export { layerFromEnv } from './config/env';
export { layerFromManaged, onManagedConfigChange, readManagedConfig } from './config/managed';
export {
  classLinkUrl,
  clearClassLink,
  encodeClassLink,
  isClassLinkExpired,
  layerFromClassLink,
  loadClassLink,
  readClassLink,
  saveClassLink,
  stripClassLinkFromUrl,
  validateClassLink,
  type ClassLink,
  type ClassLinkRead,
  type ClassPolicy,
} from './config/classLink';
export { clearAiSettings, layerFromSettings, loadAiSettings, OPENAI_BASE_URL, saveAiSettings, type SettingsStores } from './config/settings';
export { assertNoKeyInEnv, findSecretsInEnv, looksLikeProviderKey, looksLikeSecret } from './config/secrets';
export { deviceId, safetyIdentifier } from './config/safetyId';
export {
  AGE_BANDS,
  DEFAULT_AI_SETTINGS,
  type AgeBand,
  type AiAuth,
  type AiConfig,
  type AiSettings,
  type AiSource,
  type ConfigLayer,
  type DistrictInfo,
  type LockKey,
  type ModerationMode,
} from './config/types';

// Game files, validation and instrumentation
export { byteLength, ENTRY_FILE, isSafeGamePath, type GameFile } from './gameFiles';
export { validateCode, validateGame } from './validate/validate';
export { instrument, type InstrumentOptions } from './validate/instrument';
export { literalValue, peekStaticLiteral } from './validate/statics';
export { codeFrame, formatIssue, formatIssuesForModel } from './validate/format';
export type { AppliedFix, Issue, KitManifest, RuleId, Severity, ValidateOptions, ValidationResult, VisibleString } from './validate/types';

// AMBLE PATCH
export { parsePatch, PatchParser } from './patch/parse';
export { applyPatch, opsFromReply, type ApplyFailure, type ApplyResult } from './patch/apply';
export { applyEdits, type EditFailure, type EditsResult } from './patch/edits';
export type { Edit, FileAction, FileOp, Patch, PatchEvent, SafetyStatus } from './patch/types';

// Safety and moderation
export { checkOutputText, checkStudentText, type FlaggedText, type OutputCategory, type OutputCheck } from './safety/screen';
export { DEFAULT_MODERATION_MODEL, moderate, screenOutput, screenRequest, verdictFromCategories, type ModerationResult, type ScreenOptions } from './safety/moderation';
export { findPii, scrubPii, type PiiKind, type PiiMatch } from './safety/pii';
export {
  CRISIS_CARD,
  PII_BLOCK_MESSAGE,
  PII_MESSAGE,
  refusal,
  toneDownNote,
  toneHint,
  type CrisisCard,
  type RefuseCategory,
  type SafetyVerdict,
  type ToneHint,
  type ToneTopic,
} from './safety/policy';
