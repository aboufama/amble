/**
 * The sound library: thousands of named sounds, none of them stored as audio. Each entry is a
 * family x variant x size x take (effects), a tune x instrument x key (jingles) or a style x
 * tempo x flavour x take (music loops), rendered by the sound engine when it is asked for.
 *
 *   soundLibrary()            every entry (built once, on first use)
 *   searchSounds(query, ...)  ranked text search over names, tags and descriptions
 *   renderLibrarySound(id)    -> { dataUrl, duration } (a mono 16-bit WAV)
 */

import { hash, renderRecipe, rng, toDataUrl, type Layer, type Recipe, type Rendered } from './engine';
import { JINGLES, JINGLE_KEYS, JINGLE_VOICES, jingleRecipe } from './jingles';
import { MUSIC_STYLES, keyName, renderMusic, type MusicParams } from './music';
import { ACTION } from './sfx/action';
import type { Build, Family } from './sfx/core';
import { PLAY } from './sfx/play';
import { WORLD } from './sfx/world';

export type SoundKind = 'effect' | 'music' | 'jingle';

export interface LibrarySound {
  id: string;
  /** A unique, human name: "Tiny Springy Jump", "Chiptune Loop: Pixel Quest". */
  name: string;
  kind: SoundKind;
  /** Search words, most specific first. */
  tags: string[];
  description: string;
  /** "movement", "combat"... for effects; "music" and "jingles" for the others. */
  category: string;
  /** The family, tune or style it belongs to: its variations share this. */
  family: string;
}

interface Entry extends LibrarySound {
  render(): Rendered;
  /** Weighted search terms (shared by the takes of one sound), and a few words of its own. */
  terms: Map<string, number>;
  own?: string;
  /** A small bonus for the plainest version (medium size, first take), so it leads its variations. */
  prior: number;
  /** The plainest version of a sound: the one shown when browsing. */
  plain: boolean;
  /** Variations of one sound share a group; the results spread across groups. */
  group: string;
}

// -----------------------------------------------------------------------------
// Words
// -----------------------------------------------------------------------------

const STOP = new Set(
  'a an and the of for to in on at with by from that this it its is are be as or when then into onto over under up down out off very some any one two each sound sounds sfx effect effects noise noises audio plays play played playing short like kind sort little bit game player players character characters gets get got makes make made goes go going something someone'.split(
    ' ',
  ),
);

/** Trims endings so "jumping", "jumps" and "jumped" all meet at "jump". */
export function stem(word: string): string {
  let w = word;
  if (w.length > 5 && w.endsWith('ing')) w = w.slice(0, -3);
  else if (w.length > 4 && w.endsWith('ies')) w = `${w.slice(0, -3)}y`;
  else if (w.length > 4 && w.endsWith('ed')) w = w.slice(0, -2);
  else if (w.length > 4 && w.endsWith('es') && /(s|x|z|ch|sh)es$/.test(w)) w = w.slice(0, -2);
  else if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') && !w.endsWith('us')) w = w.slice(0, -1);
  if (w.length > 3 && w[w.length - 1] === w[w.length - 2] && !/[aeiouls]/.test(w[w.length - 1])) w = w.slice(0, -1);
  if (w.length > 4 && w.endsWith('e')) w = w.slice(0, -1);
  if (w.length > 4 && w.endsWith('y')) w = `${w.slice(0, -1)}i`;
  return w;
}

/** Two-word names that mean one thing ("game over" is not about games, or about "over"). */
const PHRASES: Array<[RegExp, string]> = [
  [/game[\s-]+over/g, 'gameover'],
  [/level[\s-]+up/g, 'levelup'],
  [/power[\s-]+up/g, 'powerup'],
  [/power[\s-]+down/g, 'powerdown'],
  [/pick[\s-]+up/g, 'pickup'],
  [/high[\s-]+score/g, 'highscore'],
  [/times?[\s-]+up/g, 'timeup'],
  [/lo[\s-]+fi/g, 'lofi'],
  [/8[\s-]*bit/g, '8bit'],
  [/hi[\s-]+hat/g, 'hihat'],
  [/sci[\s-]+fi/g, 'scifi'],
  [/ta[\s-]+da+/g, 'tada'],
  [/(?:1|one)[\s-]*up\b/g, 'oneup'],
  [/wind[\s-]+up/g, 'windup'],
  [/pop[\s-]+up/g, 'popup'],
  [/ping[\s-]+pong/g, 'pingpong'],
];

/** Lower-case words of a text, stemmed, without the filler. */
export function words(text: string): string[] {
  const out: string[] = [];
  let clean = text.toLowerCase().replace(/['’]/g, '');
  for (const [phrase, word] of PHRASES) clean = clean.replace(phrase, word);
  for (const raw of clean.split(/[^a-z0-9]+/)) {
    if (!raw || STOP.has(raw)) continue;
    out.push(stem(raw));
  }
  return out;
}

const cap = (s: string): string => (s ? s[0].toUpperCase() + s.slice(1) : s);
const slug = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

/** The same tags and descriptions are shared by many entries: split each text once. */
const wordCache = new Map<string, string[]>();
function cachedWords(text: string): string[] {
  let w = wordCache.get(text);
  if (!w) wordCache.set(text, (w = words(text)));
  return w;
}

function terms(fields: Array<[text: string, weight: number]>): Map<string, number> {
  const map = new Map<string, number>();
  for (const [text, weight] of fields) for (const w of cachedWords(text)) if ((map.get(w) ?? 0) < weight) map.set(w, weight);
  return map;
}

// -----------------------------------------------------------------------------
// Effects: family x variant x size x take
// -----------------------------------------------------------------------------

interface Size {
  id: string;
  word: string;
  tags: string;
  about: string;
  p: number;
  t: number;
  z: number;
}
const SIZES: Size[] = [
  { id: 'xs', word: 'Tiny', tags: 'tiny small little short quick light high', about: 'tiny: much shorter and higher', p: 1.682, t: 0.62, z: -2 },
  { id: 's', word: 'Small', tags: 'small little short light', about: 'small: shorter and higher', p: 1.26, t: 0.8, z: -1 },
  { id: 'm', word: '', tags: 'medium normal regular', about: '', p: 1, t: 1, z: 0 },
  { id: 'l', word: 'Big', tags: 'big large heavy long low deep', about: 'big: longer and lower', p: 0.749, t: 1.3, z: 1 },
  { id: 'xl', word: 'Huge', tags: 'huge giant massive enormous heavy long low deep', about: 'huge: much longer and lower', p: 0.561, t: 1.7, z: 2 },
];
const TAKE_P = [1, 1.122, 0.891, 1.26];
const TAKE_T = [1, 0.9, 1.12, 0.82];

export const EFFECT_FAMILIES: Family[] = [...ACTION, ...WORLD, ...PLAY];

/** A layer played `p` times higher and `t` times longer, like a tape at another speed. */
function resize(L: Layer, p: number, t: number): Layer {
  const out: Layer = { ...L, d: (L.d ?? 0.15) * t };
  if (L.t !== undefined) out.t = L.t * t;
  if (L.f !== undefined) out.f = L.f * p;
  if (L.f2 !== undefined) out.f2 = L.f2 * p;
  if (L.g !== undefined) out.g = L.g * t;
  if (L.env) out.env = [L.env[0] * t, L.env[1] * t, L.env[2], L.env[3] * t];
  if (L.vib) out.vib = [L.vib[0] / t, L.vib[1], (L.vib[2] ?? 0) * t];
  if (L.trem) out.trem = [L.trem[0] / t, L.trem[1], L.trem[2]];
  if (L.pwm) out.pwm = [L.pwm[0] / t, L.pwm[1]];
  if (L.flfo) out.flfo = [L.flfo[0] / t, L.flfo[1]];
  if (L.fc !== undefined) out.fc = L.fc * p;
  if (L.fc2 !== undefined) out.fc2 = L.fc2 * p;
  if (L.fg !== undefined) out.fg = L.fg * t;
  if (L.st !== undefined) out.st = L.st * t;
  if (L.rep) out.rep = [L.rep[0], L.rep[1] * t, L.rep[2], L.rep[3]];
  return out;
}

/**
 * Renders one effect: a variant's builder (written at medium size), played at a size and take.
 * Sizes and takes change the pitch and the length of everything in the recipe; the id seeds
 * the details a builder leaves to chance, so a take is more than a transposition.
 */
function renderEffect(id: string, build: Build, size: Size, k: number): Rendered {
  const rnd = rng(hash(id));
  const built = build({ z: size.z, k, r: (lo, hi) => lo + rnd() * (hi - lo) });
  const recipe: Recipe = Array.isArray(built) ? { layers: built } : built;
  const p = size.p * TAKE_P[k % TAKE_P.length];
  const t = size.t * TAKE_T[k % TAKE_T.length];
  const fx = recipe.fx ? { ...recipe.fx } : undefined;
  if (fx?.del) fx.del = [fx.del[0], fx.del[1] * t, fx.del[2]];
  if (fx?.ring) fx.ring *= p;
  return renderRecipe({ ...recipe, layers: p === 1 && t === 1 ? recipe.layers : recipe.layers.map((L) => resize(L, p, t)), fx, seed: recipe.seed ?? hash(id) });
}

const variantSlug = (key: string): string => slug(key.replace(/%s?/g, ''));

function effectEntries(): Entry[] {
  const out: Entry[] = [];
  for (const fam of EFFECT_FAMILIES) {
    const sizes = fam.sizes === 1 ? [SIZES[2]] : fam.sizes === 3 ? [SIZES[1], SIZES[2], SIZES[3]] : SIZES;
    const takes = fam.takes ?? 2;
    const variants = Object.entries(fam.v);
    variants.forEach(([key, [vTags, vAbout, build]], vi) => {
      const base = key.startsWith('=') ? key.slice(1) : key.includes('%') ? key.replace('%', fam.name) : `${key} ${fam.name}`;
      const vSlug = variantSlug(key);
      for (const size of sizes) {
        const tags = [...new Set(`${vTags} ${fam.tags} ${size.tags} ${fam.cat}`.split(' ').filter(Boolean))];
        const description = `${cap(fam.about)}: ${vAbout}${size.about ? ` (${size.about})` : ''}.`;
        const shared = terms([
          [fam.name, 6],
          [`${size.word} ${base}`, 5],
          [vTags, 4.5],
          [fam.tags, 3.5],
          [size.tags, 2],
          [fam.cat, 2],
          [`${fam.about} ${vAbout}`, 1],
        ]);
        for (let k = 0; k < takes; k++) {
          const id = `${fam.id}-${vSlug}-${size.id}${k ? `-${k + 1}` : ''}`;
          const name = `${size.word} ${base}`.trim() + (k ? ` ${k + 1}` : '');
          const render = (): Rendered => renderEffect(id, build, size, k);
          out.push({
            id,
            name,
            kind: 'effect',
            tags,
            description,
            category: fam.cat,
            family: fam.id,
            render,
            terms: shared,
            // The plainest version leads: medium size, first take, and the family's first (most typical) variant.
            prior: (size.z === 0 ? 0.03 : Math.abs(size.z) === 1 ? 0.012 : 0) + (k === 0 ? 0.02 : 0) + 0.02 * (1 - vi / variants.length),
            plain: size.z === 0 && k === 0,
            group: `${fam.id}/${vSlug}`,
          });
        }
      }
    });
  }
  return out;
}

// -----------------------------------------------------------------------------
// Jingles: tune x take x instrument x key
// -----------------------------------------------------------------------------

function jingleEntries(): Entry[] {
  const out: Entry[] = [];
  for (const j of JINGLES) {
    for (const voice of JINGLE_VOICES) {
      JINGLE_KEYS.forEach((key, ki) => {
        const tags = [...new Set(`${j.tags} jingle stinger tune ${voice.tags} ${key.tags}`.split(' ').filter(Boolean))];
        const description = `${cap(j.about)}, played on ${voice.about}${key.word ? ` (${key.tags.split(' ')[0]})` : ''}. A short tune, not a loop.`;
        const shared = terms([
          [`${j.name} ${voice.name}`, 5],
          [j.tags, 4],
          ['jingle stinger tune', 3],
          [voice.tags, 2],
          [key.tags, 2],
          [j.about, 1],
        ]);
        j.tunes.forEach((_, take) => {
          const id = `jingle-${j.id}-${voice.id}-${take + 1}${ki ? `-${slug(key.word)}` : ''}`;
          const name = `${key.word ? `${key.word} ` : ''}${voice.name} ${j.name}${take ? ` ${take + 1}` : ''}`;
          out.push({
            id,
            name,
            kind: 'jingle',
            tags,
            description,
            category: 'jingles',
            family: j.id,
            render: () => renderRecipe(jingleRecipe(j, take, voice, key)),
            terms: shared,
            prior: (ki === 0 ? 0.03 : 0) + (take === 0 ? 0.02 : 0),
            plain: ki === 0 && take === 0,
            group: `${j.id}/${voice.id}`,
          });
        });
      });
    }
  }
  return out;
}

// -----------------------------------------------------------------------------
// Music loops: style x tempo x flavour x take
// -----------------------------------------------------------------------------

const TEMPOS = [
  { id: 'slow', tags: 'slow calm relaxed gentle easy', energy: 0.35 },
  { id: 'medium', tags: 'medium steady moderate', energy: 0.6 },
  { id: 'fast', tags: 'fast quick energetic lively upbeat driving', energy: 0.85 },
] as const;
const LOOP_KEYS = ['C', 'D', 'F', 'G', 'A', 'E', 'Bb', 'Eb'];
const LOOP_TAKES = 5;

/** The parameters of a library loop (so the same loop can be re-made, or varied). */
export function loopParams(style: string, tempo: number, dark: boolean, take: number): MusicParams {
  const info = MUSIC_STYLES.find((s) => s.id === style) ?? MUSIC_STYLES[0];
  const ti = Math.max(0, Math.min(2, tempo));
  const n = take + ti * LOOP_TAKES + (dark ? 3 * LOOP_TAKES : 0);
  return { style: info.id, tempo: info.bpm[ti], energy: TEMPOS[ti].energy, dark, key: LOOP_KEYS[(n * 3 + info.id.length) % LOOP_KEYS.length], seed: n + 1 };
}

function musicEntries(): Entry[] {
  const out: Entry[] = [];
  for (const st of MUSIC_STYLES) {
    const adjectives = st.words[0].split(' ');
    const nouns = st.words[1].split(' ');
    let i = 0;
    for (let ti = 0; ti < TEMPOS.length; ti++) {
      for (const dark of [false, true]) {
        const flavour = st.flavours[dark ? 1 : 0];
        const tempo = TEMPOS[ti];
        const shade = dark ? 'dark minor moody serious' : 'bright major light';
        const tags = [...new Set(`${st.id} ${flavour} ${tempo.tags} ${shade} ${st.tags} music loop song tune theme soundtrack background bgm melody`.split(' ').filter(Boolean))];
        const shared = terms([
          [`${st.name} ${st.id}`, 6],
          [st.tags, 4],
          ['music loop song tune theme soundtrack background bgm melody', 3],
          [`${flavour} ${tempo.tags} ${shade}`, 2.5],
          [st.about, 1],
        ]);
        for (let take = 0; take < LOOP_TAKES; take++, i++) {
          const params = loopParams(st.id, ti, dark, take);
          const title = `${adjectives[i % adjectives.length]} ${nouns[(i + 3 * Math.floor(i / adjectives.length)) % nouns.length]}`;
          const id = `music-${st.id}-${tempo.id}-${dark ? 'dark' : 'bright'}-${take + 1}`;
          out.push({
            id,
            name: `${st.name} Loop: ${title}`,
            kind: 'music',
            tags,
            description: `${st.name} music: ${st.about}. ${cap(tempo.id)} (${params.tempo} bpm), ${flavour}, in ${params.key} ${dark ? 'minor' : 'major'}-ish. Loops seamlessly.`,
            category: 'music',
            family: st.id,
            render: () => renderMusic(params),
            terms: shared,
            own: title,
            prior: (ti === 1 ? 0.03 : 0) + (take === 0 ? 0.02 : 0) + (dark ? 0 : 0.005),
            plain: ti === 1 && take === 0,
            group: `${st.id}/${tempo.id}/${dark ? 'd' : 'b'}`,
          });
        }
      }
    }
  }
  return out;
}

// -----------------------------------------------------------------------------
// The catalog and its index
// -----------------------------------------------------------------------------

interface Index {
  entries: Entry[];
  byId: Map<string, Entry>;
  /** Entries that share their search terms (the takes of one sound) form a set. */
  sets: number[][];
  /** word -> the sets that have it, and how much it weighs in each. */
  postings: Map<string, Posting>;
  /** word -> entries that have it as a word of their own (a tune's title). */
  own: Map<string, number[]>;
}

interface Posting {
  at: number[];
  weight: number[];
}

let index: Index | null = null;

function buildIndex(): Index {
  const entries = [...effectEntries(), ...jingleEntries(), ...musicEntries()];
  const byId = new Map<string, Entry>();
  const names = new Set<string>();
  for (const e of entries) {
    // Names and ids are unique by construction; a clash would be a mistake in a family.
    if (byId.has(e.id) || names.has(e.name)) throw new Error(`Sound library: duplicate "${e.name}" (${e.id})`);
    byId.set(e.id, e);
    names.add(e.name);
  }
  wordCache.clear();
  const postings = new Map<string, Posting>();
  const own = new Map<string, number[]>();
  const sets: number[][] = [];
  const setOf = new Map<Map<string, number>, number>();
  entries.forEach((e, i) => {
    let set = setOf.get(e.terms);
    if (set === undefined) {
      set = sets.length;
      setOf.set(e.terms, set);
      sets.push([]);
      for (const [word, weight] of e.terms) {
        let list = postings.get(word);
        if (!list) postings.set(word, (list = { at: [], weight: [] }));
        list.at.push(set);
        list.weight.push(weight);
      }
    }
    sets[set].push(i);
    if (e.own) {
      for (const word of words(e.own)) {
        if (e.terms.has(word)) continue;
        const list = own.get(word);
        if (list) list.push(i);
        else own.set(word, [i]);
      }
    }
  });
  return { entries, byId, sets, postings, own };
}

const getIndex = (): Index => (index ??= buildIndex());

/** Every sound in the library. */
export function soundLibrary(): LibrarySound[] {
  return getIndex().entries;
}

export function findSound(id: string): LibrarySound | undefined {
  return getIndex().byId.get(id);
}

const MUSIC_WORDS = new Set(words('music musical tune loop theme song soundtrack bgm'));
const JINGLE_WORDS = new Set(words('jingle stinger fanfare ditty'));

/** Does this text ask for music (a loop to play under the game) rather than an effect? */
export function wantsMusic(text: string): boolean {
  return words(text).some((w) => MUSIC_WORDS.has(w));
}

export interface SearchOptions {
  /** Only these kinds. */
  kind?: SoundKind | SoundKind[];
  /** How many results (default 20). */
  limit?: number;
}

/**
 * Finds sounds by everyday words: "boing" finds jumps and bounces, "pew" lasers, "spooky music"
 * spooky loops. Results are ranked by how well the words match, and spread across variations so
 * the first few are different sounds, not ten sizes of one.
 */
export function searchSounds(query: string, opts: SearchOptions = {}): LibrarySound[] {
  const { entries, sets, postings, own } = getIndex();
  const limit = Math.max(1, opts.limit ?? 20);
  const kinds = opts.kind ? new Set(Array.isArray(opts.kind) ? opts.kind : [opts.kind]) : null;
  // Each distinct word counts once, a little more if it is said twice (a name repeated in a description).
  const counts = new Map<string, number>();
  for (const w of words(query)) counts.set(w, (counts.get(w) ?? 0) + 1);
  const scores = new Float64Array(entries.length);
  const hits = new Uint8Array(entries.length);
  let asked = 0;
  for (const [word, count] of counts) {
    let lists: Array<[Posting, number]> = [];
    const exact = postings.get(word);
    if (exact) lists = [[exact, 1]];
    else if (word.length >= 4) {
      // No such word: try words that start with it, or that it starts with ("explos" ~ "explosion").
      for (const [other, list] of postings) if (other.length >= 4 && (other.startsWith(word) || word.startsWith(other))) lists.push([list, 0.6]);
    }
    const titled = own.get(word);
    if (!lists.length && !titled) continue;
    asked++;
    const seen = new Map<number, number>();
    for (const [list, factor] of lists) {
      for (let j = 0; j < list.at.length; j++) {
        const w = list.weight[j] * factor;
        if ((seen.get(list.at[j]) ?? 0) < w) seen.set(list.at[j], w);
      }
    }
    let df = titled ? titled.length : 0;
    for (const set of seen.keys()) df += sets[set].length;
    const rarity = Math.min(4, Math.log(1 + entries.length / df));
    const boost = (0.4 + rarity) * (count > 1 ? 1.4 : 1);
    for (const [set, weight] of seen) {
      for (const i of sets[set]) {
        scores[i] += weight * boost;
        hits[i]++;
      }
    }
    if (titled) {
      for (const i of titled) {
        scores[i] += 1.5 * boost;
        hits[i]++;
      }
    }
  }
  if (!asked) return [];
  const musicAsked = [...counts.keys()].some((w) => MUSIC_WORDS.has(w));
  const jingleAsked = [...counts.keys()].some((w) => JINGLE_WORDS.has(w));
  const ranked: Array<{ e: Entry; s: number }> = [];
  for (let i = 0; i < entries.length; i++) {
    if (!hits[i]) continue;
    const e = entries[i];
    if (kinds && !kinds.has(e.kind)) continue;
    // Matching more of the words matters more than matching one of them well.
    let s = scores[i] * (0.35 + 0.65 * (hits[i] / asked)) * (1 + e.prior);
    if (!kinds && musicAsked && e.kind !== 'music') s *= 0.5;
    if (!kinds && !musicAsked && !jingleAsked && e.kind !== 'effect') s *= 0.8;
    ranked.push({ e, s });
  }
  ranked.sort((a, b) => b.s - a.s || (a.e.id < b.e.id ? -1 : 1));
  // A sound whose whole name was asked for ("splash" -> "Splash", not "Water Pour") moves up.
  const head = ranked.slice(0, Math.max(200, limit * 12));
  for (const r of head) if (words(r.e.name).every((w) => counts.has(w) || /^\d+$/.test(w))) r.s *= 1.2;
  head.sort((a, b) => b.s - a.s || (a.e.id < b.e.id ? -1 : 1));
  // Spread: each further variation of the same sound, and each further sound of a family, counts for less.
  const out: Entry[] = [];
  const perGroup = new Map<string, number>();
  const perFamily = new Map<string, number>();
  const pool = head;
  while (out.length < limit && pool.length) {
    let best = 0;
    let bestScore = -1;
    for (let i = 0; i < pool.length; i++) {
      const { e, s } = pool[i];
      const adjusted = s * Math.pow(0.55, perGroup.get(e.group) ?? 0) * Math.pow(0.93, perFamily.get(e.family) ?? 0);
      if (adjusted > bestScore) {
        bestScore = adjusted;
        best = i;
      }
    }
    const [{ e }] = pool.splice(best, 1);
    out.push(e);
    perGroup.set(e.group, (perGroup.get(e.group) ?? 0) + 1);
    perFamily.set(e.family, (perFamily.get(e.family) ?? 0) + 1);
  }
  return out;
}

export interface BrowseOptions {
  kind?: SoundKind;
  category?: string;
  /** Every size and take, not only the plainest version of each sound. */
  all?: boolean;
}

/** Sounds to browse without searching: by default the plainest version of each (medium size, first take). */
export function browseSounds(opts: BrowseOptions = {}): LibrarySound[] {
  return getIndex().entries.filter((e) => (opts.all || e.plain) && (!opts.kind || e.kind === opts.kind) && (!opts.category || e.category === opts.category));
}

/** The samples of a library sound (null if there is no such id). */
export function renderLibrarySamples(id: string): Rendered | null {
  const e = getIndex().byId.get(id);
  return e ? e.render() : null;
}

/** A library sound as a WAV data URL (null if there is no such id). */
export function renderLibrarySound(id: string): { dataUrl: string; duration: number } | null {
  const r = renderLibrarySamples(id);
  return r ? toDataUrl(r) : null;
}

/** The sounds a new project starts with ("pop", "jump"...), by the names the old presets had. */
const PRESETS: Record<string, readonly [family: string, variant: string]> = {
  coin: ['coin', 'Classic'],
  jump: ['jump', 'Springy'],
  laser: ['laser', 'Pew'],
  hit: ['hit', 'Smacking'],
  explosion: ['explosion', 'Booming'],
  powerup: ['powerup', 'Rising'],
  blip: ['blip', 'High'],
  pop: ['pop', 'Bubble'],
};
const presetCache = new Map<string, { dataUrl: string; duration: number }>();

/**
 * A starter sound by its old preset name, from the library (null for a name it doesn't know).
 * Made without building the whole catalog, so opening the editor stays quick.
 */
export function presetSound(preset: string): { dataUrl: string; duration: number } | null {
  const cached = presetCache.get(preset);
  if (cached) return cached;
  let rendered: Rendered | null = null;
  if (preset === 'gameover') {
    const j = JINGLES.find((x) => x.id === 'gameover');
    if (j) rendered = renderRecipe(jingleRecipe(j, 0, JINGLE_VOICES[0], JINGLE_KEYS[0]));
  } else if (PRESETS[preset]) {
    const [famId, key] = PRESETS[preset];
    const fam = EFFECT_FAMILIES.find((f) => f.id === famId);
    const variant = fam?.v[key];
    if (fam && variant) rendered = renderEffect(`${fam.id}-${variantSlug(key)}-m`, variant[2], SIZES[2], 0);
  }
  if (!rendered) return null;
  const sound = toDataUrl(rendered);
  presetCache.set(preset, sound);
  return sound;
}

/** The categories in the library, with how many sounds each has (for the Sounds tab). */
export function soundCategories(): Array<{ id: string; count: number }> {
  const counts = new Map<string, number>();
  for (const e of getIndex().entries) counts.set(e.category, (counts.get(e.category) ?? 0) + 1);
  return [...counts].map(([id, count]) => ({ id, count }));
}

export { keyName };
