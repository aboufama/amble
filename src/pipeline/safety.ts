/**
 * Kid safety around every AI call (§5.13): the floor filter and moderation on the student's words before
 * anything is sent, the refusal card's alternatives chosen locally by category, and the output check on
 * the words a game will show. Crisis words send nothing and show the crisis card.
 */
import { screenOutput, screenRequest, toneDownNote, type ModerationMode, type Transport } from '../cores/ai';
import { t, type MessageKey } from '../i18n';
import type { Level } from '../model/types';

export type WordsVerdict =
  | { kind: 'allow'; toneNotes: string }
  | { kind: 'pii'; block: boolean; toneNotes: string }
  | { kind: 'refuse'; category: string; note: string; alternatives: string[] }
  | { kind: 'crisis' };

/** Two kind alternatives per refusal category (§5.13), chosen on the device. */
const ALTERNATIVES: Record<string, [MessageKey, MessageKey]> = {
  'real-person': ['ai.altFunnyName', 'ai.altSockVillain'],
  'school-attack': ['ai.altSlimeSchool', 'ai.altFieldDay'],
  sexual: ['ai.altTreasureIsland', 'ai.altCandyRace'],
  hate: ['ai.altHeroTeam', 'ai.altVeggieMonster'],
  extremism: ['ai.altRobotArmy', 'ai.altStolenMoon'],
  harassment: ['ai.altJokeBoss', 'ai.altSillyCheers'],
  drugs: ['ai.altGiantPotion', 'ai.altJuiceStand'],
  'personal-info': ['ai.altSecretCode', 'ai.altRiddleDoor'],
  gambling: ['ai.altCoinShop', 'ai.altConfetti'],
  violence: ['ai.altConfetti', 'ai.altWaterBalloons'],
  scary: ['ai.altSpookyCute', 'ai.altConfetti'],
};

export function alternativesFor(category: string, level: Level = 'middle'): string[] {
  const keys = category === 'scary' && level !== 'elementary' ? ALTERNATIVES.violence : (ALTERNATIVES[category] ?? ALTERNATIVES.violence);
  return keys.map((k) => t(k));
}

/** The refusal card's note: real-person refusals add the sentence about real people (§2.8). */
export function refusalNote(category: string, modelNote = ''): string {
  if (category === 'real-person') return t('ai.refusedRealPeople');
  return modelNote.trim();
}

export interface ScreenDeps {
  moderation: ModerationMode;
  transport: Transport | null;
  signal?: AbortSignal;
}

/** The student's words before any request: crisis, refuse, personal info, or go ahead (with tone notes). */
export async function screenWords(text: string, level: Level, deps: ScreenDeps): Promise<WordsVerdict> {
  const v = await screenRequest(text, { band: level, moderation: deps.moderation, transport: deps.transport, signal: deps.signal });
  switch (v.kind) {
    case 'crisis':
      return { kind: 'crisis' };
    case 'refuse':
      return { kind: 'refuse', category: v.category, note: refusalNote(v.category), alternatives: alternativesFor(v.category, level) };
    case 'pii':
      return { kind: 'pii', block: v.block, toneNotes: toneDownNote(v.toneDown) };
    case 'allow':
      return { kind: 'allow', toneNotes: toneDownNote(v.toneDown) };
  }
}

/** The words a game will show (titles, names, asks, dialogue): the floor filter, then moderation. */
export async function screenGameText(texts: readonly string[], level: Level, deps: ScreenDeps): Promise<{ ok: boolean; flagged: string[] }> {
  const unique = [...new Set(texts.map((s) => s.trim()).filter(Boolean))];
  if (!unique.length) return { ok: true, flagged: [] };
  const r = await screenOutput(unique, { band: level, moderation: deps.moderation, transport: deps.transport, signal: deps.signal });
  return { ok: r.ok, flagged: r.flagged.map((f) => f.text) };
}
