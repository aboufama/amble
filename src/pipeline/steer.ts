/**
 * Local steering (§5.10): before any model call, an Ask that only moves a dial or flips a twist is done on
 * the device, instantly and offline. "make the jump floatier" turns Jump power up by a step; "flip gravity"
 * switches Gravity flips on. Anything the sentence says beyond that one dial or twist ("...and add lava")
 * goes to the AI, so the matcher never swallows a real request.
 */
import type { DialInfo, GameManifest, TwistInfo } from '../cores/play';
import type { LocalSteer, World } from '../model/types';

// ------------------------------------------------------------------ words

const STOP = new Set([
  'a', 'an', 'the', 'it', 'its', 'my', 'me', 'i', 'we', 'you', 'your', 'our', 'please', 'pls', 'can', 'could', 'would', 'will', 'should', 'make', 'makes',
  'so', 'be', 'is', 'are', 'was', 'to', 'of', 'and', 'that', 'this', 'these', 'those', 'game', 'world', 'level', 'just', 'really', 'very', 'go', 'goes', 'get',
  'gets', 'let', 'set', 'put', 'give', 'have', 'has', 'in', 'on', 'at', 'for', 'with', 'do', 'does', 'again', 'too', 'ok', 'okay', 'now', 'also', 'all', 'bit',
  'lot', 'lots', 'way', 'much', 'little', 'slightly', 'super', 'kind', 'of', 'some', 'little', 'tiny', 'want', 'like', 'turn', 'switch', 'when', 'whenever', 'hey',
  'every', 'thing', 'things', 'everything', 'even', 'than', 'then', 'there', 'them', 'they', 'he', 'she', 'his', 'her', 'their', 'by', 'as', 'up', 'down', 'double',
  'half', 'halve', 'twice',
]);

const PLUS = new Set(['higher', 'more', 'faster', 'bigger', 'stronger', 'longer', 'up', 'floatier', 'bouncier', 'quicker', 'increase', 'raise', 'boost', 'larger', 'taller', 'further', 'farther', 'louder', 'tougher', 'harder-hitting']);
const MINUS = new Set(['lower', 'less', 'slower', 'smaller', 'weaker', 'shorter', 'down', 'heavier', 'fewer', 'decrease', 'reduce', 'lessen', 'shrink', 'softer', 'quieter']);
/** Words that point at a kind of dial, for sentences that don't name one ("make it faster"). */
const IMPLIES: Record<string, string> = {
  faster: 'speed', slower: 'speed', quicker: 'speed',
  higher: 'height', lower: 'height', floatier: 'jump',
  stronger: 'strength', weaker: 'strength', tougher: 'strength',
  bigger: 'size', smaller: 'size', larger: 'size', taller: 'size',
  more: 'count', fewer: 'count', less: 'count',
};
const TWICE = new Set(['double', 'twice']);
const HALF = new Set(['half', 'halve']);
const BIG_STEP = ['a lot', 'way', 'much', 'lots', 'super', 'really'];
const SMALL_STEP = ['a little', 'a bit', 'slightly', 'a tiny bit', 'little bit'];
const OFF = new Set(['off', 'stop', 'no', 'disable', 'remove', 'without', 'normal', 'cancel', 'end', 'undo']);
const ON = new Set(['on', 'add', 'enable', 'start', 'activate']);

/** Words many dials share: alone they point at a kind of dial, not one dial. */
const GENERIC = new Set(['speed', 'height', 'power', 'health', 'hp', 'life', 'rate', 'size', 'count', 'value', 'time', 'strength', 'amount', 'number', 'level', 'max', 'min', 'distance', 'force', 'damage']);

/** Built-in synonyms by dial kind (§5.10). */
const KIND_WORDS: Array<[RegExp, string[]]> = [
  [/jump|hop|leap/, ['jump', 'hop', 'bounce', 'float', 'floaty', 'leap', 'height', 'high']],
  [/speed|fast|run|velocity|pace/, ['speed', 'fast', 'quick', 'run']],
  [/health|hp|life|lives|heart/, ['health', 'hp', 'life', 'live', 'heart', 'strength', 'tough']],
  [/count|number|many|amount|enem|spawn|rate/, ['many', 'number', 'count', 'amount']],
  [/gravity|weight|fall/, ['gravity', 'heavy', 'float', 'floaty', 'moon', 'fall']],
  [/size|scale|big/, ['size', 'big', 'small', 'large']],
  [/power|strength|damage/, ['power', 'strength', 'strong', 'damage', 'hit']],
];

/** Twists' names and the words students say for them (the kit's catalog). */
const TWIST_WORDS: Record<string, string> = {
  moonGravity: 'moon gravity low floaty float space',
  gravityFlips: 'gravity flip flips upside ceiling reverse',
  giantHero: 'giant huge mode smash grow mushroom',
  tinyHero: 'tiny mode shrink mini',
  slowmoHits: 'slow motion slowmo mo hits hit dramatic matrix',
  slowTime: 'slow time slower relaxed chill',
  bouncyWorld: 'bouncy bounce world trampoline rubber boing',
  starRain: 'rain stars star coins treasure sky falling',
  enemyParty: 'enemy enemies party crowd friend friends',
  speedUp: 'speed up faster turbo hurry',
  surpriseBoss: 'surprise boss giant monster',
  earthquake: 'earthquake quake shake rumble tremor',
  doubleJump: 'double jump air twice extra',
};
/** What must be said for a twist to count (so "slow" alone doesn't pick one). */
const TWIST_NEEDS: Record<string, string[][]> = {
  moonGravity: [['moon'], ['low', 'gravity'], ['floaty', 'gravity']],
  gravityFlips: [['flip', 'gravity'], ['upside'], ['gravity', 'reverse']],
  giantHero: [['giant'], ['huge', 'mode']],
  tinyHero: [['tiny', 'mode'], ['shrink', 'hero'], ['tiny', 'hero'], ['mini']],
  slowmoHits: [['slowmo'], ['slow', 'motion'], ['slow', 'mo']],
  slowTime: [['slow', 'time']],
  bouncyWorld: [['bouncy'], ['trampoline'], ['boing']],
  starRain: [['rain', 'star'], ['rain', 'coin'], ['rain', 'treasure'], ['falling', 'star']],
  enemyParty: [['enemy', 'party'], ['party']],
  speedUp: [['speed', 'up'], ['turbo']],
  surpriseBoss: [['surprise', 'boss']],
  earthquake: [['earthquake'], ['quake'], ['rumble']],
  doubleJump: [['double', 'jump'], ['jump', 'twice'], ['air', 'jump'], ['extra', 'jump']],
};

/** Saying one of these names the twist outright, so it wins over a dial ("double jump" is the twist). */
const TWIST_NAMES: Record<string, string[]> = {
  moonGravity: ['moon gravity'],
  gravityFlips: ['gravity flips', 'gravity flip', 'flip gravity', 'flip the gravity', 'upside down'],
  giantHero: ['giant mode', 'giant hero'],
  tinyHero: ['tiny mode', 'tiny hero'],
  slowmoHits: ['slow mo hits', 'slowmo hits', 'slow motion', 'slow mo'],
  slowTime: ['slow time'],
  bouncyWorld: ['bouncy world'],
  starRain: ['rain of stars', 'star rain', 'raining stars'],
  enemyParty: ['enemy party'],
  speedUp: ['speed up'],
  surpriseBoss: ['surprise boss'],
  earthquake: ['earthquake', 'earthquakes'],
  doubleJump: ['double jump', 'jump twice'],
};

/** Lower-case words (numbers kept); "slow-mo" and "slow mo" both give slow, mo. */
export function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/['’]/g, '')
    .split(/[^a-z0-9.]+/)
    .map((t) => t.replace(/^\.+|\.+$/g, ''))
    .filter(Boolean);
}

/** -iest/-ier → y, -est/-er, -ing, -ies → y, -s (§5.10). */
export function stem(word: string): string {
  if (/^\d/.test(word) || word.length <= 3) return word;
  if (word.endsWith('iest')) return `${word.slice(0, -4)}y`;
  if (word.endsWith('ier')) return `${word.slice(0, -3)}y`;
  if (word.endsWith('ies')) return `${word.slice(0, -3)}y`;
  if (word.endsWith('est') && word.length > 5) return undouble(word.slice(0, -3));
  if (word.endsWith('er') && word.length > 4) return undouble(word.slice(0, -2));
  if (word.endsWith('ing') && word.length > 5) return undouble(word.slice(0, -3));
  if (word.endsWith('s') && !word.endsWith('ss') && word.length > 3) return word.slice(0, -1);
  return word;
}

function undouble(w: string): string {
  return /([bdgmnprt])\1$/.test(w) ? w.slice(0, -1) : w;
}

function camelWords(key: string): string[] {
  return key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

function hasPhrase(text: string, phrases: readonly string[]): boolean {
  const t = ` ${text.toLowerCase().replace(/[^a-z0-9]+/g, ' ')} `;
  return phrases.some((p) => t.includes(` ${p} `));
}

// ------------------------------------------------------------------ dials

interface DialVocab {
  dial: DialInfo & { for?: string };
  specific: Set<string>;
  generic: Set<string>;
  /** Words naming the character the dial belongs to: they may appear, but never pick the dial alone. */
  target: Set<string>;
  /** Kinds from the built-in table this dial belongs to (speed, jump, gravity...). */
  kinds: Set<string>;
  inverted: boolean;
}

function vocabOf(dial: DialInfo & { for?: string }, targets: Map<string, string[]>): DialVocab {
  const specific = new Set<string>();
  const generic = new Set<string>();
  const kinds = new Set<string>();
  const add = (w: string) => {
    const s = stem(w);
    if (STOP.has(w) || STOP.has(s)) return;
    if (GENERIC.has(s) || GENERIC.has(w)) generic.add(s);
    else specific.add(s);
  };
  const own = [...camelWords(dial.key), ...tokens(dial.label)];
  for (const w of own) add(w);
  for (const w of tokens(dial.words ?? '')) add(w);
  const text = `${dial.key} ${dial.label}`.toLowerCase();
  for (const [re, words] of KIND_WORDS) {
    if (!re.test(text)) continue;
    kinds.add(words[0]);
    for (const w of words) (GENERIC.has(w) ? generic : specific).add(stem(w));
  }
  const target = new Set((targets.get(dial.for ?? '') ?? []).map(stem));
  return { dial, specific, generic, target, kinds, inverted: /gravity|weight|fall/.test(text) };
}

interface Parsed {
  words: string[];
  stems: string[];
  sign: 1 | -1 | 0;
  signWord: string | null;
  steps: number;
  exact: number | null;
  factor: number | null;
}

function parse(text: string): Parsed {
  const words = tokens(text);
  let sign: 1 | -1 | 0 = 0;
  let signWord: string | null = null;
  for (const w of words) {
    if (PLUS.has(w) || MINUS.has(w)) {
      sign = PLUS.has(w) ? 1 : -1;
      signWord = w;
    }
  }
  let exact: number | null = null;
  const toAt = words.findIndex((w, i) => w === 'to' && /^\d+(\.\d+)?$/.test(words[i + 1] ?? ''));
  if (toAt >= 0) exact = Number(words[toAt + 1]);
  else {
    const nums = words.filter((w) => /^\d+(\.\d+)?$/.test(w));
    if (nums.length === 1) exact = Number(nums[0]);
  }
  const factor = words.some((w) => TWICE.has(w)) ? 2 : words.some((w) => HALF.has(w)) ? 0.5 : null;
  const steps = hasPhrase(text, SMALL_STEP) ? 0.5 : hasPhrase(text, BIG_STEP) ? 2 : 1;
  return { words, stems: words.map(stem), sign, signWord, steps, exact, factor };
}

function covered(p: Parsed, allowed: Set<string>): boolean {
  return p.words.every((w, i) => {
    const s = p.stems[i];
    return STOP.has(w) || STOP.has(s) || PLUS.has(w) || MINUS.has(w) || /^\d+(\.\d+)?$/.test(w) || allowed.has(s) || allowed.has(w) || ['a', 'bit', 'lot', 'way'].includes(w);
  });
}

function score(v: DialVocab, p: Parsed, generics: Map<string, number>): number {
  // The direction word itself ("faster") points at a kind of dial, never at one dial.
  const nouns = p.stems.filter((_, i) => !PLUS.has(p.words[i]) && !MINUS.has(p.words[i]));
  const specificHit = nouns.some((s) => v.specific.has(s));
  const genericHit = nouns.some((s) => v.generic.has(s));
  const implied = p.signWord ? IMPLIES[p.signWord] : undefined;
  const impliedHit = implied !== undefined && (v.kinds.has(implied) || v.generic.has(implied) || (implied === 'height' && v.kinds.has('jump')) || (implied === 'strength' && (v.kinds.has('health') || v.kinds.has('power'))));
  const named = nouns.some((s) => v.target.has(s)) ? 0.05 : 0;
  if (specificHit) return 0.9 + (genericHit || impliedHit ? 0.1 : 0) + named;
  if (genericHit) {
    const shared = nouns.filter((s) => v.generic.has(s)).every((s) => (generics.get(s) ?? 0) <= 1);
    return shared ? 0.85 : 0.6;
  }
  // "make it faster": only when one dial is of that kind, and it is the hero's or the whole world's.
  const heroOrWorld = !v.dial.for || v.dial.for === 'hero';
  if (impliedHit && implied) return heroOrWorld && (generics.get(`kind:${implied}`) ?? 0) === 1 ? 0.8 : 0.5;
  return 0;
}

function snap(value: number, d: DialInfo): number {
  const step = d.step > 0 ? d.step : 1;
  const snapped = Math.round((value - d.min) / step) * step + d.min;
  const clamped = Math.min(d.max, Math.max(d.min, snapped));
  return Number(clamped.toFixed(4));
}

function steerDial(p: Parsed, world: World, manifest: GameManifest): LocalSteer | null {
  const dials = manifest.dials as Array<DialInfo & { for?: string }>;
  if (!dials.length) return null;
  const targets = new Map<string, string[]>();
  for (const a of manifest.art) targets.set(a.key, [...tokens(a.name), ...camelWords(a.key), a.role]);
  const vocabs = dials.map((d) => vocabOf(d, targets));
  const generics = new Map<string, number>();
  for (const v of vocabs) {
    for (const g of v.generic) generics.set(g, (generics.get(g) ?? 0) + 1);
    for (const k of v.kinds) generics.set(`kind:${k}`, (generics.get(`kind:${k}`) ?? 0) + 1);
  }
  const scored = vocabs.map((v) => ({ v, s: score(v, p, generics) })).sort((a, b) => b.s - a.s);
  const best = scored[0];
  if (!best || best.s < 0.8 || (scored[1] && scored[1].s === best.s)) return null;
  if (!p.sign && p.exact === null && p.factor === null) return null;
  const allowed = new Set([...best.v.specific, ...best.v.generic, ...best.v.target]);
  if (!covered(p, allowed)) return null;
  const d = best.v.dial;
  const from = world.dials[d.key] ?? d.current ?? d.value;
  let to: number;
  if (p.exact !== null) to = p.exact;
  else if (p.factor !== null) to = from * p.factor;
  else {
    const floaty = p.signWord === 'floatier' || p.signWord === 'bouncier';
    const sign = best.v.inverted && (floaty || p.signWord === 'heavier') ? (floaty ? -1 : 1) : p.sign;
    to = from + sign * p.steps * 0.2 * (d.max - d.min);
  }
  return { kind: 'dial', key: d.key, label: d.label, from, to: snap(to, d) };
}

// ------------------------------------------------------------------ twists

function twistMatches(text: string, p: Parsed, twists: readonly TwistInfo[], strong: boolean): TwistInfo[] {
  return twists.filter((t) => {
    if (!t.available) return false;
    const names = [...(TWIST_NAMES[t.id] ?? []), t.name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()];
    if (hasPhrase(text, names)) return true;
    if (strong) return false;
    const needs = TWIST_NEEDS[t.id] ?? [tokens(t.name).map(stem)];
    return needs.some((set) => set.every((w) => p.stems.includes(stem(w)) || p.words.includes(w)));
  });
}

function steerTwist(text: string, p: Parsed, twists: readonly TwistInfo[], strong: boolean): LocalSteer | null {
  const hits = twistMatches(text, p, twists, strong);
  if (hits.length !== 1) return null;
  const twist = hits[0];
  const vocab = new Set([...tokens(TWIST_WORDS[twist.id] ?? ''), ...tokens(twist.name), ...(TWIST_NAMES[twist.id] ?? []).flatMap(tokens)].map(stem));
  const allowed = new Set([...vocab, ...OFF, ...ON, 'when', 'hit', 'mode', 'time', 'hero', 'player', 'more']);
  if (!p.words.every((w, i) => STOP.has(w) || allowed.has(p.stems[i]) || allowed.has(w))) return null;
  // "off" words switch it off; anything else switches it on (it may already be on).
  const off = p.words.some((w) => OFF.has(w)) && !hasPhrase(text, ['turn on', 'switch on']);
  return { kind: 'twist', id: twist.id, name: twist.name, on: !off };
}

/** The local matcher: a dial move or a twist toggle, or null (the request needs the AI). */
export function steer(text: string, world: World, manifest: GameManifest | null): LocalSteer | null {
  if (!manifest || !text.trim() || text.length > 160) return null;
  const p = parse(text);
  if (!p.words.length) return null;
  return steerTwist(text, p, manifest.twists, true) ?? steerDial(p, world, manifest) ?? steerTwist(text, p, manifest.twists, false);
}
