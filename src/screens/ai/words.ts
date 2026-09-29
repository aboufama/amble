/** The wish box's small word helpers (pure: no React, no store). */
import { t } from '../../i18n';
import type { AiOutcome, AiStatus, LocalSteer } from '../../model/types';

/**
 * Words a student never reads outside "How wishes work" (MAGIC-BRIEF.md): the machinery's names, and a
 * helper that speaks for itself ("I made…", "we added…"). The world changes; nobody is behind it. Game
 * words stay allowed ("collect tokens", "a robot army", "the level generates platforms").
 */
const MACHINE = /\b(?:AI|LLM|GPT|ChatGPT|OpenAI|chat ?bots?|language models?|robot tester)\b|\bA\.I\./i;
/** The helper's own voice: "I" (and I'm, I've...) in upper case, and the pronouns a narrator uses. */
const HELPER_I = /\bI\b/;
const HELPER_VOICE = /\b(?:me|my|myself|we|us|our|ours)\b/i;

/** Is this AI-written text fit for a student's eyes as it is? */
export function kidSafeWords(text: string): boolean {
  return !MACHINE.test(text) && !HELPER_I.test(text) && !HELPER_VOICE.test(text);
}

/** The text when it is fit for students, else '' (callers fall back to Amble's own words). */
export function forStudents(text: string | null | undefined): string {
  const s = (text ?? '').trim();
  return s && kidSafeWords(s) ? s : '';
}

/** The sentences of a note that are fit for students ("I can't make that. Want a snowball fight?" keeps the second). */
export function kindSentences(note: string | null | undefined): string {
  const s = (note ?? '').trim();
  if (!s) return '';
  const parts = s.match(/[^.!?]+[.!?]*\s*/g) ?? [s];
  return parts
    .map((p) => p.trim())
    .filter((p) => p && kidSafeWords(p))
    .join(' ');
}

/**
 * An outcome as the student meets it: the summary, the next ideas and the notes the AI wrote pass
 * `forStudents` (the footstep, the toast, the chips and the "New version ready" card all read these);
 * Amble's own words (failures, the ladder, resting lines) are already plain.
 */
export function forStudentsOutcome(outcome: AiOutcome): AiOutcome {
  switch (outcome.kind) {
    case 'accepted': {
      const note = forStudents(outcome.safety.note);
      return {
        ...outcome,
        summary: forStudents(outcome.summary),
        play: forStudents(outcome.play),
        next: outcome.next.map((n) => forStudents(n)).filter(Boolean),
        safety: outcome.safety.kind === 'ok' || !note ? { kind: 'ok', note: '' } : { ...outcome.safety, note },
      };
    }
    case 'refused':
      return { ...outcome, note: kindSentences(outcome.note), alternatives: outcome.alternatives.map((a) => forStudents(a)).filter(Boolean) };
    default:
      return outcome;
  }
}

/** A sentence as a toast ends it: a capital first letter and a full stop. */
function asSentence(text: string): string {
  const s = text.trim();
  if (!s) return s;
  const capital = s[0].toUpperCase() + s.slice(1);
  return /[.!?…]$/.test(capital) ? capital : `${capital}.`;
}

/** "Done! The Moon King throws fireballs now." (or "Done! Your world changed."). */
export function doneText(summary: string): string {
  const s = forStudents(summary);
  return s ? t('ai.done', { summary: asSentence(s) }) : t('ai.donePlain');
}

/** The toned-down note: a whole sentence as it is ("Amble made the coconuts bounce…"), a fragment with "A little gentler:". */
export function gentlerText(note: string): string {
  const s = note.trim();
  return /^[A-Z]/.test(s) ? asSentence(s) : t('ai.gentler', { note: s });
}

/** The one quiet line where the wish box was, when wishes can't happen now; null when they can. */
export function restingLine(status: AiStatus): string | null {
  switch (status) {
    case 'ready':
      return null;
    case 'offline':
      return t('ai.offline');
    case 'blocked':
      return t('ai.blocked');
    case 'quota':
      return t('ai.quota');
    case 'expired':
      return t('ai.expired');
    case 'rejected':
      return t('ai.rejected');
    case 'busy':
      return t('ai.busy');
    case 'explain-only':
      return t('ai.askExplainLabel');
    default:
      return t('ai.offTitle');
  }
}

/**
 * The wait line while a wish waits its turn (no ticking counter): "Yours is next in about 20 seconds",
 * rounded to 5 s, and "in a few seconds" near the end.
 */
export function waitText(seconds: number, reason: 'rate-limited' | 'server' | 'network'): string {
  const network = reason === 'network';
  if (seconds <= 5) return t(network ? 'ai.waitNetworkSoon' : 'ai.waitSoon');
  const s = Math.ceil(seconds / 5) * 5;
  return t(network ? 'ai.waitNetwork' : 'ai.waitBusy', { s });
}

/** The words for a dial or twist the device matched (§5.10): "Turned Jump power up to 900." */
export function steerText(steer: LocalSteer): string {
  if (steer.kind === 'twist') return t(steer.on ? 'ai.steerOn' : 'ai.steerOff', { name: steer.name });
  const value = Number.isInteger(steer.to) ? String(steer.to) : String(Math.round(steer.to * 100) / 100);
  if (steer.to > steer.from) return t('ai.steerUp', { label: steer.label, value });
  if (steer.to < steer.from) return t('ai.steerDown', { label: steer.label, value });
  return t('ai.steerSet', { label: steer.label, value });
}

/** The text without the flagged spans (and the spaces they leave behind): **Remove it**. */
export function withoutSpans(text: string, spans: ReadonlyArray<readonly [number, number]>): string {
  let out = '';
  let at = 0;
  for (const [a, b] of [...spans].sort((x, y) => x[0] - y[0])) {
    if (b <= at) continue;
    out += text.slice(at, Math.max(at, a));
    at = Math.max(at, b);
  }
  out += text.slice(at);
  return out
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+([,.!?])/g, '$1')
    .replace(/^[\s,]+|[\s,]+$/g, '');
}

/** A cast member's name as a sentence uses it: "the Moon King" for names of more than one word. */
export function nameInSentence(name: string): string {
  const n = name.trim();
  if (!n) return n;
  if (/^the\s/i.test(n)) return `the ${n.slice(4)}`;
  return /\s/.test(n) ? `the ${n}` : n;
}

/** "Your wish added a Pizza slice. Draw it now?", with the article the name needs. */
export function addedMemberText(name: string): string {
  if (/^the\s/i.test(name)) return t('ai.addedMemberNamed', { name });
  return /^[aeiou]/i.test(name) ? t('ai.addedMemberAn', { name }) : t('ai.addedMember', { name });
}
