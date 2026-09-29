/**
 * The local floor filter: always on, offline, under a millisecond. It screens the student's words
 * before any request, and the text a game will show after a reply. Code is never screened (games
 * are full of `kill()` and `shoot()`); only strings the player will read.
 */
import type { AgeBand } from '../config/types';
import { findListed, type LexiconCategory } from './lexicon';
import { views } from './normalize';
import { HATE_GROUP, namedTarget, REAL_PERSON, SCHOOL_ATTACK } from './patterns';
import { findPii } from './pii';
import { CRISIS_CARD, PII_BLOCK_MESSAGE, PII_MESSAGE, refusal, toneHint, type RefuseCategory, type SafetyVerdict, type ToneHint, type ToneTopic } from './policy';

function matchesAny(vs: readonly string[], patterns: readonly RegExp[]): boolean {
  return vs.some((v) => patterns.some((re) => re.test(v)));
}

/** Which refusal applies to this text, if any, in order of seriousness. */
function refusalCategory(text: string, vs: readonly string[]): RefuseCategory | null {
  if (matchesAny(vs, SCHOOL_ATTACK)) return 'school-attack';
  if (findListed(vs, 'hate') || matchesAny(vs, HATE_GROUP)) return 'hate';
  if (findListed(vs, 'extremism')) return 'extremism';
  if (findListed(vs, 'sexual')) return 'sexual';
  if (findListed(vs, 'harassment')) return 'harassment';
  if (matchesAny(vs, REAL_PERSON) || namedTarget(text)) return 'real-person';
  if (findListed(vs, 'drug-use')) return 'drugs';
  if (findListed(vs, 'personal-info')) return 'personal-info';
  if (findListed(vs, 'gambling')) return 'gambling';
  return null;
}

const TONE_LISTS: Array<[LexiconCategory, ToneTopic]> = [
  ['gore', 'gore'],
  ['weapons', 'weapons'],
  ['scary', 'scary'],
  ['profanity', 'language'],
  ['substances', 'substances'],
];

function toneHints(vs: readonly string[], band: AgeBand): ToneHint[] {
  const out: ToneHint[] = [];
  for (const [category, topic] of TONE_LISTS) {
    if (topic === 'scary' && band === 'high') continue;
    if (findListed(vs, category)) out.push(toneHint(topic, band));
  }
  return out;
}

/**
 * Screens what a student typed before it goes anywhere. Crisis first (the request is not sent and
 * the crisis card shows), then refusals, then personal information, then tone notes.
 */
export function checkStudentText(text: string, band: AgeBand): SafetyVerdict {
  const vs = views(text);
  if (findListed(vs, 'crisis')) return { kind: 'crisis', card: CRISIS_CARD };
  const category = refusalCategory(text, vs);
  if (category) return refusal(category);
  const toneDown = toneHints(vs, band);
  const pii = findPii(text);
  if (pii.length) {
    const block = band === 'elementary';
    return { kind: 'pii', pii, block, message: block ? PII_BLOCK_MESSAGE : PII_MESSAGE, toneDown };
  }
  return { kind: 'allow', toneDown };
}

export type OutputCategory = RefuseCategory | 'self-harm' | 'profanity' | 'insult' | 'gore' | 'scary' | 'personal-info';

export interface FlaggedText {
  /** Index into the checked list. */
  index: number;
  text: string;
  category: OutputCategory;
}

export interface OutputCheck {
  ok: boolean;
  flagged: FlaggedText[];
}

/** Why a string the game will show isn't OK for this band, or null. */
function outputCategory(text: string, band: AgeBand): OutputCategory | null {
  const vs = views(text);
  if (findListed(vs, 'crisis') || findListed(vs, 'harassment')) return 'self-harm';
  const refused = refusalCategory(text, vs);
  if (refused && refused !== 'real-person' && refused !== 'personal-info') return refused;
  if (findListed(vs, 'profanity')) return 'profanity';
  if (findPii(text).some((p) => p.kind === 'email' || p.kind === 'phone' || p.kind === 'address')) return 'personal-info';
  if (band === 'elementary') {
    if (findListed(vs, 'insults')) return 'insult';
    if (findListed(vs, 'gore')) return 'gore';
    if (findListed(vs, 'scary')) return 'scary';
  }
  return null;
}

/**
 * Screens the text an AI-written game will show (titles, dialogue, names, asks). A flagged reply
 * should be dropped or regenerated: no output text is shown before it clears.
 */
export function checkOutputText(texts: ReadonlyArray<string | { text: string }>, band: AgeBand): OutputCheck {
  const flagged: FlaggedText[] = [];
  texts.forEach((t, index) => {
    const text = typeof t === 'string' ? t : t.text;
    const category = outputCategory(text, band);
    if (category) flagged.push({ index, text, category });
  });
  return { ok: flagged.length === 0, flagged };
}
