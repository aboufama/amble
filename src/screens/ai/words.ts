/** The AI cards' small word helpers (pure: no React, no store). */
import { t } from '../../i18n';
import type { LocalSteer } from '../../model/types';

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
