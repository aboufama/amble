/**
 * The moderation endpoint (`POST {base}/moderations`, OpenAI's free omni-moderation or a proxy's),
 * used when the config says `moderation: 'endpoint'`: on the student's words before a request, and
 * on the text a game will show after one. The district's proxy and provider filters stay the
 * authority; this is a second layer. When the endpoint has no `/moderations`, that is remembered
 * and the local filter carries on alone.
 */
import type { AgeBand, ModerationMode } from '../config/types';
import { aiError } from '../errors';
import { aiFetch, Watchdog } from '../transport/fetch';
import { knownUnsupported, rememberUnsupported } from '../transport/learned';
import type { Transport } from '../transport/types';
import { CRISIS_CARD, refusal, toneHint, type SafetyVerdict, type ToneHint } from './policy';
import { checkOutputText, checkStudentText, type FlaggedText, type OutputCategory, type OutputCheck } from './screen';

export const DEFAULT_MODERATION_MODEL = 'omni-moderation-latest';

export interface ModerationResult {
  /** The endpoint gave an answer (false: not offered, unreachable, or not the right transport). */
  checked: boolean;
  /** One per input: the flagged categories (`sexual`, `self-harm/intent`, ...). */
  results: Array<{ flagged: boolean; categories: string[] }>;
}

interface WireModeration {
  results?: Array<{ flagged?: unknown; categories?: Record<string, unknown> }>;
}

/** Asks the endpoint to moderate `inputs`. Never throws for endpoint trouble: the answer is then `checked: false`. */
export async function moderate(t: Transport, inputs: readonly string[], o: { model?: string; signal?: AbortSignal; timeoutMs?: number } = {}): Promise<ModerationResult> {
  const none: ModerationResult = { checked: false, results: [] };
  if (!inputs.length || t.via === 'codex' || t.caps.moderation === false || knownUnsupported(t.baseUrl, 'moderation')) return none;
  const dog = new Watchdog(o.signal, o.timeoutMs ?? 15_000, undefined);
  try {
    const res = await aiFetch(t, '/moderations', { method: 'POST', body: { model: o.model ?? DEFAULT_MODERATION_MODEL, input: inputs.length === 1 ? inputs[0] : [...inputs] }, signal: dog.signal });
    if ([404, 405, 501].includes(res.status)) {
      rememberUnsupported(t.baseUrl, 'moderation');
      return none;
    }
    if (!res.ok) return none;
    const body = (await res.json()) as WireModeration;
    const results = (body.results ?? []).map((r) => ({
      flagged: r.flagged === true,
      categories: Object.entries(r.categories ?? {})
        .filter(([, v]) => v === true)
        .map(([k]) => k),
    }));
    return results.length === inputs.length ? { checked: true, results } : none;
  } catch {
    if (dog.cause === 'user') throw aiError('cancelled', { host: t.host });
    return none;
  } finally {
    dog.dispose();
  }
}

/** What a flagged request means for the student: crisis, a refusal, or go ahead with a tone note. */
export function verdictFromCategories(categories: readonly string[], band: AgeBand): SafetyVerdict | { kind: 'allow'; toneDown: ToneHint[] } {
  const has = (prefix: string) => categories.some((c) => c === prefix || c.startsWith(`${prefix}/`));
  if (has('self-harm')) return { kind: 'crisis', card: CRISIS_CARD };
  if (has('sexual')) return refusal('sexual');
  if (has('hate')) return refusal('hate');
  if (has('harassment')) return refusal('harassment');
  if (has('illicit')) return refusal('flagged');
  const toneDown: ToneHint[] = [];
  if (categories.includes('violence/graphic')) toneDown.push(toneHint('gore', band));
  if (categories.includes('violence') && band === 'elementary') toneDown.push(toneHint('violence', band));
  return { kind: 'allow', toneDown };
}

export interface ScreenOptions {
  band: AgeBand;
  moderation: ModerationMode;
  /** Needed for `moderation: 'endpoint'`; without it only the local filter runs. */
  transport?: Transport | null;
  signal?: AbortSignal;
}

/** The whole screen for a student's request: the local filter, then the endpoint when configured. */
export async function screenRequest(text: string, o: ScreenOptions): Promise<SafetyVerdict> {
  const local = checkStudentText(text, o.band);
  if (local.kind === 'crisis' || local.kind === 'refuse' || o.moderation !== 'endpoint' || !o.transport) return local;
  const m = await moderate(o.transport, [text], { signal: o.signal });
  const r = m.results[0];
  if (!m.checked || !r?.flagged) return local;
  const v = verdictFromCategories(r.categories, o.band);
  if (v.kind !== 'allow') return v;
  const toneDown = [...local.toneDown, ...v.toneDown.filter((h) => !local.toneDown.some((x) => x.topic === h.topic))];
  return { ...local, toneDown };
}

function outputFromCategories(categories: readonly string[]): OutputCategory | null {
  const has = (prefix: string) => categories.some((c) => c === prefix || c.startsWith(`${prefix}/`));
  if (has('self-harm')) return 'self-harm';
  if (has('sexual')) return 'sexual';
  if (has('hate')) return 'hate';
  if (has('harassment')) return 'harassment';
  if (has('illicit')) return 'drugs';
  if (categories.includes('violence/graphic')) return 'gore';
  return null;
}

/**
 * The whole screen for the text a game will show: the local filter, then (when configured and it
 * passed) one batched moderation call. `moderated` says whether the endpoint was actually asked.
 */
export async function screenOutput(texts: ReadonlyArray<string | { text: string }>, o: ScreenOptions): Promise<OutputCheck & { moderated: boolean }> {
  const local = checkOutputText(texts, o.band);
  if (!local.ok || o.moderation !== 'endpoint' || !o.transport || texts.length === 0) return { ...local, moderated: false };
  const strings = texts.map((t) => (typeof t === 'string' ? t : t.text));
  const m = await moderate(o.transport, strings, { signal: o.signal });
  if (!m.checked) return { ...local, moderated: false };
  const flagged: FlaggedText[] = [];
  m.results.forEach((r, index) => {
    const category = r.flagged ? outputFromCategories(r.categories) : null;
    if (category) flagged.push({ index, text: strings[index], category });
  });
  return { ok: flagged.length === 0, flagged, moderated: true };
}
