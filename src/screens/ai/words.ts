/** The AI cards' small word helpers (pure: no React, no store). */
import type { AiConfig } from '../../cores/ai';
import { t } from '../../i18n';
import type { LocalSteer } from '../../model/types';

/**
 * Who set up the service a student's words go to, from the facts the privacy page uses (the configuration's
 * source, and a key a grown-up typed): the school or district (a managed configuration or its own build), a
 * teacher's class link, or a grown-up at home (Settings).
 */
export type WordsGoTo = 'school' | 'class' | 'home';

export function wordsGoTo(ai: Pick<AiConfig, 'source' | 'auth'> | null): WordsGoTo {
  if (!ai) return 'school';
  // A key is only ever typed into Settings, by a grown-up (never from a school source).
  if (ai.auth.type === 'bearer' || ai.source === 'manual' || ai.source === 'dev') return 'home';
  return ai.source === 'class-link' ? 'class' : 'school';
}

/**
 * The lines of the card before the first request (§2.16), in plain words: what happens, where the words go
 * (named after the district when the configuration names one), and that a step can always be undone.
 */
export function explainerLines(ai: Pick<AiConfig, 'source' | 'auth' | 'district'> | null, linkDistrict: string | null): [string, string, string] {
  const to = wordsGoTo(ai);
  const district = ai?.district?.name || linkDistrict || t('ai.districtFallback');
  const words = to === 'home' ? t('ai.explainerWordsHome') : to === 'class' ? t('ai.explainerWordsClass') : t('ai.explainerWords', { district });
  return [t('ai.explainerCode'), words, to === 'home' ? t('ai.explainerMistakesHome') : t('ai.explainerMistakes')];
}

/** The steer toast's words (§5.10): "Turned Jump power up to 900. No AI needed." */
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

/** "Your change added a Pizza slice. Draw it now?", with the article the name needs. */
export function addedMemberText(name: string): string {
  if (/^the\s/i.test(name)) return t('ai.addedMemberNamed', { name });
  return /^[aeiou]/i.test(name) ? t('ai.addedMemberAn', { name }) : t('ai.addedMember', { name });
}
