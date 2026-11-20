/**
 * Questions for the player while their game is made from an idea. The idea leaves things open (the
 * world it happens in, what the hero looks like, the colours), and the model used to make them up:
 * a disco nobody asked for. Instead, one quick request asks the player about them, right away, while
 * the game is written; their picks reach the art, which waits a few seconds for them (the code takes
 * longer than that anyway, so the build is no longer for it).
 */
import { chatJson, type AiSettings, type Transport } from './openai';

export interface Question {
  ask: string;
  choices: string[];
}

/** A question and what the player picked (null: they let Amble choose). */
export interface Pick {
  ask: string;
  answer: string | null;
}

const ASK_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['questions'],
  properties: {
    questions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['ask', 'choices'],
        properties: { ask: { type: 'string' }, choices: { type: 'array', items: { type: 'string' } } },
      },
    },
  },
} as const;

export const ASK_SYSTEM = `You help a child make a video game from their idea. The game is being written right now; while they wait, you ask them a few quick questions about what their idea leaves open, so the game looks the way they want instead of the way someone guessed.

Ask about how it looks: the place or world it happens in, what the hero or the main characters look like, the colours or the mood. Only what the idea doesn't already say. Never ask about the rules, the controls or how to play: that is already being written.

- 2 questions, about the two things that change the look most; 1 when the idea already says most of it; none when it says everything.
- Each question at most 7 words, in words a 7-year-old can read, naming the thing from their idea ("What does your dragon look like?").
- 3 choices each: 1 to 4 words, things you can picture, clearly different from each other, every one of them fun. No "other" and no "you choose": the page adds that.

Reply with JSON: { "questions": [{ "ask", "choices" }] }.`;

/** The questions for an idea (none when it can't ask: the build goes on without them). */
export async function askAboutIdea(idea: string, t: Transport, settings: AiSettings, signal?: AbortSignal): Promise<Question[]> {
  const reply = await chatJson<{ questions?: Question[] }>(t, {
    model: settings.model,
    system: ASK_SYSTEM,
    user: `Their idea: "${idea.trim().slice(0, 600)}"`,
    schema: ASK_SCHEMA as unknown as Record<string, unknown>,
    schemaName: 'amble_ask',
    reasoningEffort: 'low',
    kind: 'code',
    signal,
  });
  return cleanQuestions(reply.questions);
}

export function cleanQuestions(raw: unknown): Question[] {
  if (!Array.isArray(raw)) return [];
  const out: Question[] = [];
  for (const q of raw) {
    const ask = String((q as Question)?.ask ?? '').trim().slice(0, 80);
    const choices = (Array.isArray((q as Question)?.choices) ? (q as Question).choices : [])
      .map((c) => String(c ?? '').trim().slice(0, 32))
      .filter(Boolean)
      .slice(0, 3);
    if (ask && choices.length >= 2) out.push({ ask, choices });
    if (out.length === 2) break;
  }
  return out;
}

/** For the code writer, while the player is asked about the look. */
export const ASKING_GUIDE = `## The look is the player's
While you write, the player is answering a few questions about how their game looks (the world it happens in, what the characters look like, the colours), and the art follows their picks. So keep to what their idea says: add no theme, setting or story it doesn't ask for (no surprise disco, pirates or space), and describe the cast and backdrops plainly, as what they are in the idea, so the picks can dress them.`;

/** The picks, in words for the artist (and for anyone reading the build). "" when nothing was picked. */
export function picksText(picks: Pick[]): string {
  return picks
    .filter((p) => p.answer)
    .map((p) => `${p.ask.replace(/\?*$/, '?')} ${p.answer}.`)
    .join(' ');
}
