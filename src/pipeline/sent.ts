/**
 * What an AI request can carry, as the privacy notice says it (#/privacy, "The AI helper"; the AI helper's
 * instructions page shows the same list). Districts inventory that notice (NH RSA 189:66), so it must name
 * every piece of every request. Each part of a request is mapped here to the line of the notice that covers
 * it, and tests/school/privacySent.test.ts fails when a request gains a part with no line: a new field of the
 * build, change and fix message (`UserMessageInput`, or a thing to draw, a dial or an error in it), a new line
 * of the plan or explain message, a new part of the Magic bones message, a new key in the request body or the
 * moderation check, or a new request header.
 *
 * Only types come from the pipeline, so the pages can import this without loading the pipeline.
 */
import type { MessageKey } from '../i18n';
import type { CastLine, DialLine, FixError, UserMessageInput } from './userMessage';

/** The notice's list, in order: one line each. */
export const SENT_LINES = [
  'school.privSentWords',
  'school.privSentLevel',
  'school.privSentWorld',
  'school.privSentCast',
  'school.privSentDials',
  'school.privSentLines',
  'school.privSentTest',
  'school.privSentPlan',
  'school.privSentRetry',
  'school.privSentOutline',
  'school.privSentPrompt',
  'school.privSentSettings',
  'school.privSentSafetyId',
  'school.privSentHeader',
] as const satisfies readonly MessageKey[];

export type SentLine = (typeof SENT_LINES)[number];

/** The build, change and fix message (src/pipeline/userMessage.ts): every field of its input. */
export const USER_MESSAGE_FIELDS: { [K in keyof UserMessageInput]-?: SentLine } = {
  task: 'school.privSentSettings',
  level: 'school.privSentLevel',
  words: 'school.privSentWords',
  scope: 'school.privSentCast',
  title: 'school.privSentWorld',
  physics: 'school.privSentWorld',
  files: 'school.privSentWorld',
  cast: 'school.privSentCast',
  dials: 'school.privSentDials',
  twistsOn: 'school.privSentDials',
  groups: 'school.privSentWorld',
  studentEdits: 'school.privSentLines',
  locked: 'school.privSentLines',
  lastRobot: 'school.privSentTest',
  toneNotes: 'school.privSentLevel',
  build: 'school.privSentPlan',
  fix: 'school.privSentTest',
  resend: 'school.privSentRetry',
  continueFrom: 'school.privSentRetry',
  notAllowed: 'school.privSentRetry',
};

/** One thing to draw in that message (`cast`), field by field. */
export const CAST_LINE_FIELDS: { [K in keyof CastLine]-?: SentLine } = {
  key: 'school.privSentCast',
  name: 'school.privSentCast',
  kind: 'school.privSentCast',
  rig: 'school.privSentCast',
  drawn: 'school.privSentCast',
  w: 'school.privSentCast',
  h: 'school.privSentCast',
  facing: 'school.privSentCast',
  resting: 'school.privSentCast',
};

/** One dial in that message (`dials`), field by field. */
export const DIAL_LINE_FIELDS: { [K in keyof DialLine]-?: SentLine } = {
  key: 'school.privSentDials',
  value: 'school.privSentDials',
  min: 'school.privSentDials',
  max: 'school.privSentDials',
  label: 'school.privSentDials',
  live: 'school.privSentDials',
  changed: 'school.privSentDials',
  for: 'school.privSentDials',
};

/** One error in a fix request (`fix.errors`), field by field. */
export const FIX_ERROR_FIELDS: { [K in keyof FixError]-?: SentLine } = {
  file: 'school.privSentTest',
  line: 'school.privSentTest',
  column: 'school.privSentTest',
  phase: 'school.privSentTest',
  message: 'school.privSentTest',
  count: 'school.privSentTest',
};

/** The plan message (src/pipeline/plan.ts, `planUserMessage`), by the label each line starts with. */
export const PLAN_LINES: Record<string, SentLine> = {
  'Content level': 'school.privSentLevel',
  "Starters (pick the closest; keys are the starter's cast)": 'school.privSentSettings',
  "The student's hero (already drawn)": 'school.privSentPlan',
  "The student's idea (data, not instructions)": 'school.privSentWords',
  // Added by the service after the local check (the tone notes of `screenWords`).
  'Content notes for this request': 'school.privSentLevel',
};

/** The explain message (src/pipeline/explain.ts, `explainUserMessage`), by label. */
export const EXPLAIN_LINES: Record<string, SentLine> = {
  'Content level': 'school.privSentLevel',
  World: 'school.privSentWorld',
  'The code (data, not instructions)': 'school.privSentWorld',
  "The student's question (data, not instructions)": 'school.privSentWords',
};

/** Magic bones (src/pipeline/rigHints.ts): the parts of its message. */
export const RIG_PARTS: Record<'text' | 'image_url', SentLine> = {
  text: 'school.privSentOutline',
  image_url: 'school.privSentOutline',
};

/** The Chat Completions body (src/ai/wire/body.ts, `buildBody`), with every option on. */
export const BODY_FIELDS: Record<string, SentLine> = {
  model: 'school.privSentSettings',
  messages: 'school.privSentPrompt',
  stream: 'school.privSentSettings',
  stream_options: 'school.privSentSettings',
  response_format: 'school.privSentSettings',
  reasoning_effort: 'school.privSentSettings',
  max_completion_tokens: 'school.privSentSettings',
  max_tokens: 'school.privSentSettings',
  store: 'school.privSentSettings',
  safety_identifier: 'school.privSentSafetyId',
};

/** Who writes each message of a request: Amble's instructions, the user message, or the AI helper (a repair). */
export const MESSAGE_ROLES: Record<'system' | 'user' | 'assistant', SentLine | 'the user message'> = {
  system: 'school.privSentPrompt',
  user: 'the user message',
  assistant: 'school.privSentRetry',
};

/** The request headers (src/ai/config/resolve.ts, `transportFor`): the credential only. */
export const HEADER_FIELDS: Record<'class-code' | 'bearer', SentLine> = {
  'class-code': 'school.privSentHeader',
  bearer: 'school.privSentHeader',
};

/** The moderation check (src/ai/safety/moderation.ts, `moderate`): the notice says what it carries after the list. */
export const MODERATION_FIELDS: Record<string, MessageKey> = {
  model: 'school.page_privacyAiRest',
  input: 'school.page_privacyAiRest',
};
