/**
 * Music: a step sequencer and a small composer.
 *
 * `composeMusic` writes a short song in a style (drums, bass, chords, sometimes an arpeggio, and
 * a lead melody) from a few parameters; `renderMusic` plays it through the sound engine and wraps
 * the tails of the reverb, echoes and last notes round to the start, so the loop repeats without
 * a click. Everything is decided by the seed: the same parameters always make the same music.
 *
 * The melody is written the way a beginner is taught to: chord notes on the strong beats, steps
 * of the scale between them, a shape that rises then comes home, and a first idea that returns.
 */

import {
  LONG_RATE,
  PEAK,
  applyFx,
  clamp,
  delayWet,
  layerEnd,
  filterBuffer,
  limitBuffer,
  loudness,
  midiHz,
  peakOf,
  renderLayer,
  reverbWet,
  rng,
  trimLows,
  type Fx,
  type Layer,
  type Rendered,
} from './engine';
import {
  PATCHES,
  brush,
  chipHat,
  chipKick,
  chipSnare,
  clap,
  clave,
  conga,
  cowbell,
  cymbal,
  hat,
  kick,
  ride,
  rim,
  shaker,
  snare,
  tambourine,
  timpani,
  tom,
  triangleHit,
  woodblock,
  type PatchName,
} from './instruments';

export type Mood = 'happy' | 'calm' | 'heroic' | 'silly' | 'tense' | 'sad' | 'mysterious' | 'scary';
export const MOODS: Mood[] = ['happy', 'calm', 'heroic', 'silly', 'tense', 'sad', 'mysterious', 'scary'];
/** Each mood: does it lean dark (minor), and how much livelier or calmer it is. */
const MOOD_SHAPE: Record<Mood, readonly [boolean, number]> = {
  happy: [false, 0.1],
  calm: [false, -0.3],
  heroic: [false, 0.2],
  silly: [false, 0.05],
  tense: [true, 0.2],
  sad: [true, -0.3],
  mysterious: [true, -0.15],
  scary: [true, 0],
};

export interface MusicParams {
  /** One of MUSIC_STYLES' ids. */
  style: string;
  /** Beats per minute; leave out (or 0) for the style's own tempo. */
  tempo?: number;
  /** "C", "F#", "Bb"...; leave out for a key chosen by the seed. */
  key?: string;
  mood?: Mood;
  /** Dark (minor) or bright (major) flavour; by default the mood decides. */
  dark?: boolean;
  /** 0 (sparse, gentle) .. 1 (busy, driving). */
  energy?: number;
  seed?: number;
  /** One chord per bar in roman numerals ("I", "vi", "bVII", "V7"); empty = the style's own. */
  chords?: string[];
  /** The lead melody on an eighth-note grid: scale steps 1..15 (8 = an octave up), 0 = rest, -1 = hold. Empty = composed. */
  melody?: number[];
}

// -----------------------------------------------------------------------------
// Theory
// -----------------------------------------------------------------------------

const SCALES = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  harmonic: [0, 2, 3, 5, 7, 8, 11],
  hijaz: [0, 1, 4, 5, 7, 8, 10],
  pentatonic: [0, 2, 4, 7, 9],
  minorPentatonic: [0, 3, 5, 7, 10],
  blues: [0, 3, 5, 6, 7, 10],
  insen: [0, 2, 3, 7, 8],
} as const;
type ScaleName = keyof typeof SCALES;

const KEY_NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
const KEY_ALIASES: Record<string, number> = { DB: 1, 'D#': 3, GB: 6, 'G#': 8, 'A#': 10, CB: 11, 'E#': 5, FB: 4, 'B#': 0 };

export function parseKey(key: string | undefined): number | null {
  if (!key) return null;
  const m = /^\s*([A-Ga-g])\s*([#b♯♭]?)/.exec(key);
  if (!m) return null;
  const name = m[1].toUpperCase() + (m[2] === '♯' ? '#' : m[2] === '♭' ? 'b' : m[2]);
  const i = KEY_NAMES.indexOf(name);
  return i >= 0 ? i : (KEY_ALIASES[name.toUpperCase()] ?? null);
}
export const keyName = (pc: number): string => KEY_NAMES[((pc % 12) + 12) % 12];

interface Chord {
  /** Semitones above the key note, 0..11. */
  root: number;
  /** Intervals above the root. */
  ints: number[];
}

const DEGREES: Record<string, number> = { i: 0, ii: 2, iii: 4, iv: 5, v: 7, vi: 9, vii: 11 };

/** "bVII", "ii7", "Vsus4", "I5"... -> a chord. Unreadable symbols become the home chord. */
export function parseChord(sym: string): Chord {
  const m = /^\s*([b#]?)(VII|VI|IV|V|III|II|I|vii|vi|iv|v|iii|ii|i)(.*?)\s*$/.exec(sym);
  if (!m) return { root: 0, ints: [0, 4, 7] };
  const minor = m[2] === m[2].toLowerCase();
  const root = (DEGREES[m[2].toLowerCase()] + (m[1] === 'b' ? 11 : m[1] === '#' ? 1 : 0)) % 12;
  const q = m[3].toLowerCase().replace(/[()\s]/g, '');
  let ints = minor ? [0, 3, 7] : [0, 4, 7];
  if (q === '5') ints = [0, 7];
  else if (q === 'dim' || q === '°' || q === 'o') ints = [0, 3, 6];
  else if (q === 'dim7' || q === '°7') ints = [0, 3, 6, 9];
  else if (q === 'm7b5' || q === 'ø' || q === '7b5') ints = [0, 3, 6, 10];
  else if (q === 'aug' || q === '+') ints = [0, 4, 8];
  else if (q === 'sus4' || q === 'sus') ints = [0, 5, 7];
  else if (q === 'sus2') ints = [0, 2, 7];
  else if (q === 'maj7' || q === 'm7+' ) ints = [0, 4, 7, 11];
  else if (q === '7') ints = [...ints, 10];
  else if (q === '6') ints = [...ints, 9];
  else if (q === '9') ints = [...ints, 10, 14];
  else if (q === 'add9') ints = [...ints, 14];
  return { root, ints };
}

const mod12 = (n: number): number => ((n % 12) + 12) % 12;

// -----------------------------------------------------------------------------
// Rhythms for the lead: cells of one bar. x = a note starts, - = it holds, . = rest.
// `c` cells end a phrase (they land on a long note).
// -----------------------------------------------------------------------------

const FEELS = {
  pop: {
    n: ['x.x.x...x.x.x...', 'x...x.x.x...x.x.', 'x.x.x.x.x...x...', '..x.x.x.x.x.x...', 'x..x..x.x...x.x.', 'x...x...x.x.x.x.'],
    c: ['x.x.x...x-------', 'x...x.x.x-------', 'x.x.x-x-x-------'],
  },
  sync: {
    n: ['x..x..x.x..x..x.', '..x.x..x.x..x...', 'x.x..x.x..x.x...', 'x..x.x..x.x.x...', 'x.x.x..x..x...x.'],
    c: ['x..x..x.x-------', 'x.x..x..x-----..'],
  },
  fast: {
    n: ['x.xxx.x.x.xxx.x.', 'xxx.x.x.xxx.x.x.', 'x.x.xxxxx.x.x...', 'x.xxx.xxx.x.x.x.', 'xxxxx.x.x.x.xxxx'],
    c: ['x.xxx.x.x-------', 'xxxxx.x.x---x---'],
  },
  slow: {
    n: ['x-------x---x---', 'x---x---x-------', 'x-----x-x---x---', '....x---x---x---', 'x---x-x-x-------'],
    c: ['x---x---x-------', 'x-------x-------', 'x-----x-x-------'],
  },
  float: {
    n: ['x-----------x---', 'x-------x-------', '....x-------x---', 'x---------x-x---'],
    c: ['x---------------', 'x-------x-------'],
  },
  march: {
    n: ['x..xx.x.x..xx.x.', 'x.x.x..xx.x.x...', 'x..xx..xx.x.x.x.', 'x...x.xxx...x.x.'],
    c: ['x..xx.x.x-------', 'x.x.x.x.x---x---'],
  },
  stac: {
    n: ['x.x...x.x.x.....', '..x.x.x...x.x...', 'x...x.x...x.x.x.', 'x.x.x.....x.x...'],
    c: ['x.x.x...x---....', 'x...x.x.x-......'],
  },
  // Twelve steps: three beats of four (a waltz)...
  waltz: {
    n: ['x---x---x---', 'x-------x---', 'x---x-x-x---', 'x-----x-x---', 'x-x-x---x---'],
    c: ['x-----------', 'x---x-------'],
  },
  // ...two beats of six (a jig)...
  jig: {
    n: ['x.x.x.x.x.x.', 'x---x.x---x.', 'x.x.x.x---x.', 'x---x.x.x.x.', 'x.x.x.x-----'],
    c: ['x---x.x-----', 'x.x.x.x-----'],
  },
  // ...or four beats of three (swing).
  swing: {
    n: ['x.xx.xx.xx..', 'x..x.xx..x.x', '..xx.xx.xx.x', 'x.xx..x.xx..', 'x..x..x.xx.x'],
    c: ['x.xx.xx-----', 'x..x.xx-----'],
  },
} as const;
type Feel = keyof typeof FEELS;

// -----------------------------------------------------------------------------
// Drum kits
// -----------------------------------------------------------------------------

type Kit = Record<string, Layer[]>;
const KITS = {
  rock: (): Kit => ({ k: kick(55, 0.28, 0.7), s: snare(195, 0.2, 0.8), h: hat(0.04), o: hat(0.26), y: cymbal(1.3), t: tom(165, 0.24), u: tom(105, 0.3), r: ride(0.45), c: clap(0.15), a: tambourine(0.12) }),
  electro: (): Kit => ({ k: kick(47, 0.42, 0.3, 0.35), s: [...snare(180, 0.17, 0.9), ...clap(0.12, 0.4)], h: hat(0.03), o: hat(0.22), y: cymbal(1.1), t: tom(150, 0.22), u: tom(96, 0.28), c: clap(0.18), b: cowbell(), a: shaker(0.04) }),
  chip: (): Kit => ({ k: chipKick(), s: chipSnare(), h: chipHat(), o: chipHat(0.12), y: chipSnare(0.4), t: [{ w: 'square', f: 420, f2: 160, d: 0.07, env: [0.001, 0.07, 0.3, 0.04], v: 0.6 }], u: [{ w: 'square', f: 280, f2: 100, d: 0.08, env: [0.001, 0.08, 0.3, 0.04], v: 0.6 }] }),
  jazz: (): Kit => ({ k: kick(62, 0.2, 0.2, 0, 0.55), s: brush(0.12), h: hat(0.03, 0.6), o: hat(0.2, 0.5), r: ride(0.5), y: cymbal(1.5, 0.6), t: tom(170, 0.2, 0.7), u: tom(120, 0.25, 0.7) }),
  latin: (): Kit => ({ k: kick(60, 0.22, 0.4), s: rim(), h: shaker(0.045, 1.6), p: conga(205, 0.22, 0.15), q: conga(300, 0.13, 0.9), b: cowbell(560, 0.2), w: clave(), y: cymbal(0.9), t: conga(330, 0.12, 0.6), u: conga(190, 0.2, 0.3), a: tambourine(0.1) }),
  orch: (): Kit => ({ k: timpani(65, 0.8), u: timpani(73, 0.7), t: timpani(98, 0.6), s: snare(215, 0.13, 0.9), y: cymbal(1.9), h: triangleHit(0.25, 0.5), a: tambourine(0.12) }),
  soft: (): Kit => ({ k: kick(60, 0.2, 0.1, 0, 0.5), s: brush(0.1, 0.55), h: shaker(0.04, 0.6), p: triangleHit(0.7, 0.4), w: woodblock(900, 0.6), c: [...rim(0.4), ...clap(0.08, 0.35)], y: cymbal(1.6, 0.35), t: woodblock(1300, 0.6), u: woodblock(700, 0.6), j: tambourine(0.09, 0.5) }),
  toy: (): Kit => ({ k: kick(72, 0.3, 0.35), s: snare(235, 0.12, 0.9), y: cymbal(0.6, 0.8, 1.15), h: hat(0.03), w: woodblock(), p: triangleHit(0.5, 0.5), t: tom(200, 0.18), u: tom(140, 0.2), a: tambourine(0.1) }),
  taiko: (): Kit => ({ k: [...tom(66, 0.55), { w: 'noise', d: 0.008, env: [0, 0.01, 0.3, 0.06], ft: 'lp', fc: 900, v: 0.6 }], t: tom(98, 0.4), u: tom(80, 0.45), s: rim(), w: woodblock(1400), y: cymbal(1.6, 0.5, 0.8), h: shaker(0.04, 0.5) }),
  lofi: (): Kit => ({ k: kick(50, 0.3, 0.2, 0.3), s: [...snare(170, 0.14, 0.45), ...rim(0.4)], h: hat(0.028, 0.5, 0.8), o: hat(0.15, 0.4, 0.8), y: cymbal(1, 0.3, 0.8), t: tom(150, 0.2, 0.6), u: tom(100, 0.24, 0.6) }),
} satisfies Record<string, () => Kit>;
type KitName = keyof typeof KITS;

// -----------------------------------------------------------------------------
// Styles
// -----------------------------------------------------------------------------

type Voicing = 'close' | 'power' | 'open' | 'shell';

interface Part {
  p: PatchName;
  /** Patterns of one bar or more (one is picked by the seed). */
  pat: string[];
  v: number;
  rev?: number;
  del?: number;
  /** How much of each step the note holds, 0..1. */
  gate?: number;
  /** Semitones up or down from the usual register. */
  oct?: number;
  voicing?: Voicing;
  fx?: Fx;
}

interface Lead {
  p: PatchName;
  feel: Feel;
  v: number;
  rev?: number;
  del?: number;
  gate?: number;
  oct?: number;
  /** Chromatic passing notes (circus, sneaking about). */
  chrom?: boolean;
  fx?: Fx;
}

interface Style {
  name: string;
  /** Search words. */
  tags: string;
  about: string;
  /** Slow, usual and fast tempo. */
  bpm: readonly [number, number, number];
  /** Quarter-note beats per bar (default 4) and steps per bar (default 16). */
  beats?: 3 | 4;
  steps?: 12 | 16;
  /** Steps per felt beat (default 4; 6 for a jig, 3 for swing). */
  pulse?: number;
  /** Lateness of every second step, 0..0.3 of a step. */
  swing?: number;
  /** Scale for the bright and the dark flavour, and what each flavour is called. */
  scales: readonly [ScaleName, ScaleName];
  flavours: readonly [string, string];
  /** Chord progressions (roman numerals) for bright and dark. */
  prog: readonly [string[], string[]];
  kit: KitName;
  /** "k:x...|s:....x..." one line per drum; x hit, X accent, o soft. */
  drums: string[];
  drumVol?: number;
  bass: Part;
  comp: Part;
  arp?: Part;
  lead: Lead;
  /** Reverb [size, damping]; echo [steps, feedback]. */
  room?: readonly [number, number];
  echo?: readonly [number, number];
  /** How hard the kick ducks the rest (dance music's pumping). */
  pump?: number;
  master?: Fx;
  /** A bed of noise under the music (vinyl crackle, bubbles): layers for a loop of `sec` seconds. */
  bed?: (sec: number) => Layer[];
  bedVol?: number;
  /** Words for naming tunes: adjectives | nouns. */
  words: readonly [string, string];
}

const STYLES = {
  chiptune: {
    name: 'Chiptune',
    tags: 'chiptune chip 8-bit 8bit retro arcade pixel console platformer bleep video game classic cheerful',
    about: 'square-wave melody, fast arpeggios and noise drums like an old game console',
    bpm: [118, 140, 164],
    scales: ['major', 'minor'],
    flavours: ['bouncy', 'daring'],
    prog: [['I V vi IV', 'I IV V IV', 'I vi IV V', 'I iii IV V', 'I IV I V'], ['i bVII bVI bVII', 'i bVI bIII bVII', 'i iv bVII bIII', 'i bVI iv V']],
    kit: 'chip',
    drums: ['k:x...x...x...x...|s:....x.......x...|h:x.x.x.x.x.x.x.x.', 'k:x.....x.x.......|s:....x.......x..x|h:x.xxx.x.x.xxx.x.', 'k:x..x..x.x..x..x.|s:....x.......x...|h:..x...x...x...x.'],
    drumVol: 0.8,
    bass: { p: 'triBass', pat: ['1.1.8.1.1.1.8.1.', '1..1..1.1..1..5.', '1.8.5.8.1.8.5.8.'], v: 0.8, oct: 12, gate: 0.7 },
    comp: { p: 'chipChord', pat: ['abcAabcAabcAabcA', 'acbcacbcacbcacbc', 'a.c.b.c.a.c.b.c.'], v: 0.34, gate: 0.9 },
    lead: { p: 'squareLead', feel: 'pop', v: 0.62, del: 0.18, gate: 0.85 },
    echo: [3, 0.3],
    master: { crush: [9, 1] },
    words: ['Pixel Bouncy Turbo Tiny Blocky Coin Super Mega Lucky Zippy Neon Jumpy', 'Quest Hop Dash Run Castle Kingdom Level Hero Sprint Parade Garden Circuit'],
  },
  disco: {
    name: 'Disco',
    tags: 'disco dance groovy funky seventies 70s glitter party mirror ball boogie strings',
    about: 'four-on-the-floor kick, off-beat open hats, octave bass and string stabs',
    bpm: [108, 120, 128],
    scales: ['major', 'dorian'],
    flavours: ['glittery', 'smooth'],
    prog: [['Imaj7 vi7 ii7 V7', 'IVmaj7 V iii7 vi7', 'Imaj7 IVmaj7 ii7 V7'], ['i7 iv7 bVII bIIImaj7', 'i7 bVII bVImaj7 V7', 'i7 IV7 i7 IV7']],
    kit: 'electro',
    drums: ['k:x...x...x...x...|s:....x.......x...|h:x...x...x...x...|o:..x...x...x...x.', 'k:x...x...x...x...|c:....x.......x...|h:x.xxx.xxx.xxx.xx|o:..x...x...x...x.'],
    bass: { p: 'fmBass', pat: ['1.8.1.8.1.8.1.8.', '1.8.1.8.1.8.5.8a', '1..8.1.8..8.1.8.'], v: 0.8, gate: 0.6 },
    comp: { p: 'strings', pat: ['x-----------x---', 'x---------x-x---'], v: 0.3, rev: 0.3 },
    arp: { p: 'stab', pat: ['..x..x....x..x..', '....x..x....x..x', '..x...x...x..x.x'], v: 0.36, rev: 0.2 },
    lead: { p: 'brass', feel: 'sync', v: 0.5, rev: 0.25, del: 0.1 },
    room: [0.45, 0.4],
    echo: [3, 0.25],
    pump: 0.2,
    words: ['Glitter Velvet Mirror Midnight Golden Funky Starlight Shiny Disco Groovy', 'Fever Boogie Steps Nights Shuffle Lights Ball Strut Floor Shimmy'],
  },
  synthwave: {
    name: 'Synthwave',
    tags: 'synthwave retrowave eighties 80s neon outrun synth retro future night drive cyber vapor',
    about: 'pulsing saw bass, wide pads, gated drums and an echoing synth lead',
    bpm: [84, 100, 118],
    scales: ['major', 'minor'],
    flavours: ['sunset', 'midnight'],
    prog: [['I vi IV V', 'IV I V vi', 'I V vi IV'], ['i bVI bIII bVII', 'i bVII bVI bVII', 'i iv bVI bVII', 'bVI bVII i i']],
    kit: 'electro',
    drums: ['k:x.......x.......|s:....x.......x...|h:x.x.x.x.x.x.x.x.', 'k:x.....x.x.......|s:....x.......x...|h:x.x.x.x.x.x.x.xx|o:..............x.'],
    bass: { p: 'sawBass', pat: ['1.1.1.1.1.1.1.1.', '1.1.1.1.1.1.8.1.', '1.1.8.1.1.1.8.1.'], v: 0.7, gate: 0.75 },
    comp: { p: 'pad', pat: ['x---------------'], v: 0.3, rev: 0.4, fx: { cho: 0.5 } },
    arp: { p: 'synthPluck', pat: ['abcbabcbabcbabcb', 'a.c.b.A.c.b.a.c.', 'abcAcbabcAcbabcA'], v: 0.3, del: 0.35, rev: 0.2 },
    lead: { p: 'sawLead', feel: 'slow', v: 0.5, del: 0.3, rev: 0.3 },
    room: [0.6, 0.35],
    echo: [3, 0.42],
    pump: 0.3,
    words: ['Neon Chrome Midnight Laser Sunset Turbo Electric Violet Crystal Retro', 'Drive Horizon Highway Skyline Grid Runner Dreams Coast Arcade Pulse'],
  },
  funk: {
    name: 'Funk',
    tags: 'funk funky groove groovy slap bass wah cool strut soul brass',
    about: 'syncopated bass, scratchy off-beat chords, ghost-note drums and horn stabs',
    bpm: [92, 104, 116],
    swing: 0.1,
    scales: ['mixolydian', 'dorian'],
    flavours: ['strutting', 'gritty'],
    prog: [['I7 I7 IV7 I7', 'I7 IV7 I7 V7', 'I7 bVII IV7 I7'], ['i7 i7 iv7 i7', 'i7 IV7 i7 IV7', 'i7 bVII i7 bIII']],
    kit: 'rock',
    drums: ['k:x..x..x...x.....|s:....x..o.o..x..o|h:x.x.x.x.x.x.x.x.', 'k:x.....x..x.x....|s:....x..o....x.o.|h:x.xxx.x.x.xxx.x.|o:..............x.'],
    bass: { p: 'fmBass', pat: ['1..1..8.1.a.1.8.', '1.....1.8..1.7.a', '1..8.1...1.8..5a'], v: 0.8, gate: 0.55 },
    comp: { p: 'stab', pat: ['..x..x.x..x..x.x', '.x..x..x.x..x...', '..x.x..x..x.x..x'], v: 0.32, rev: 0.15, fx: { hp: 300 } },
    arp: { p: 'organ', pat: ['x---------------'], v: 0.14, rev: 0.2 },
    lead: { p: 'brass', feel: 'sync', v: 0.5, rev: 0.2, gate: 0.7 },
    room: [0.35, 0.5],
    words: ['Funky Slick Groovy Saucy Wobbly Cool Sticky Rubber Sassy Jumpin', 'Strut Shuffle Chicken Bounce Groove Sneakers Pocket Wiggle Stomp Parade'],
  },
  rock: {
    name: 'Rock',
    tags: 'rock guitar band drums power electric loud energetic garage punk anthem',
    about: 'driving drums, eighth-note bass, crunchy power chords and a guitar-like lead',
    bpm: [112, 132, 152],
    scales: ['mixolydian', 'minor'],
    flavours: ['anthem', 'gritty'],
    prog: [['I IV V IV', 'I bVII IV I', 'I IV vi V', 'I V IV IV'], ['i bVII bVI bVII', 'i bIII bVII IV', 'i bVI bVII i']],
    kit: 'rock',
    drums: ['k:x.....x.x.......|s:....x.......x...|h:x.x.x.x.x.x.x.x.', 'k:x...x.....x.x...|s:....x.......x...|h:x.x.x.x.x.x.x.x.', 'k:x..x..x.x..x....|s:....x.......x..x|r:x.x.x.x.x.x.x.x.'],
    bass: { p: 'pluckBass', pat: ['1.1.1.1.1.1.1.5.', '1.1.1.1.1.1.1.1.', '1.1.5.1.1.1.5.a.'], v: 0.8, gate: 0.85 },
    comp: { p: 'powerGuitar', pat: ['x.x.x.x.x.x.x.x.', 'x-----x---x-x---', 'x---x.x.x---x.x.'], v: 0.34, voicing: 'power', gate: 0.8, rev: 0.12 },
    lead: { p: 'sawLead', feel: 'pop', v: 0.5, rev: 0.2, del: 0.12, fx: { drv: 0.45, lp: 4200 } },
    room: [0.4, 0.45],
    echo: [3, 0.25],
    words: ['Loud Electric Wild Rusty Thunder Rebel Roaring Blazing Rowdy Fuzzy', 'Riff Garage Highway Anthem Stampede Lightning Road Engine Storm Jam'],
  },
  lullaby: {
    name: 'Lullaby',
    tags: 'lullaby sleep bedtime baby gentle soft cradle music box dream night quiet tender nursery',
    about: 'a slow music-box waltz with a soft bass and a simple, tender tune',
    bpm: [66, 76, 88],
    beats: 3,
    steps: 12,
    scales: ['major', 'minor'],
    flavours: ['sweet', 'wistful'],
    prog: [['I IV I V', 'I vi IV V', 'I V vi IV', 'I IV V I'], ['i iv i V', 'i bVI bIII bVII', 'i iv bVII bIII']],
    kit: 'soft',
    drums: ['p:x...........', 'p:x...........|h:....o...o...'],
    drumVol: 0.35,
    bass: { p: 'subBass', pat: ['1-----------', '1-------5---'], v: 0.5, gate: 0.95 },
    comp: { p: 'harp', pat: ['a...b...c...', 'a.b.c.b.c.b.', 'a...c...b...'], v: 0.4, rev: 0.35 },
    lead: { p: 'musicBox', feel: 'waltz', v: 0.62, rev: 0.4, oct: 12 },
    room: [0.55, 0.3],
    words: ['Sleepy Soft Starry Gentle Dreamy Cozy Little Quiet Velvet Moonlit', 'Lullaby Cradle Blanket Moon Dream Nightlight Cloud Pillow Feather Whisper'],
  },
  spooky: {
    name: 'Spooky',
    tags: 'spooky scary haunted ghost halloween creepy eerie horror monster graveyard witch skeleton dark mysterious tense',
    about: 'a wavering theremin over haunted organ chords, plucked low notes and rattling bones',
    bpm: [70, 84, 100],
    scales: ['harmonic', 'harmonic'],
    flavours: ['mischievous', 'creepy'],
    prog: [['i V i V', 'i iv V i', 'i bVI V i'], ['i bvi i bvi', 'i bII i V', 'i iv bVI V', 'i bVI idim V']],
    kit: 'soft',
    drums: ['k:x.........x.....|w:....x.......x.x.|j:..o...o...o...o.', 'k:x.......x.......|t:......x.......xx|u:....x.......x...|j:..o.o.....o.o...'],
    drumVol: 0.6,
    bass: { p: 'bassoon', pat: ['1.......5.......', '1...5...1...5...', '1.....1.5.......'], v: 0.6, gate: 0.5 },
    comp: { p: 'organ', pat: ['x---------------'], v: 0.2, rev: 0.5, fx: { cho: 0.4 } },
    arp: { p: 'xylophone', pat: ['..a...c...b...c.', 'a..c..b..a..c...', '....a.c.....b.c.'], v: 0.3, rev: 0.3, oct: 12 },
    lead: { p: 'theremin', feel: 'slow', v: 0.5, rev: 0.5, chrom: true },
    room: [0.8, 0.3],
    words: ['Creeping Haunted Shadowy Foggy Crooked Midnight Cobweb Moaning Flickering Hollow', 'Fog Manor Graveyard Shadows Cellar Bones Whispers Attic Moon Footsteps'],
  },
  adventure: {
    name: 'Adventure',
    tags: 'adventure orchestral orchestra heroic epic quest hero journey overworld fantasy brave explore exploring cinematic exciting',
    about: 'a brave trumpet theme over galloping strings, timpani and a marching snare',
    bpm: [96, 112, 132],
    scales: ['major', 'minor'],
    flavours: ['heroic', 'perilous'],
    prog: [['I V vi IV', 'I bVII IV I', 'I iii IV V', 'vi IV I V', 'I IV V V'], ['i bVI bVII i', 'i bVII bVI V', 'i iv bVII bIII']],
    kit: 'orch',
    drums: ['k:x.....x.x.......|s:x..xx.x.x..xx.xx', 'k:x...x...x.....x.|s:..x...x...x.xxxx|u:......x.........'],
    drumVol: 0.7,
    bass: { p: 'tuba', pat: ['1...1...5...1...', '1.1.1.1.1.1.1.1.', '1...5...1...5.a.'], v: 0.7, gate: 0.8 },
    comp: { p: 'strings', pat: ['x---------------', 'x-------x-------'], v: 0.32, rev: 0.4, voicing: 'open' },
    arp: { p: 'pizz', pat: ['x.xxx.xxx.xxx.xx', 'x..xx..xx..xx.x.', 'a.cba.cba.cba.cb'], v: 0.3, rev: 0.25 },
    lead: { p: 'trumpet', feel: 'march', v: 0.55, rev: 0.4 },
    room: [0.7, 0.35],
    words: ['Brave Golden Mighty Daring Noble Soaring Gallant Shining Bold Grand', 'Quest Journey Banner Kingdom Summit Voyage Horizon Legend Expedition Trail'],
  },
  jazz: {
    name: 'Jazz',
    tags: 'jazz jazzy swing lounge cafe cool smooth walking bass piano club detective noir',
    about: 'swinging ride cymbal, walking bass, piano chords and a laid-back clarinet',
    bpm: [96, 126, 160],
    steps: 12,
    pulse: 3,
    scales: ['major', 'dorian'],
    flavours: ['breezy', 'smoky'],
    prog: [['Imaj7 vi7 ii7 V7', 'ii7 V7 Imaj7 VI7', 'Imaj7 IV7 iii7 VI7'], ['i7 iv7 bVII7 bIIImaj7', 'i7 bVImaj7 iim7b5 V7', 'i7 iv7 iim7b5 V7']],
    kit: 'jazz',
    drums: ['r:x..x.xx..x.x|h:...x.....x..|k:x.....o.....', 'r:x..x.xx..x.x|h:...x.....x..|k:x.....o.....|s:.....o.....o'],
    drumVol: 0.7,
    bass: { p: 'pluckBass', pat: ['1..3..5..a..', '1..5..3..a..', '8..7..5..a..', '1..3..5..6..'], v: 0.8, gate: 0.9 },
    comp: { p: 'epiano', pat: ['x....x......', '..x.....x...', 'x.......x...', '.....x.....x'], v: 0.34, rev: 0.25, voicing: 'shell', gate: 0.6 },
    lead: { p: 'clarinet', feel: 'swing', v: 0.5, rev: 0.3, gate: 0.85 },
    room: [0.4, 0.5],
    words: ['Smoky Velvet Breezy Midnight Cool Lazy Blue Rainy Swingin Mellow', 'Cafe Stroll Lounge Corner Alley Boulevard Evening Hat Umbrella Shuffle'],
  },
  latin: {
    name: 'Latin',
    tags: 'latin salsa samba fiesta carnival mambo cha-cha tropical conga dance spicy maracas mexico brazil',
    about: 'clave, congas and cowbell under a syncopated piano and a bright trumpet',
    bpm: [96, 112, 128],
    scales: ['major', 'harmonic'],
    flavours: ['fiesta', 'fiery'],
    prog: [['I IV V IV', 'I IV V V', 'I V V I', 'ii7 V7 I I'], ['i iv V7 i', 'i bVII bVI V7', 'i iv i V7']],
    kit: 'latin',
    drums: ['k:x.....x.....x...|w:x..x..x...x.x...|q:....x.......x...|p:......xx......xx|h:x.xxx.xxx.xxx.xx|b:x...x...x...x...', 'k:x.....x.....x...|w:..x.x...x..x..x.|q:....x.......x...|p:......xx......xx|h:x.xxx.xxx.xxx.xx|b:x...x...x.x.x...'],
    drumVol: 0.8,
    bass: { p: 'pluckBass', pat: ['1.....5.....8...', '1.....5...5.8...', '1..1..5.....8.a.'], v: 0.8, gate: 0.7 },
    comp: { p: 'piano', pat: ['a..c.b.ca..c.b.c', 'x..x..x...x.x...', 'a.c.b.c.A.c.b.c.'], v: 0.36, rev: 0.2, gate: 0.7 },
    lead: { p: 'trumpet', feel: 'sync', v: 0.5, rev: 0.25, gate: 0.8 },
    room: [0.4, 0.45],
    words: ['Spicy Sunny Fiery Dancing Golden Tropical Lively Hot Festive Swaying', 'Fiesta Carnival Salsa Plaza Maracas Mango Parade Sunset Rumba Mercado'],
  },
  space: {
    name: 'Space',
    tags: 'space ambient galaxy stars cosmic floating planet universe calm dreamy sci-fi orbit nebula zero gravity atmosphere',
    about: 'slow glassy pads, a deep bass, twinkling bells and a far-away voice, all in a big echoing room',
    bpm: [60, 72, 84],
    scales: ['lydian', 'dorian'],
    flavours: ['serene', 'lonely'],
    prog: [['I II I II', 'Imaj7 IVmaj7 Imaj7 IVmaj7', 'I bVII IV I'], ['i bVI i bVI', 'i bVII bVI bVI', 'i iv i bVI']],
    kit: 'soft',
    drums: ['k:x...............|h:........o.......', 'k:x.........o.....'],
    drumVol: 0.3,
    bass: { p: 'subBass', pat: ['1---------------', '1-------1-------'], v: 0.55, gate: 1 },
    comp: { p: 'glassPad', pat: ['x---------------'], v: 0.34, rev: 0.6, fx: { cho: 0.6 }, voicing: 'open' },
    arp: { p: 'glock', pat: ['a.....c...b.....', '..a...b.....c...', 'a...c.......b...'], v: 0.3, del: 0.5, rev: 0.6, oct: 24 },
    lead: { p: 'theremin', feel: 'float', v: 0.36, del: 0.4, rev: 0.7 },
    room: [0.9, 0.25],
    echo: [6, 0.5],
    words: ['Drifting Distant Silent Starlit Cosmic Floating Frozen Endless Lunar Deep', 'Orbit Nebula Starfield Comet Galaxy Void Aurora Satellite Horizon Dust'],
  },
  boss: {
    name: 'Boss Battle',
    tags: 'boss battle fight combat danger intense tense enemy villain final showdown action dramatic urgent metal',
    about: 'pounding double kicks, a galloping growl bass, heavy chords and a fierce fast lead',
    bpm: [140, 160, 180],
    scales: ['harmonic', 'phrygian'],
    flavours: ['heroic', 'menacing'],
    prog: [['i bVII bVI V', 'i IV i bVII', 'i bVI bVII V'], ['i bVI bVII i', 'i bII i bVII', 'i bVI V V', 'i iv bVI V']],
    kit: 'rock',
    drums: ['k:x.xx..x.x.xx..x.|s:....x.......x...|h:x.x.x.x.x.x.x.x.', 'k:x.x.x.x.x.x.x.xx|s:....x.......x.x.|r:x...x...x...x...', 'k:xx..x.xx..x.xx..|s:....x.......x..x|h:x.x.x.x.x.x.x.x.'],
    bass: { p: 'growlBass', pat: ['1.111.111.111.11', '1.1.1.1.1.1.1.1.', '11.111.111.11.1a'], v: 0.62, gate: 0.6 },
    comp: { p: 'powerGuitar', pat: ['x.xxx.xxx.xxx.xx', 'x-----x-x-----x-', 'x.x.x.x.x.x.x.x.'], v: 0.3, voicing: 'power', gate: 0.7, rev: 0.1 },
    arp: { p: 'strings', pat: ['x---------------'], v: 0.2, rev: 0.3 },
    lead: { p: 'sawLead', feel: 'fast', v: 0.48, rev: 0.2, del: 0.1, fx: { drv: 0.4, lp: 5000 } },
    room: [0.45, 0.4],
    echo: [3, 0.25],
    words: ['Furious Molten Iron Final Savage Raging Crimson Shattered Burning Relentless', 'Showdown Fury Titan Duel Onslaught Rampage Fortress Clash Dragon Storm'],
  },
  circus: {
    name: 'Circus',
    tags: 'circus carnival clown funfair fairground silly goofy calliope organ oompah merry-go-round carousel juggle comedy',
    about: 'an oom-pah tuba and cymbal under a tootling fairground organ',
    bpm: [108, 124, 144],
    scales: ['major', 'harmonic'],
    flavours: ['jolly', 'crooked'],
    prog: [['I V7 V7 I', 'I IV V7 I', 'I ii V7 I', 'I V7 I V7'], ['i V7 V7 i', 'i iv V7 i']],
    kit: 'toy',
    drums: ['k:x.......x.......|y:....x.......x...|s:....x..x....x.xx', 'k:x.......x.......|y:....x.......x...|w:..x...x...x...x.'],
    drumVol: 0.75,
    bass: { p: 'tuba', pat: ['1...5...1...5...', '1...5...1...5.a.', '1...5...3...5...'], v: 0.75, gate: 0.5 },
    comp: { p: 'accordion', pat: ['....x.......x...', '..x.x...x.x.x...', '....x...x...x...'], v: 0.3, gate: 0.5, rev: 0.15 },
    lead: { p: 'calliope', feel: 'fast', v: 0.5, rev: 0.2, chrom: true, gate: 0.8 },
    room: [0.35, 0.5],
    words: ['Jolly Wobbly Giddy Tumbling Striped Silly Topsy Bouncing Dizzy Grand', 'Parade Juggler Bigtop Carousel Clown Trapeze Popcorn Unicycle Ringmaster Balloon'],
  },
  underwater: {
    name: 'Underwater',
    tags: 'underwater water ocean sea swim fish bubbles aquarium mermaid deep diving reef submarine lagoon calm',
    about: 'a soft, wavering electric piano and rolling harp under a slow flute, as if heard through water',
    bpm: [72, 86, 100],
    scales: ['lydian', 'dorian'],
    flavours: ['shimmering', 'deep'],
    prog: [['Imaj7 IVmaj7 Imaj7 IVmaj7', 'Imaj7 iii7 IVmaj7 V', 'I iii IV ii'], ['i7 bVImaj7 i7 bVImaj7', 'i7 iv7 bVImaj7 bVII', 'i bIII bVII IV']],
    kit: 'soft',
    drums: ['k:x.......o.......|h:..o...o...o...o.', 'k:x.........o.....|h:....o.......o...|p:........x.......'],
    drumVol: 0.4,
    bass: { p: 'subBass', pat: ['1-----1---5-----', '1-------5-------', '1-----5---8-----'], v: 0.7, gate: 0.9 },
    comp: { p: 'epiano', pat: ['x-------x-------', 'x-----------x---'], v: 0.3, rev: 0.4, fx: { cho: 0.8 } },
    arp: { p: 'harp', pat: ['abcdcbabcdcbabcd', 'a.b.c.d.c.b.a.b.', 'a.c.b.d.A.d.b.c.'], v: 0.22, rev: 0.4, fx: { lp: 2400 } },
    lead: { p: 'flute', feel: 'slow', v: 0.42, del: 0.3, rev: 0.5 },
    room: [0.7, 0.5],
    echo: [6, 0.4],
    master: { lp: 6000, cho: 0.35 },
    bed: (sec) => [{ w: 'sine', f: 520, f2: 1250, d: 0.045, c: 2, env: [0.004, 0.03, 0.4, 0.02], rep: [Math.round(sec * 2.2), sec, 9, 0.7], v: 0.09 }],
    words: ['Drifting Coral Deep Bubbly Sunken Shimmering Gentle Blue Swaying Pearly', 'Lagoon Reef Current Tide Grotto Kelp Depths Bubbles Shoal Cove'],
  },
  western: {
    name: 'Western',
    tags: 'western cowboy wild west desert horse saloon sheriff ranch country banjo harmonica frontier outlaw rodeo',
    about: 'clip-clop woodblocks, a boom-chick guitar, banjo and a lonesome whistle or harmonica',
    bpm: [92, 108, 126],
    scales: ['major', 'minor'],
    flavours: ['trail', 'showdown'],
    prog: [['I IV I V', 'I I IV V', 'I V IV I'], ['i bVII bVI V', 'i iv i V', 'i bIII bVII i']],
    kit: 'soft',
    drums: ['t:x...x...x...x...|u:..x...x...x...x.|k:x.......x.......|s:....o.......o...', 'u:x.x...x.x.x...x.|t:....x.......x...|k:x.......x.......|h:x.xxx.xxx.xxx.xx'],
    drumVol: 0.6,
    bass: { p: 'pluckBass', pat: ['1...5...1...5...', '1...5...1...5.a.'], v: 0.75, gate: 0.6 },
    comp: { p: 'guitar', pat: ['....x.x.....x.x.', '..x.x.x...x.x.x.', '....x..x....x..x'], v: 0.34, rev: 0.15, gate: 0.6 },
    arp: { p: 'banjo', pat: ['a.c.b.c.a.c.b.c.', 'acbcacbcacbcacbc', 'a..cb.c.a..cb.c.'], v: 0.26, rev: 0.15 },
    lead: { p: 'harmonica', feel: 'pop', v: 0.5, rev: 0.3 },
    room: [0.45, 0.45],
    words: ['Dusty Lonesome Rusty Golden Rambling Sunbaked Rowdy Tumbling High Wild', 'Trail Canyon Saloon Prairie Stagecoach Sunset Rodeo Gulch Campfire Mesa'],
  },
  techno: {
    name: 'Techno',
    tags: 'techno electronic house rave club trance edm dance beat robot machine cyber factory future digital',
    about: 'a hard four-on-the-floor kick, off-beat acid bass, chord stabs and a rolling arpeggio',
    bpm: [124, 132, 142],
    scales: ['major', 'phrygian'],
    flavours: ['uplifting', 'dark'],
    prog: [['vi IV I V', 'I I vi vi', 'IV V vi vi'], ['i i bVII i', 'i bVI i bVII', 'i i bII i', 'i i i i']],
    kit: 'electro',
    drums: ['k:x...x...x...x...|o:..x...x...x...x.|c:....x.......x...|h:xxoxxxoxxxoxxxox', 'k:x...x...x...x...|o:..x...x...x...x.|s:....x.......x...|h:x.xxx.xxx.xxx.xx|a:..x...x...x...x.'],
    bass: { p: 'acidBass', pat: ['..1...1...1...1.', '..11..11..11..11', '1.11.11.1.11.11.', '..1..1.1..1..1.8'], v: 0.66, gate: 0.6 },
    comp: { p: 'stab', pat: ['...x..x....x..x.', '..x..x..x..x..x.', '......x.......x.'], v: 0.34, rev: 0.3, del: 0.25 },
    arp: { p: 'synthPluck', pat: ['a.cabcacb.cabcac', 'abcabcabcabcabca', 'a.a.c.a.b.a.c.a.'], v: 0.26, del: 0.3, rev: 0.15 },
    lead: { p: 'pulseLead', feel: 'sync', v: 0.36, del: 0.3, rev: 0.2 },
    room: [0.5, 0.4],
    echo: [3, 0.4],
    pump: 0.5,
    words: ['Hyper Chrome Digital Strobe Pulsing Binary Voltage Laser Turbo Quantum', 'Circuit Reactor Factory Signal Engine Grid Protocol Machine Overdrive Core'],
  },
  island: {
    name: 'Island',
    tags: 'island tropical beach reggae calypso summer holiday palm sunny surf steel drum caribbean hawaii vacation relaxed',
    about: 'a laid-back off-beat skank, a bouncing bass and a bright steel drum',
    bpm: [84, 98, 112],
    swing: 0.08,
    scales: ['major', 'dorian'],
    flavours: ['sunny', 'breezy'],
    prog: [['I IV V IV', 'I V vi IV', 'I IV I V'], ['i bVII i bVII', 'i bVII bVI bVII', 'i IV i IV']],
    kit: 'latin',
    drums: ['k:........x.......|s:........x.......|h:x.xxx.xxx.xxx.xx|p:......x.......x.|q:....x.......x...', 'k:x.......x.......|s:....x.......x...|h:x.x.x.x.x.x.x.x.|p:..x...xx..x...xx'],
    drumVol: 0.7,
    bass: { p: 'pluckBass', pat: ['1.....1.5...3.5.', '1..1..5.....8.5.', '1.....5.8.....5.'], v: 0.85, gate: 0.7 },
    comp: { p: 'organ', pat: ['..x...x...x...x.', '..x...x...x..xx.'], v: 0.26, gate: 0.4, rev: 0.15 },
    arp: { p: 'nylon', pat: ['..x...x...x...x.'], v: 0.26, gate: 0.4 },
    lead: { p: 'steelDrum', feel: 'sync', v: 0.56, rev: 0.3 },
    room: [0.4, 0.45],
    words: ['Sunny Breezy Coconut Lazy Barefoot Golden Swaying Mango Easy Salty', 'Beach Hammock Lagoon Sunrise Boardwalk Palms Tide Shore Holiday Cove'],
  },
  lofi: {
    name: 'Lo-fi',
    tags: 'lofi lo-fi chill hip hop beats relax study mellow cozy rainy calm laid-back vinyl coffee',
    about: 'a dusty boom-bap beat, a deep bass, mellow electric piano chords and vinyl crackle',
    bpm: [70, 80, 90],
    swing: 0.14,
    scales: ['major', 'dorian'],
    flavours: ['cozy', 'rainy'],
    prog: [['Imaj7 vi7 ii7 V7', 'IVmaj7 iii7 ii7 Imaj7', 'Imaj7 iii7 vi7 IVmaj7'], ['i7 bVImaj7 bIIImaj7 bVII7', 'iv7 bVII7 i7 i7', 'i7 iv7 bVImaj7 V7']],
    kit: 'lofi',
    drums: ['k:x......x..x.....|s:....x.......x...|h:x.x.x.x.x.x.x.x.', 'k:x.....x...x..x..|s:....x.......x...|h:x.x.x.xxx.x.x.x.'],
    drumVol: 0.8,
    bass: { p: 'subBass', pat: ['1......1..1.....', '1.....1...5.....', '1......1..3..5..'], v: 0.75, gate: 0.8 },
    comp: { p: 'epiano', pat: ['x-----x---------', 'x---------x-----', '..x-----..x-----'], v: 0.36, rev: 0.3, fx: { lp: 2600, cho: 0.5 } },
    lead: { p: 'kalimba', feel: 'slow', v: 0.42, rev: 0.35, del: 0.2 },
    room: [0.45, 0.6],
    echo: [3, 0.3],
    master: { lp: 7000 },
    bed: (sec) => [
      { w: 'noise', d: 0.0006, env: [0, 0.001, 0, 0.003], ft: 'hp', fc: 2500, rep: [Math.round(sec * 9), sec, 0, 0.8], v: 0.1 },
      { w: 'pink', d: sec, env: [0.01, 0.1, 1, 0.01], ft: 'hp', fc: 3000, v: 0.012 },
    ],
    words: ['Cozy Rainy Sleepy Dusty Mellow Late Warm Hazy Quiet Faded', 'Afternoon Window Notebook Coffee Sweater Bedroom Tape Balcony Daydream Sunday'],
  },
  medieval: {
    name: 'Medieval',
    tags: 'medieval castle knight village tavern folk fantasy rpg town lute celtic renaissance kingdom minstrel fair elf',
    about: 'a lilting jig on a wooden flute over a lute, a drone and a hand drum',
    bpm: [96, 112, 130],
    beats: 3,
    steps: 12,
    pulse: 6,
    scales: ['mixolydian', 'dorian'],
    flavours: ['merry', 'misty'],
    prog: [['I bVII I bVII', 'I IV bVII I', 'I V IV I'], ['i bVII i bVII', 'i IV bVII i', 'i bIII bVII i']],
    kit: 'latin',
    drums: ['u:x.....x..x..|a:..x.x...x.x.', 'u:x.....x.....|t:...x.....x.x|a:x.x.x.x.x.x.'],
    drumVol: 0.6,
    bass: { p: 'bassoon', pat: ['1-----5-----', '1-----------'], v: 0.5, gate: 0.95 },
    comp: { p: 'nylon', pat: ['a.c.b.a.c.b.', 'x...b.x...c.', 'a.b.c.A.c.b.'], v: 0.4, rev: 0.25 },
    lead: { p: 'ocarina', feel: 'jig', v: 0.55, rev: 0.3 },
    room: [0.5, 0.45],
    words: ['Merry Mossy Wandering Royal Rustic Jolly Ancient Humble Misty Bold', 'Tavern Village Minstrel Meadow Castle Market Banquet Crossroads Hearth Fair'],
  },
  desert: {
    name: 'Desert',
    tags: 'desert arabian egypt pyramid sand camel snake charmer oasis genie bazaar middle east sahara mummy sultan caravan',
    about: 'a reedy snake-charmer melody over hand drums, a droning bass and a plucked oud',
    bpm: [88, 104, 120],
    scales: ['hijaz', 'harmonic'],
    flavours: ['bazaar', 'mirage'],
    prog: [['I bII I bvii', 'I iv bII I', 'I bII I bII'], ['i iv V i', 'i bVI V V', 'i bII i V']],
    kit: 'latin',
    drums: ['p:x.......x.......|q:..x...x.....x...|a:..xx..xx..xx..xx', 'p:x.....x.x.......|q:..x.x.....x.x.x.|a:x.x.x.x.x.x.x.x.'],
    drumVol: 0.75,
    bass: { p: 'pluckBass', pat: ['1-------1---5---', '1.....1.1...5...'], v: 0.7, gate: 0.9 },
    comp: { p: 'nylon', pat: ['a...c.b.a...c.b.', 'a.aac.b.a.aac.b.', 'x.....x.x.....x.'], v: 0.34, rev: 0.25 },
    lead: { p: 'oboe', feel: 'fast', v: 0.48, rev: 0.35 },
    room: [0.5, 0.4],
    words: ['Golden Shifting Scorching Hidden Ancient Silken Wandering Jeweled Moonlit Spiced', 'Caravan Oasis Dunes Bazaar Mirage Pyramid Lamp Scarab Sandstorm Palace'],
  },
  ninja: {
    name: 'Ninja',
    tags: 'ninja samurai japan japanese china chinese asia asian temple dojo kung fu dragon zen bamboo koto taiko martial arts',
    about: 'a plucked koto and a breathy flute in a five-note scale over big taiko drums',
    bpm: [88, 104, 124],
    scales: ['pentatonic', 'insen'],
    flavours: ['bamboo', 'shadow'],
    prog: [['I5 IV5 I5 V5', 'I5 vi5 IV5 V5', 'I5 I5 IV5 V5'], ['i5 bVI5 i5 v5', 'i5 bVI5 bVI5 v5', 'i5 i5 bVI5 v5']],
    kit: 'taiko',
    drums: ['k:x.....x...x.x...|t:....x.......x..x|w:..x...x...x...x.', 'k:x..x..x.x..x..x.|u:....x.......x...|s:..x...x...x...xx'],
    drumVol: 0.8,
    bass: { p: 'pluckBass', pat: ['1.......5.......', '1.....1.5.....5.'], v: 0.65, gate: 0.9 },
    comp: { p: 'koto', pat: ['a.c.b.c.a.c.b.c.', 'a..b..c.a..b..c.', 'a.b.A.b.a.b.A.b.'], v: 0.42, rev: 0.3, voicing: 'power' },
    lead: { p: 'flute', feel: 'pop', v: 0.5, rev: 0.4 },
    room: [0.55, 0.4],
    words: ['Silent Hidden Swift Crimson Jade Rising Patient Thunder Lotus Iron', 'Blade Temple Shadow Dragon Bamboo Mountain Lantern Crane Dojo Moon'],
  },
  march: {
    name: 'March',
    tags: 'march parade army soldier toy band military royal king drum brass patriotic procession ceremony',
    about: 'a snare-drum cadence and oom-pah brass under a bright piping tune',
    bpm: [100, 116, 132],
    scales: ['major', 'minor'],
    flavours: ['proud', 'stern'],
    prog: [['I IV V I', 'I V I V', 'I vi ii V'], ['i iv V i', 'i bVI V i']],
    kit: 'toy',
    drums: ['k:x...x...x...x...|s:x..xx..xx.xxx.xx', 'k:x.......x.......|s:x.xxx.xxx.x.xxxx|y:x...............'],
    drumVol: 0.75,
    bass: { p: 'tuba', pat: ['1...5...1...5...', '1...5...1...3.5.'], v: 0.75, gate: 0.55 },
    comp: { p: 'brass', pat: ['..x...x...x...x.', '....x.x.....x.x.'], v: 0.26, gate: 0.5, rev: 0.2 },
    lead: { p: 'whistle', feel: 'march', v: 0.5, rev: 0.25, oct: 12 },
    room: [0.45, 0.45],
    words: ['Proud Royal Tin Marching Brassy Gleaming Grand Stout Polished Loyal', 'Parade Regiment Drummers Banner Guard Procession Boots Brigade Square Salute'],
  },
  puzzle: {
    name: 'Puzzle',
    tags: 'puzzle thinking brain quiz menu calm casual relax match cozy shop title light gentle',
    about: 'a calm marimba pattern with a plucked bass and a light, curious tune',
    bpm: [84, 96, 110],
    scales: ['major', 'dorian'],
    flavours: ['curious', 'pondering'],
    prog: [['Imaj7 IVmaj7 Imaj7 IVmaj7', 'I vi IV V', 'Imaj7 iii7 IVmaj7 V'], ['i7 iv7 i7 iv7', 'i bVII bVI bVII', 'i7 IV7 i7 IV7']],
    kit: 'soft',
    drums: ['h:..x...x...x...x.|k:x.........x.....|w:....x.......x...', 'h:x.x.x.x.x.x.x.x.|k:x.......x.......|c:....x.......x...'],
    drumVol: 0.5,
    bass: { p: 'pluckBass', pat: ['1.....1...5.....', '1.....5...1.....', '1...5.....8.5...'], v: 0.7, gate: 0.7 },
    comp: { p: 'marimba', pat: ['a.b.c.b.a.b.c.b.', 'a.c.b.c.a.c.b.c.', 'a..b..c.a..b..c.'], v: 0.42, rev: 0.25 },
    arp: { p: 'warmPad', pat: ['x---------------'], v: 0.2, rev: 0.3 },
    lead: { p: 'kalimba', feel: 'pop', v: 0.5, rev: 0.3, del: 0.15 },
    room: [0.4, 0.5],
    echo: [3, 0.25],
    words: ['Curious Clever Tidy Gentle Bright Puzzled Patient Nimble Cozy Twinkly', 'Tiles Riddle Blocks Thinking Pieces Lanterns Marbles Shapes Numbers Clockwork'],
  },
  sneaky: {
    name: 'Sneaky',
    tags: 'sneaky stealth spy tiptoe thief detective mystery heist burglar creeping secret agent prowl mischief suspense tense',
    about: 'a tiptoeing plucked bass, finger snaps and a sly clarinet full of rests',
    bpm: [84, 100, 116],
    scales: ['blues', 'harmonic'],
    flavours: ['mischievous', 'shadowy'],
    prog: [['i7 i7 IV7 i7', 'i7 IV7 i7 V7'], ['i i iv i', 'i bVI V i', 'i bII i V']],
    kit: 'soft',
    drums: ['c:....x.......x...|h:..o...o...o...o.', 'c:....x.......x...|h:x.o.x.o.x.o.x.o.|k:x.........o.....'],
    drumVol: 0.6,
    bass: { p: 'pizz', pat: ['1.3.5.6.7.6.5.3.', '1...5...7...5...', '1.1.3.3.5.5.6.5.'], v: 0.8, gate: 0.5, oct: 12 },
    comp: { p: 'epiano', pat: ['......x.......x.', '..........x...x.'], v: 0.28, gate: 0.4, rev: 0.25 },
    lead: { p: 'clarinet', feel: 'stac', v: 0.5, rev: 0.3, chrom: true, gate: 0.6 },
    room: [0.45, 0.5],
    words: ['Sneaky Tiptoe Shady Hushed Slinky Crafty Midnight Nimble Masked Quiet', 'Caper Heist Alley Footsteps Prowl Rooftops Disguise Vault Whiskers Getaway'],
  },
  happy: {
    name: 'Happy',
    tags: 'happy sunny cheerful kids fun playful bright ukulele cute joyful title menu upbeat friendly whistle pop',
    about: 'a strummed ukulele, hand claps and a cheerful whistled tune',
    bpm: [104, 120, 138],
    scales: ['major', 'major'],
    flavours: ['sunny', 'bittersweet'],
    prog: [['I V vi IV', 'I IV vi V', 'I vi IV V', 'I IV I V'], ['vi IV I V', 'vi V IV V']],
    kit: 'rock',
    drums: ['k:x.....x.x.......|c:....x.......x...|a:x.x.x.x.x.x.x.x.', 'k:x...x...x...x...|c:....x.......x...|h:x.xxx.xxx.xxx.xx'],
    drumVol: 0.65,
    bass: { p: 'pluckBass', pat: ['1.....1.5.....5.', '1...5...1...5...', '1.....5.8...5...'], v: 0.75, gate: 0.6 },
    comp: { p: 'nylon', pat: ['x...x.x...x.x.x.', 'x..x..x.x..x..x.', '..x.x.x...x.x.x.'], v: 0.34, rev: 0.15, gate: 0.6 },
    arp: { p: 'glock', pat: ['a...c...b...c...', '..a...c...b.....'], v: 0.22, rev: 0.3, oct: 12 },
    lead: { p: 'whistle', feel: 'pop', v: 0.5, rev: 0.25 },
    room: [0.4, 0.45],
    words: ['Sunny Skipping Giggly Bright Cheerful Bubbly Merry Sparkly Breezy Lucky', 'Morning Picnic Meadow Kite Puddles Friends Bicycle Lemonade Garden Holiday'],
  },
  winter: {
    name: 'Winter',
    tags: 'winter snow ice christmas holiday sleigh frost cozy festive santa snowman bells frozen north pole skating',
    about: 'sleigh bells and a soft brush beat under twinkling celesta and warm strings',
    bpm: [84, 100, 120],
    scales: ['major', 'dorian'],
    flavours: ['festive', 'frosty'],
    prog: [['I vi IV V', 'I IV I V', 'I iii IV V'], ['i bVI bIII bVII', 'i iv bVII bIII', 'i bVII bVI bVII']],
    kit: 'soft',
    drums: ['j:x.x.x.x.x.x.x.x.|k:x.......x.......|s:....o.......o...', 'j:x.xxx.xxx.xxx.xx|k:x.......x.......|p:x...............'],
    drumVol: 0.6,
    bass: { p: 'pluckBass', pat: ['1...5...1...5...', '1.......5.......'], v: 0.65, gate: 0.7 },
    comp: { p: 'strings', pat: ['x---------------'], v: 0.26, rev: 0.4 },
    arp: { p: 'musicBox', pat: ['a.b.c.b.A.c.b.c.', 'a...c...b...c...', 'a.c.b.c.a.c.b.c.'], v: 0.32, rev: 0.4, oct: 12 },
    lead: { p: 'glock', feel: 'pop', v: 0.5, rev: 0.4, oct: 12 },
    room: [0.6, 0.35],
    words: ['Snowy Frosty Twinkling Cozy Silver Crisp Glittering Quiet Jolly Northern', 'Sleigh Snowfall Mittens Fireside Icicles Lanterns Skates Cocoa Pines Flurry'],
  },
  pirate: {
    name: 'Pirate',
    tags: 'pirate sea ship sailor shanty ocean treasure captain jig tavern accordion sailing voyage buccaneer',
    about: 'a stomping sea shanty: fiddle tune, squeezebox chords and a thumping drum',
    bpm: [100, 116, 132],
    beats: 3,
    steps: 12,
    pulse: 6,
    scales: ['major', 'dorian'],
    flavours: ['jolly', 'stormy'],
    prog: [['I IV I V', 'I V I IV', 'I IV V I'], ['i bVII i v', 'i bIII bVII i', 'i bVII bVI bVII']],
    kit: 'rock',
    drums: ['k:x.....x.....|c:...x.....x..|a:..x.x...x.x.', 'k:x.....x..x..|s:...x.....x.x|a:x.x.x.x.x.x.'],
    drumVol: 0.7,
    bass: { p: 'tuba', pat: ['1.....5.....', '1.....5...a.'], v: 0.7, gate: 0.6 },
    comp: { p: 'accordion', pat: ['x...x.x...x.', '..x.x...x.x.', 'x-----x-----'], v: 0.3, gate: 0.6, rev: 0.2 },
    lead: { p: 'violin', feel: 'jig', v: 0.5, rev: 0.3 },
    room: [0.45, 0.45],
    words: ['Salty Jolly Stormy Rolling Rusty Briny Bold Weathered Rum Swaying', 'Voyage Shanty Galleon Tide Compass Anchor Harbor Treasure Crew Horizon'],
  },
  racing: {
    name: 'Racing',
    tags: 'racing race car speed fast chase run rush kart turbo action escape drive highway arcade adrenaline exciting',
    about: 'a breakneck beat, a driving bass, punchy chord stabs and a rushing synth lead',
    bpm: [150, 168, 184],
    scales: ['mixolydian', 'minor'],
    flavours: ['turbo', 'pursuit'],
    prog: [['I bVII IV I', 'I V vi IV', 'IV V vi vi'], ['i bVI bVII i', 'i bVII bVI bVII', 'i iv bVI bVII']],
    kit: 'electro',
    drums: ['k:x.....x...x.....|s:....x..o.o..x...|h:x.xxx.xxx.xxx.xx', 'k:x...x...x...x...|s:....x.......x..x|h:x.x.x.x.x.x.x.x.|o:..x...x...x...x.'],
    bass: { p: 'sawBass', pat: ['1.1.1.1.1.1.1.1.', '1..1.1..1..1.1..', '1.1.8.1.1.1.8.1.'], v: 0.7, gate: 0.7 },
    comp: { p: 'stab', pat: ['x..x..x...x..x..', '..x..x.x..x..x.x'], v: 0.34, rev: 0.2 },
    arp: { p: 'synthPluck', pat: ['abcAabcAabcAabcA', 'a.c.b.A.a.c.b.A.'], v: 0.24, del: 0.2 },
    lead: { p: 'sawLead', feel: 'pop', v: 0.48, del: 0.2, rev: 0.2 },
    room: [0.4, 0.4],
    echo: [3, 0.3],
    pump: 0.25,
    words: ['Turbo Blazing Nitro Screaming Rapid Burning Slick Lightning Reckless Supersonic', 'Lap Chase Circuit Drift Overtake Sprint Highway Rally Pursuit Finish'],
  },
  sad: {
    name: 'Sad',
    tags: 'sad emotional lonely tears goodbye melancholy piano ballad ending farewell memory sorrow gentle slow',
    about: 'slow piano arpeggios with soft strings and a lonely violin line',
    bpm: [60, 70, 80],
    scales: ['major', 'minor'],
    flavours: ['hopeful', 'sorrowful'],
    prog: [['I V vi IV', 'vi IV I V', 'I iii IV iv'], ['i bVI bIII bVII', 'i iv bVI V', 'i v bVI iv']],
    kit: 'soft',
    drums: ['p:................'],
    drumVol: 0.2,
    bass: { p: 'subBass', pat: ['1-------5-------', '1---------------'], v: 0.5, gate: 1 },
    comp: { p: 'piano', pat: ['a.b.c.b.a.b.c.b.', 'a.c.b.c.A.c.b.c.', 'a...b...c...b...'], v: 0.44, rev: 0.4 },
    arp: { p: 'strings', pat: ['x---------------'], v: 0.2, rev: 0.5 },
    lead: { p: 'violin', feel: 'slow', v: 0.42, rev: 0.5 },
    room: [0.7, 0.4],
    words: ['Fading Lonely Quiet Last Distant Gentle Rainy Empty Tender Forgotten', 'Goodbye Letter Window Memory Autumn Lantern Station Photograph Evening Road'],
  },
  party: {
    name: 'Party',
    tags: 'party dance pop club celebration edm festival energetic upbeat disco ball birthday win victory fun',
    about: 'a pumping dance beat with bright chord plucks, claps and a catchy synth hook',
    bpm: [118, 126, 134],
    scales: ['major', 'minor'],
    flavours: ['confetti', 'afterglow'],
    prog: [['I V vi IV', 'vi IV I V', 'IV I V vi'], ['i bVI bIII bVII', 'i bVII bVI bVII', 'bVI bVII i i']],
    kit: 'electro',
    drums: ['k:x...x...x...x...|c:....x.......x...|o:..x...x...x...x.|h:x.x.x.x.x.x.x.x.', 'k:x...x...x...x...|s:....x.......x...|o:..x...x...x...x.|a:x.xxx.xxx.xxx.xx'],
    bass: { p: 'sawBass', pat: ['..1...1...1...1.', '1.1.1.1.1.1.1.1.', '1..1..1.1..1..1.'], v: 0.72, gate: 0.6 },
    comp: { p: 'stab', pat: ['x..x..x.x..x..x.', 'x..x..x...x..x..'], v: 0.36, rev: 0.25, del: 0.15 },
    arp: { p: 'pad', pat: ['x---------------'], v: 0.2, rev: 0.4 },
    lead: { p: 'synthPluck', feel: 'sync', v: 0.52, del: 0.25, rev: 0.25, gate: 0.9 },
    room: [0.5, 0.4],
    echo: [3, 0.35],
    pump: 0.45,
    words: ['Confetti Glowing Fizzy Jumping Electric Sparkling Rainbow Golden Bubblegum Shining', 'Party Dancefloor Fireworks Celebration Lights Balloons Summer Weekend Carnival Cheer'],
  },
} satisfies Record<string, Style>;

export type MusicStyle = keyof typeof STYLES;

export interface StyleInfo {
  id: MusicStyle;
  name: string;
  tags: string;
  about: string;
  /** Slow, usual and fast tempo. */
  bpm: readonly [number, number, number];
  /** What the bright and the dark flavour are called. */
  flavours: readonly [string, string];
  /** Words for naming tunes: adjectives | nouns. */
  words: readonly [string, string];
}

/** Every style the composer knows. */
export const MUSIC_STYLES: StyleInfo[] = (Object.keys(STYLES) as MusicStyle[]).map((id) => {
  const s: Style = STYLES[id];
  return { id, name: s.name, tags: s.tags, about: s.about, bpm: s.bpm, flavours: s.flavours, words: s.words };
});

export const isMusicStyle = (s: unknown): s is MusicStyle => typeof s === 'string' && Object.prototype.hasOwnProperty.call(STYLES, s);

// -----------------------------------------------------------------------------
// The composer
// -----------------------------------------------------------------------------

export interface NoteEvent {
  /** Start and length, in steps. */
  t: number;
  d: number;
  /** MIDI note. */
  m: number;
  /** Velocity 0..1. */
  v: number;
}

export interface DrumEvent {
  t: number;
  /** Which drum of the kit. */
  k: string;
  v: number;
}

export interface SongTrack {
  name: 'bass' | 'comp' | 'arp' | 'lead';
  patch: PatchName;
  notes: NoteEvent[];
  vol: number;
  rev: number;
  del: number;
  gate: number;
  fx?: Fx;
  /** Ducked by the kick. */
  pump: boolean;
}

export interface Song {
  style: MusicStyle;
  bpm: number;
  /** Key note 0..11 (C = 0), scale and whether it is the dark flavour. */
  key: number;
  scale: ScaleName;
  dark: boolean;
  energy: number;
  bars: number;
  /** Steps per bar, seconds per step, and how late every second step is (seconds). */
  steps: number;
  stepSec: number;
  swingSec: number;
  /** One chord symbol per bar (or per half bar). */
  chords: string[];
  tracks: SongTrack[];
  drums: DrumEvent[];
  kit: KitName;
  drumVol: number;
  seconds: number;
}

/** Parts are mixed by loudness: a style's `v` for each part is scaled by its role. */
const ROLE_LOUDNESS = { bass: 1, comp: 1.5, arp: 1.3, lead: 1.35 } as const;

function pickBars(barSec: number): number {
  for (const bars of [2, 4, 8, 16, 32]) if (bars * barSec >= 7.1) return bars;
  return 32;
}

/** Writes the song: every note of every part. */
export function composeMusic(params: MusicParams): Song {
  const id: MusicStyle = isMusicStyle(params.style) ? params.style : 'chiptune';
  const st: Style = STYLES[id];
  const seed = Math.floor(Math.abs(Number(params.seed) || 0)) + 1;
  const rnd = rng(seed * 7919 + id.length * 104729);
  const pick = <T,>(list: readonly T[]): T => list[Math.floor(rnd() * list.length) % list.length];
  const mood = params.mood && MOOD_SHAPE[params.mood] ? MOOD_SHAPE[params.mood] : null;
  const dark = typeof params.dark === 'boolean' ? params.dark : mood ? mood[0] : false;
  const energy = clamp((Number.isFinite(params.energy) ? Number(params.energy) : 0.6) + (mood ? mood[1] : 0), 0, 1);
  const tempo = Number(params.tempo);
  const bpm = Math.round(tempo >= 40 && tempo <= 240 ? clamp(tempo, 50, 200) : st.bpm[1] * (1 + (energy - 0.6) * 0.2));
  const key = parseKey(params.key) ?? pick([0, 2, 4, 5, 7, 9, 10, 3]);
  const scale = st.scales[dark ? 1 : 0];
  const S = st.steps ?? 16;
  const beats = st.beats ?? 4;
  const pulse = st.pulse ?? 4;
  const stepSec = (beats * 60) / bpm / S;
  const bars = pickBars(S * stepSec);

  // Harmony.
  const given = (params.chords ?? []).map((c) => String(c).trim()).filter(Boolean).slice(0, 16);
  const symbols = given.length ? given : pick(st.prog[dark ? 1 : 0]).split(' ');
  const prog = symbols.map(parseChord);
  const half = prog.length >= bars * 2;
  const chordAt = (bar: number, step: number): Chord => prog[(half ? bar * 2 + (step >= S / 2 ? 1 : 0) : bar) % prog.length];
  const pcsOf = (ch: Chord): number[] => ch.ints.map((i) => mod12(key + ch.root + i));

  // --- Drums ---
  const drums: DrumEvent[] = [];
  const kitNames = Object.keys(KITS[st.kit]());
  const lines = pick(st.drums).split('|').map((l) => ({ k: l[0], pat: l.slice(2) }));
  const fill = energy >= 0.5 && bars >= 4;
  const fillFrom = S - pulse;
  for (let bar = 0; bar < bars; bar++) {
    const last = fill && (bar === bars - 1 || (bars >= 8 && bar === bars / 2 - 1));
    for (const { k, pat } of lines) {
      for (let s = 0; s < S; s++) {
        const ch = pat[(bar * S + s) % pat.length];
        if (ch !== 'x' && ch !== 'X' && ch !== 'o') continue;
        const cymbalish = k === 'h' || k === 'o' || k === 'r' || k === 'a' || k === 'j';
        if (last && s >= fillFrom && (cymbalish || k === 's')) continue;
        if (ch === 'o' && energy < 0.35 && !cymbalish) continue;
        if (k === 'h' || k === 'a') {
          if (energy < 0.3 && s % pulse !== 0) continue;
          if (energy < 0.5 && S === 16 && s % 2 === 1) continue;
        }
        let v = ch === 'X' ? 1 : ch === 'o' ? 0.42 : 0.8;
        if (cymbalish && s % pulse !== 0) v *= 0.72;
        drums.push({ t: bar * S + s, k, v: v * (0.92 + 0.08 * rnd()) });
      }
    }
    if (last) {
      // A fill: a run down the drums into the next bar.
      const every = pulse === 6 ? 2 : 1;
      const hits = Math.floor(pulse / every);
      for (let i = 0; i < hits; i++) {
        const k = kitNames.includes('t') && kitNames.includes('u') && i >= hits / 2 ? (i === hits - 1 ? 'u' : 't') : kitNames.includes('s') ? 's' : lines[0].k;
        drums.push({ t: bar * S + fillFrom + i * every, k, v: 0.6 + (0.4 * (i + 1)) / hits });
      }
    }
  }
  if (energy >= 0.45 && kitNames.includes('y') && bars >= 4) drums.push({ t: 0, k: 'y', v: 0.7 });

  // --- Bass ---
  const bassLow = 33 + (st.bass.oct ?? 0);
  const bassRoot = (ch: Chord): number => bassLow + mod12(key + ch.root - bassLow);
  const interval = (ch: Chord, wanted: number[], fallback: number): number => ch.ints.find((i) => wanted.includes(i % 12)) ?? fallback;
  const bassPat = pick(st.bass.pat);
  const bass: NoteEvent[] = [];
  let lastBass = bassRoot(prog[0]);
  for (let bar = 0; bar < bars; bar++) {
    for (let s = 0; s < S; s++) {
      const c = bassPat[(bar * S + s) % bassPat.length];
      if (c === '.' || c === '-') continue;
      const ch = chordAt(bar, s);
      const root = bassRoot(ch);
      let m = root;
      if (c === '3') m = root + interval(ch, [3, 4], 7);
      else if (c === '5') m = root + interval(ch, [7, 6, 8], 7);
      else if (c === '6') m = root + 9;
      else if (c === '7') m = root + interval(ch, [10, 11], 10);
      else if (c === '8') m = root + 12;
      else if (c === 'a') {
        // Approach the next chord's root by a semitone, from whichever side is nearer.
        const next = bassRoot(chordAt((bar + 1) % bars, 0));
        m = lastBass >= next ? next + 1 : next - 1;
      }
      let len = 1;
      while (s + len < S && bassPat[(bar * S + s + len) % bassPat.length] === '-') len++;
      bass.push({ t: bar * S + s, d: len, m, v: s % pulse === 0 ? 0.9 : 0.75 });
      lastBass = m;
    }
  }

  // --- Chords and arpeggios ---
  const voice = (ch: Chord, part: Part): number[] => {
    const center = 60 + (part.oct ?? 0);
    const near = (pc: number, c: number): number => c - 6 + mod12(pc - (c - 6));
    const rootPc = mod12(key + ch.root);
    if (part.voicing === 'power') {
      const r = near(rootPc, center - 10);
      return [r, r + 7, r + 12];
    }
    let tones = pcsOf(ch);
    if (part.voicing === 'shell' && tones.length >= 4) tones = tones.slice(1);
    const notes = [...new Set(tones.map((pc) => near(pc, center)))].sort((a, b) => a - b);
    if (part.voicing === 'open') notes.unshift(near(rootPc, center - 12));
    return notes;
  };
  const partNotes = (part: Part): NoteEvent[] => {
    const pat = pick(part.pat);
    const out: NoteEvent[] = [];
    for (let bar = 0; bar < bars; bar++) {
      for (let s = 0; s < S; s++) {
        const c = pat[(bar * S + s) % pat.length];
        if (c === '.' || c === '-') continue;
        const notes = voice(chordAt(bar, s), part);
        let len = 1;
        while (s + len < S && pat[(bar * S + s + len) % pat.length] === '-') len++;
        const t = bar * S + s;
        const accent = s % pulse === 0 ? 0.9 : 0.72;
        if (c === 'x' || c === 'X') {
          for (const m of notes) out.push({ t, d: len, m, v: (c === 'X' ? 1 : accent) * (0.95 + 0.05 * rnd()) });
        } else {
          const i = c.toLowerCase().charCodeAt(0) - 97;
          if (i < 0 || i > 5) continue;
          const m = notes[i % notes.length] + 12 * Math.floor(i / notes.length) + (c === c.toUpperCase() ? 12 : 0);
          out.push({ t, d: len, m, v: accent });
        }
      }
    }
    return out;
  };
  const comp = partNotes(st.comp);
  const arpPart: Part | undefined = (st as Style).arp;
  const arp = arpPart && energy >= 0.3 ? partNotes(arpPart) : [];

  // --- Lead ---
  const lead = st.lead as Lead;
  const center = 72 + (lead.oct ?? 0);
  const lo = center - 8;
  const hi = center + 10;
  const scalePcs: number[] = SCALES[scale].map((x) => mod12(x + key));
  const ladder: number[] = [];
  for (let m = lo - 14; m <= hi + 14; m++) if (scalePcs.includes(mod12(m))) ladder.push(m);
  const nearestRung = (m: number): number => {
    let best = 0;
    for (let i = 1; i < ladder.length; i++) if (Math.abs(ladder[i] - m) < Math.abs(ladder[best] - m)) best = i;
    return best;
  };
  const chordTones = (ch: Chord): number[] => {
    const pcs = pcsOf(ch);
    const out: number[] = [];
    for (let m = lo; m <= hi; m++) if (pcs.includes(mod12(m))) out.push(m);
    return out;
  };
  const weighted = (cands: number[], weight: (m: number) => number): number => {
    let total = 0;
    const ws = cands.map((m) => {
      const w = Math.max(0, weight(m));
      total += w;
      return w;
    });
    if (total <= 0) return cands[0];
    let r = rnd() * total;
    for (let i = 0; i < cands.length; i++) {
      r -= ws[i];
      if (r <= 0) return cands[i];
    }
    return cands[cands.length - 1];
  };

  const leadNotes: NoteEvent[] = [];
  const explicit = (params.melody ?? []).map((n) => Math.round(Number(n))).filter((n) => Number.isFinite(n));
  if (explicit.some((n) => n > 0)) {
    // The author's own tune, on an eighth-note grid, repeated to fill the loop.
    const eighth = S === 12 && pulse === 3 ? 1.5 : 2;
    const total = Math.floor((bars * S) / eighth);
    const tonic = ladder[nearestRung(center - 5 + mod12(key - (center - 5)))];
    const rung0 = ladder.indexOf(tonic);
    for (let i = 0; i < total; i++) {
      const n = explicit[i % explicit.length];
      if (n <= 0) continue;
      let len = 1;
      while (i + len < total && explicit[(i + len) % explicit.length] === -1) len++;
      const m = ladder[clamp(rung0 + Math.min(n, 22) - 1, 0, ladder.length - 1)];
      leadNotes.push({ t: i * eighth, d: len * eighth, m, v: i % 2 === 0 ? 0.9 : 0.75 });
    }
  } else {
    const feel = FEELS[lead.feel];
    const count = (c: string): number => c.split('x').length - 1;
    const sorted = [...feel.n].sort((a, b) => count(a) - count(b));
    const pool = energy < 0.4 ? sorted.slice(0, Math.ceil(sorted.length / 2)) : energy > 0.75 ? sorted.slice(Math.floor(sorted.length / 2)) : sorted;
    const A = pick(pool);
    const B = pick(pool.filter((c) => c !== A).length ? pool.filter((c) => c !== A) : pool);
    const D = pick(pool);
    const C = pick(feel.c);
    const C2 = pick(feel.c);
    const phrase = bars >= 8 ? [A, B, A, C, A, B, D, C2] : bars === 4 ? [A, B, A, C] : [A, C];
    /** Which earlier bar this one answers (same idea, fitted to its chord), or -1 for a new idea. */
    const echoOf = bars >= 8 ? [-1, -1, 0, -1, 0, 1, -1, -1] : bars === 4 ? [-1, -1, 0, -1] : [-1, -1];
    const barNotes: NoteEvent[][] = [];
    let cur = weighted(chordTones(prog[0]), (m) => Math.exp(-Math.abs(m - (center - 2)) / 2));
    let lastLeap = 0;
    let repeats = 0;
    for (let bar = 0; bar < bars; bar++) {
      const cell = phrase[bar % phrase.length];
      const src = echoOf[bar % echoOf.length];
      const notes: NoteEvent[] = [];
      const onsets: Array<{ s: number; len: number }> = [];
      for (let s = 0; s < S; s++) {
        if (cell[s] !== 'x') continue;
        let len = 1;
        while (s + len < S && cell[s + len] === '-') len++;
        onsets.push({ s, len });
      }
      const pos = (bar % 4) / 4;
      const srcNotes = src >= 0 && barNotes[src] ? barNotes[src] : null;
      let shift = 0;
      onsets.forEach(({ s, len }, i) => {
        const ch = chordAt(bar, s);
        const pcs = pcsOf(ch);
        const tones = chordTones(ch);
        const isLast = bar === bars - 1 && i === onsets.length - 1;
        const strong = i === 0 || s % (pulse * 2) === 0 || (s % pulse === 0 && len >= pulse) || isLast;
        const want = center + 6 * Math.sin(Math.PI * Math.min(1, pos + (s / S) * 0.25 + 0.06)) - 2;
        const dir = want > cur ? 1 : -1;
        const pull = 1.4 + 0.3 * Math.min(8, Math.abs(want - cur));
        let m: number;
        if (srcNotes && srcNotes[i] && !isLast) {
          // The first idea again, moved so it starts on this chord, strong notes fitted to it.
          const from = nearestRung(srcNotes[i].m);
          if (i === 0) {
            const target = weighted(tones, (t) => Math.exp(-Math.abs(t - srcNotes[0].m) / 2));
            shift = nearestRung(target) - from;
          }
          m = ladder[clamp(from + shift, 0, ladder.length - 1)];
          if (strong && !pcs.includes(mod12(m))) m = weighted(tones, (t) => Math.exp(-Math.abs(t - m) / 1.2));
        } else if (isLast) {
          // Come home: the key note if the last chord has it, else the chord note nearest the tune's first note.
          const first = leadNotes[0]?.m ?? cur;
          m = weighted(tones, (t) => Math.exp(-Math.abs(t - cur) / 3) * (mod12(t) === key ? 4 : 1) * Math.exp(-Math.abs(t - first) / 6));
        } else if (strong) {
          m = weighted(tones, (t) => {
            const dist = Math.abs(t - cur);
            return Math.exp(-dist / 3.2) * (t === cur ? (repeats >= 1 ? 0.05 : 0.4) : 1) * (Math.sign(t - cur) === dir ? pull : 1) * (dist > 7 ? 0.15 : 1);
          });
        } else if (lead.chrom && len <= 1 && rnd() < 0.3) {
          m = clamp(cur + dir, lo, hi);
        } else {
          const r = nearestRung(cur);
          const cands = [r - 2, r - 1, r, r + 1, r + 2].filter((x) => x >= 0 && x < ladder.length && ladder[x] >= lo && ladder[x] <= hi).map((x) => ladder[x]);
          m = weighted(cands, (t) => {
            const stepSize = Math.abs(nearestRung(t) - r);
            let w = stepSize === 0 ? (repeats >= 1 ? 0.03 : 0.22) : stepSize === 1 ? 1 : 0.22;
            if (Math.sign(t - cur) === dir) w *= pull;
            if (lastLeap !== 0 && Math.sign(t - cur) === -Math.sign(lastLeap)) w *= 3;
            // A note a semitone above a chord note grates if it is held.
            if (len >= pulse / 2 && !pcs.includes(mod12(t)) && pcs.includes(mod12(t - 1))) w *= 0.08;
            return w;
          });
        }
        repeats = m === cur ? repeats + 1 : 0;
        lastLeap = Math.abs(m - cur) >= 5 ? m - cur : 0;
        cur = m;
        notes.push({ t: bar * S + s, d: len, m, v: (strong ? 0.92 : 0.74) + 0.06 * rnd() });
      });
      barNotes.push(notes);
      leadNotes.push(...notes);
    }
  }

  const track = (name: SongTrack['name'], part: Part | Lead, notes: NoteEvent[], pump: boolean): SongTrack => ({
    name,
    patch: part.p,
    notes,
    vol: part.v * ROLE_LOUDNESS[name],
    rev: part.rev ?? 0,
    del: part.del ?? 0,
    gate: part.gate ?? 0.92,
    fx: part.fx,
    pump,
  });
  const tracks: SongTrack[] = [track('bass', st.bass, bass, true), track('comp', st.comp, comp, true)];
  if (arpPart && arp.length) tracks.push(track('arp', arpPart, arp, true));
  tracks.push(track('lead', lead, leadNotes, false));

  return {
    style: id,
    bpm,
    key,
    scale,
    dark,
    energy,
    bars,
    steps: S,
    stepSec,
    swingSec: (st.swing ?? 0) * stepSec,
    chords: symbols,
    tracks,
    drums,
    kit: st.kit,
    drumVol: (st.drumVol ?? 0.9) * (0.8 + 0.3 * energy),
    seconds: bars * S * stepSec,
  };
}

// -----------------------------------------------------------------------------
// The player
// -----------------------------------------------------------------------------

/** The loudest a WAV data URL of a loop may be, in base64 characters. */
export const MAX_LOOP_CHARS = 640_000;

/** The best sample rate whose WAV data URL stays under the size limit. */
function loopRate(seconds: number): number {
  for (const sr of [LONG_RATE, 20000, 18000, 16000, 14000, 12000]) if ((seconds * sr * 2 + 44) * (4 / 3) + 30 <= MAX_LOOP_CHARS) return sr;
  return 11025;
}

/** Plays a composed song: a seamless loop of exactly `song.seconds`. */
export function renderSong(song: Song): Rendered {
  const st: Style = STYLES[song.style];
  const sr = loopRate(song.seconds);
  const N = Math.round(song.seconds * sr);
  const T = Math.min(N, Math.round(2.8 * sr));
  const len = N + T;
  const rnd = rng(song.bpm * 31 + song.key * 7 + song.bars);
  const timeOf = (step: number): number => step * song.stepSec + (Math.floor(step) % 2 === 1 ? song.swingSec : 0);

  const dry = new Float32Array(len);
  const revIn = new Float32Array(len);
  const delIn = new Float32Array(len);
  /** Mixes a part in at a loudness (not a gain), so every instrument sits where the style puts it. */
  const addTrack = (buf: Float32Array, loud: number, rev: number, del: number): void => {
    const now = loudness(buf.subarray(0, N), sr);
    if (now < 1e-7) return;
    const vol = (0.1 * loud) / now;
    for (let i = 0; i < len; i++) {
      const v = buf[i] * vol;
      dry[i] += v;
      if (rev) revIn[i] += v * rev;
      if (del) delIn[i] += v * del;
    }
  };
  /** Renders a one-shot (a drum hit or a note) once, then stamps it wherever it plays. */
  const cache = new Map<string, Float32Array>();
  const shot = (cacheKey: string, layers: () => Layer[]): Float32Array => {
    let s = cache.get(cacheKey);
    if (!s) {
      const ls = layers();
      let end = 0.02;
      for (const L of ls) end = Math.max(end, layerEnd(L));
      s = new Float32Array(Math.min(len, Math.ceil(end * sr) + 8));
      for (const L of ls) renderLayer(s, L, sr, rnd);
      cache.set(cacheKey, s);
    }
    return s;
  };
  const stamp = (buf: Float32Array, s: Float32Array, at: number, gain: number): void => {
    const start = Math.round(at * sr);
    const n = Math.min(s.length, len - start);
    for (let i = 0; i < n; i++) buf[start + i] += s[i] * gain;
  };

  // Drums.
  const kit = KITS[song.kit]();
  const drumBuf = new Float32Array(len);
  const kicks: number[] = [];
  for (const ev of song.drums) {
    const layers = kit[ev.k];
    if (!layers) continue;
    stamp(drumBuf, shot(`d${ev.k}`, () => layers), timeOf(ev.t), ev.v * ev.v);
    if (ev.k === 'k') kicks.push(timeOf(ev.t));
  }
  addTrack(drumBuf, song.drumVol, 0.12, 0);

  // Bass, chords, arpeggio, lead.
  const pump = st.pump ?? 0;
  for (const tr of song.tracks) {
    const buf = new Float32Array(len);
    const patch = PATCHES[tr.patch];
    for (const ev of tr.notes) {
      const dur = Math.max(0.03, ev.d * song.stepSec * tr.gate);
      const vq = Math.round(ev.v * 5) / 5;
      const s = shot(`${tr.name}|${ev.m}|${Math.round(dur * 200)}|${vq}`, () => patch(midiHz(ev.m), dur, vq));
      stamp(buf, s, timeOf(ev.t), 1);
    }
    if (pump && tr.pump && kicks.length) {
      // Duck under each kick (and under the kicks of the next time round, in the tail).
      const all = [...kicks, ...kicks.map((t) => t + song.seconds)].sort((a, b) => a - b);
      let k = 0;
      for (let i = 0; i < len; i++) {
        const t = i / sr;
        while (k + 1 < all.length && all[k + 1] <= t) k++;
        const since = t - all[k];
        if (since >= 0 && since < 0.5) buf[i] *= 1 - pump * Math.exp(-since / 0.09);
      }
    }
    if (tr.fx) applyFx(buf, sr, tr.fx);
    addTrack(buf, tr.vol, tr.rev, tr.del);
  }

  // A bed of noise, if the style has one.
  if (st.bed) {
    const buf = new Float32Array(len);
    for (const L of st.bed(song.seconds)) renderLayer(buf, L, sr, rnd);
    addTrack(buf, st.bedVol ?? 0.12, 0.2, 0);
  }

  // Echo and reverb sends, then the style's master tone.
  if (st.echo) {
    const wet = delayWet(delIn, sr, st.echo[0] * song.stepSec, st.echo[1]);
    for (let i = 0; i < len; i++) {
      dry[i] += wet[i];
      revIn[i] += wet[i] * 0.3;
    }
  }
  const room = st.room ?? [0.4, 0.45];
  const wet = reverbWet(revIn, sr, room[0], room[1]);
  for (let i = 0; i < len; i++) dry[i] += wet[i] * 1.6;
  if (st.master) applyFx(dry, sr, st.master);
  filterBuffer(dry, sr, 'hp', 38);
  trimLows(dry, sr, 100, 0.4);

  // Wrap everything that rings past the end round to the start: this is what makes the loop seamless.
  const fade = Math.round(0.05 * sr);
  for (let i = 0; i < fade; i++) dry[len - 1 - i] *= i / fade;
  const out = new Float32Array(N);
  out.set(dry.subarray(0, N));
  for (let i = 0; i < T; i++) out[i] += dry[N + i];
  for (let i = 0; i < N; i++) if (!Number.isFinite(out[i])) out[i] = 0;

  // Loud but never clipping: push into the limiter (which treats the buffer as a loop), then level.
  let sum = 0;
  for (let i = 0; i < N; i++) sum += out[i] * out[i];
  const rms = Math.sqrt(sum / N);
  const peak = peakOf(out);
  if (peak > 0) {
    // Every loop about as loud as the next, with the limiter shaving 2 to 10 dB off the peaks.
    const g = clamp(0.21 / Math.max(rms, 1e-9), (PEAK * 1.25) / peak, (PEAK * 3.2) / peak);
    for (let i = 0; i < N; i++) out[i] *= g;
  }
  limitBuffer(out, sr, PEAK, true);
  return { samples: out, sampleRate: sr };
}

/** Composes and plays a loop. */
export function renderMusic(params: MusicParams): Rendered {
  return renderSong(composeMusic(params));
}
