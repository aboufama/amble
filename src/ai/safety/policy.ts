/**
 * The content policy's words: verdict types, the crisis card, refusal copy with alternatives, and
 * the tone-down notes per age band (map-school §2.6).
 */
import type { AgeBand } from '../config/types';
import type { PiiMatch } from './pii';

export type RefuseCategory =
  | 'sexual'
  | 'hate'
  | 'extremism'
  | 'school-attack'
  | 'real-person'
  | 'harassment'
  | 'drugs'
  | 'personal-info'
  | 'gambling'
  /** Refused by the moderation endpoint or a provider filter, category unknown. */
  | 'flagged';

export type ToneTopic = 'gore' | 'weapons' | 'scary' | 'language' | 'substances' | 'violence';

export interface ToneHint {
  topic: ToneTopic;
  /** One line for the request, telling the model how to keep it right for the age band. */
  note: string;
}

export interface CrisisCard {
  title: string;
  body: string;
  help: string;
  contacts: ReadonlyArray<{ label: string; number: string; call: string; text?: string }>;
  button: string;
}

export type SafetyVerdict =
  /** Go ahead; `toneDown` notes belong in the request. */
  | { kind: 'allow'; toneDown: ToneHint[] }
  /** Personal information: blocked at the elementary level, a warning ("Remove it?") above. */
  | { kind: 'pii'; pii: PiiMatch[]; block: boolean; message: string; toneDown: ToneHint[] }
  | { kind: 'refuse'; category: RefuseCategory; message: string; alternatives: string[] }
  /** Show the crisis card instead of anything else; send nothing. */
  | { kind: 'crisis'; card: CrisisCard };

/** The supportive card for self-harm or distress (map-school §2.6), with New Hampshire's numbers. */
export const CRISIS_CARD: CrisisCard = {
  title: 'It sounds like things might be really hard right now.',
  body: 'You deserve support. Talk to a teacher, counselor or another adult you trust.',
  help: 'In New Hampshire you can call or text 988, or 1-833-710-6477 (NH Rapid Response, 24/7, free).',
  contacts: [
    { label: '988 Suicide & Crisis Lifeline: call or text, 24/7, free', number: '988', call: 'tel:988', text: 'sms:988' },
    { label: 'NH Rapid Response: 24/7, free', number: '1-833-710-6477', call: 'tel:+18337106477' },
  ],
  button: 'Back to my game',
};

const REFUSALS: Record<RefuseCategory, { message: string; alternatives: string[] }> = {
  sexual: { message: "Amble can't make that one. How about one of these?", alternatives: ['A treasure hunt on a secret island', 'A race through a candy city'] },
  hate: { message: "Amble can't make games with hurtful words about people. Try a different idea!", alternatives: ['A team of heroes who help each other', 'A monster that only eats vegetables'] },
  extremism: { message: "Amble can't make that one. How about one of these?", alternatives: ['Defend the castle from a robot army', 'Stop the villain who stole the moon'] },
  'school-attack': { message: "Amble can't make games about hurting people at school. Try a different idea!", alternatives: ['Escape a school taken over by friendly slimes', 'A field day with bouncy obstacles'] },
  'real-person': {
    message: "Games about real people from your school or family aren't allowed, even as a joke. Make up a character instead!",
    alternatives: ['Make up a character with a funny name', 'A villain made of socks'],
  },
  harassment: { message: "Amble can't put words like that in a game. Try something kind or silly instead!", alternatives: ['A boss who tells terrible jokes', 'Cheer the hero on with silly sounds'] },
  drugs: { message: "Amble can't make games about drugs or alcohol. How about one of these?", alternatives: ['Power-up potions that make you giant', 'A juice stand in a busy city'] },
  'personal-info': { message: "Games can't ask players for passwords or personal info. Try a different idea!", alternatives: ['A secret code the player finds in the level', 'A puzzle door with a riddle'] },
  gambling: { message: "Amble can't make games about spending real money. How about this?", alternatives: ['A shop that sells upgrades for coins you collect'] },
  flagged: { message: "Amble can't make that one. Try a different idea!", alternatives: ['Make the enemies pop into confetti', 'Turn it into a water-balloon fight'] },
};

export function refusal(category: RefuseCategory): { kind: 'refuse'; category: RefuseCategory; message: string; alternatives: string[] } {
  return { kind: 'refuse', category, ...REFUSALS[category] };
}

const TONE: Record<ToneTopic, Record<AgeBand, string>> = {
  gore: {
    elementary: 'No blood or gore: enemies bonk, bounce and poof into stars or confetti.',
    middle: 'No blood or gore: cartoon knockback, sparks and poofs.',
    high: 'No gore: hit flashes and sparks instead of blood.',
  },
  weapons: {
    elementary: 'No guns: use water balloons, bubbles, snowballs or magic wands.',
    middle: 'No real-world guns: cartoon blasters, lasers or swords.',
    high: 'Stylized weapons only, never realistic real-world guns.',
  },
  scary: {
    elementary: 'Keep it spooky-cute: no jump scares or horror.',
    middle: 'Mildly spooky at most.',
    high: 'Suspense is fine; no gore.',
  },
  language: {
    elementary: 'No swear words or insults anywhere in the game.',
    middle: 'No swear words or insults anywhere in the game.',
    high: 'No swear words or insults anywhere in the game.',
  },
  substances: {
    elementary: 'No alcohol, drugs, smoking or vaping: use potions, juice or snacks instead.',
    middle: 'No alcohol, drugs, smoking or vaping shown as fun: use potions or power-ups instead.',
    high: 'No alcohol, drugs, smoking or vaping shown as fun.',
  },
  violence: {
    elementary: 'Keep action cartoon-soft: bonks and bounces, nothing hurts for real.',
    middle: 'Cartoon action only, nothing graphic.',
    high: 'Action is fine, nothing graphic.',
  },
};

export function toneHint(topic: ToneTopic, band: AgeBand): ToneHint {
  return { topic, note: TONE[topic][band] };
}

/** The tone notes as one block for the request ("Content notes: ..."), or '' when there are none. */
export function toneDownNote(hints: readonly ToneHint[]): string {
  const notes = [...new Set(hints.map((h) => h.note))];
  return notes.length ? `Content notes for this request: ${notes.join(' ')}` : '';
}

export const PII_MESSAGE = "It looks like you typed personal info. The AI helper doesn't need it. Remove it?";
export const PII_BLOCK_MESSAGE = "The AI helper doesn't need your personal info. Please take it out, then try again.";
