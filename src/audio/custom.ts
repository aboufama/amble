/**
 * Sounds for a game being built: the bridge between the compiler and the sound engine.
 *
 * For each sound a game asks for, the compiler shows the model the closest library sounds and
 * lets it answer with a library id, or with a sound of its own in the format below (a simpler,
 * fully spelled-out version of the engine's recipes, so it fits a strict JSON schema). Whatever
 * comes back is checked and clamped here; anything unusable falls back to the best library match.
 */

import { clamp, num, peakOf, recipeToDataUrl, renderRecipe, toDataUrl, type Fx, type Layer, type Recipe } from './engine';
import { BELL_PARTS, clap, cymbal, hat, kick, modal, snare, tom } from './instruments';
import { findSound, renderLibrarySound, searchSounds, words, type LibrarySound, type SoundKind } from './library';
import { MOODS, MUSIC_STYLES, isMusicStyle, parseKey, renderMusic, type Mood, type MusicParams } from './music';

export const CUSTOM_SOURCES = ['sine', 'triangle', 'saw', 'square', 'noise', 'rumble', 'pluck', 'bell', 'kick', 'snare', 'hat', 'clap', 'tom', 'cymbal'] as const;
export type CustomSource = (typeof CUSTOM_SOURCES)[number];
export const CUSTOM_FILTERS = ['none', 'lowpass', 'highpass', 'bandpass'] as const;

/** One voice of a custom effect, as the model writes it (every field present). */
export interface CustomLayer {
  source: CustomSource;
  /** Seconds. */
  start: number;
  duration: number;
  /** Hz; the pitch glides from freq to freqEnd over the duration. */
  freq: number;
  freqEnd: number;
  /** Envelope: seconds, seconds, level 0..1, seconds. */
  attack: number;
  decay: number;
  sustain: number;
  release: number;
  /** 0..1 */
  volume: number;
  /** Hz and semitones. */
  vibratoRate: number;
  vibratoDepth: number;
  /** Hz and 0..1. */
  tremoloRate: number;
  tremoloDepth: number;
  /** Cents of spread across three detuned copies; 0 = one voice. */
  detune: number;
  /** Square wave only: 0.5 = square, 0.1 = thin. */
  pulseWidth: number;
  /** FM (sine): modulator ratio and amount (0 = none, 2 = bell-like, 6 = harsh). */
  fmRatio: number;
  fmAmount: number;
  filter: (typeof CUSTOM_FILTERS)[number];
  /** Hz; the cutoff moves from cutoff to cutoffEnd over the duration. */
  cutoff: number;
  cutoffEnd: number;
  /** 0..1 */
  resonance: number;
  /** A run of notes, in semitones above freq, one every noteStep seconds; [] = one note. */
  notes: number[];
  noteStep: number;
}

export interface CustomEffect {
  layers: CustomLayer[];
  /** 0..1 each. */
  reverb: number;
  echo: number;
  /** Seconds between echoes. */
  echoTime: number;
  chorus: number;
  drive: number;
  /** 0 = clean .. 1 = crunchy 8-bit. */
  crush: number;
}

export interface CustomMusic {
  style: string;
  tempo: number;
  key: string;
  mood: string;
  energy: number;
  seed: number;
  chords: string[];
  melody: number[];
}

/** The model's answer for one sound. */
export interface SoundReply {
  use: 'library' | 'effect' | 'music';
  libraryId: string;
  effect: CustomEffect | null;
  music: CustomMusic | null;
}

// -----------------------------------------------------------------------------
// Music or effect?
// -----------------------------------------------------------------------------

const STRONG_MUSIC = words('music musical soundtrack bgm song theme');
const WEAK_MUSIC = words('tune loop');
const JINGLE_HINTS = words('jingle stinger sting fanfare ditty victory win won winner lose lost loser gameover levelup tada');

/** What a game is asking for: music to loop under it, or an effect (jingles included). */
export function soundKindFor(name: string, description: string): 'music' | 'effect' {
  const text = `${name} ${description}`;
  const said = new Set(words(text));
  const has = (list: string[]): boolean => list.some((w) => said.has(w));
  if (has(JINGLE_HINTS)) return 'effect';
  if (has(STRONG_MUSIC)) return 'music';
  // "tune" and "loop" could be either (a rain loop, a little tune when you win): see what the library says.
  if (has(WEAK_MUSIC)) return searchSounds(text, { limit: 1 })[0]?.kind === 'music' ? 'music' : 'effect';
  return 'effect';
}

/** The library sounds closest to what a game asked for, best first. */
export function soundCandidates(name: string, description: string, limit = 10): LibrarySound[] {
  const kinds: SoundKind[] = soundKindFor(name, description) === 'music' ? ['music'] : ['effect', 'jingle'];
  // The name counts twice: it is what the code calls the sound.
  const found = searchSounds(`${name} ${name} ${description}`, { kind: kinds, limit });
  if (found.length) return found;
  return searchSounds(kinds[0] === 'music' ? 'happy music' : 'blip', { kind: kinds, limit: 1 });
}

/** One line about a library sound, for the model: "id | name | what it is". */
export function candidateLine(s: LibrarySound): string {
  const about = s.kind === 'effect' ? s.tags.slice(0, 8).join(', ') : s.description.replace(/ (Loops seamlessly|A short tune, not a loop)\.$/, '');
  return `${s.id} | ${s.name} | ${about}`;
}

/** The composer's styles, one line each, for the model. */
export function styleLines(): string[] {
  return MUSIC_STYLES.map((s) => `${s.id}: ${s.about}`);
}

// -----------------------------------------------------------------------------
// Custom effects
// -----------------------------------------------------------------------------

const FILTERS = { lowpass: 'lp', highpass: 'hp', bandpass: 'bp' } as const;

function customLayers(c: Partial<CustomLayer>): Layer[] {
  const source = CUSTOM_SOURCES.includes(c.source as CustomSource) ? (c.source as CustomSource) : 'sine';
  const t = clamp(num(c.start, 0), 0, 10);
  const d = clamp(num(c.duration, 0.15), 0.005, 8);
  const f = clamp(num(c.freq, 440), 20, 12000);
  const f2 = clamp(num(c.freqEnd, f) || f, 20, 12000);
  const v = clamp(num(c.volume, 0.7), 0, 1);
  if (v <= 0) return [];
  const notes = Array.isArray(c.notes) ? c.notes.filter((n) => Number.isFinite(n)).slice(0, 48).map((n) => clamp(Math.round(Number(n)), -36, 48)) : [];
  const run = notes.length ? { n: notes, st: clamp(num(c.noteStep, d) || d, 0.02, 2) } : {};
  const later = (layers: Layer[]): Layer[] => layers.map((L) => ({ ...L, t: (L.t ?? 0) + t, ...run }));
  // Drums and bells are built for you: freq is the drum's pitch, duration how long it rings.
  switch (source) {
    case 'kick':
      return later(kick(clamp(f, 35, 200), clamp(d, 0.05, 1.5), 0.5, 0.2, v));
    case 'snare':
      return later(snare(clamp(f, 100, 400), clamp(d, 0.05, 1), 0.75, v));
    case 'hat':
      return later(hat(clamp(d, 0.02, 1), v));
    case 'clap':
      return later(clap(clamp(d, 0.05, 1), v));
    case 'tom':
      return later(tom(clamp(f, 50, 500), clamp(d, 0.05, 1.5), v));
    case 'cymbal':
      return later(cymbal(clamp(d, 0.1, 4), v));
    case 'bell':
      return later(modal(f, clamp(d, 0.05, 6), BELL_PARTS, v * 0.6));
  }
  const attack = clamp(num(c.attack, 0.003), 0, 5);
  const release = clamp(num(c.release, 0.05), 0.003, 8);
  const L: Layer = {
    w: source === 'rumble' ? 'brown' : source,
    t,
    d,
    f,
    f2,
    env: [attack, clamp(num(c.decay, 0.1), 0.001, 8), clamp(num(c.sustain, 0.6), 0, 1), release],
    v,
    ...run,
  };
  if (source === 'pluck') L.d = d + release;
  if (num(c.vibratoDepth, 0) > 0 && num(c.vibratoRate, 0) > 0) L.vib = [clamp(c.vibratoRate!, 0.1, 80), clamp(c.vibratoDepth!, 0, 12)];
  if (num(c.tremoloDepth, 0) > 0 && num(c.tremoloRate, 0) > 0) L.trem = [clamp(c.tremoloRate!, 0.1, 120), clamp(c.tremoloDepth!, 0, 1)];
  if (num(c.detune, 0) > 0) {
    L.uni = 3;
    L.det = clamp(c.detune!, 1, 100);
  }
  if (source === 'square') L.pw = clamp(num(c.pulseWidth, 0.5) || 0.5, 0.05, 0.95);
  if ((source === 'sine' || source === 'triangle') && num(c.fmAmount, 0) > 0) L.fm = [clamp(num(c.fmRatio, 2) || 2, 0.1, 20), clamp(c.fmAmount!, 0, 12), 0];
  const ft = FILTERS[c.filter as keyof typeof FILTERS];
  if (ft) {
    L.ft = ft;
    L.fc = clamp(num(c.cutoff, 2000) || 2000, 30, 16000);
    L.fc2 = clamp(num(c.cutoffEnd, L.fc) || L.fc, 30, 16000);
    L.q = 0.7 + clamp(num(c.resonance, 0), 0, 1) ** 2 * 14;
  }
  return [L];
}

/** A model's custom effect -> a recipe for the engine (null if there is nothing to play). */
export function customEffectRecipe(effect: Partial<CustomEffect> | null | undefined): Recipe | null {
  if (!effect || !Array.isArray(effect.layers)) return null;
  const layers = effect.layers
    .slice(0, 16)
    .filter((l): l is CustomLayer => Boolean(l) && typeof l === 'object')
    .flatMap(customLayers);
  if (!layers.length) return null;
  const fx: Fx = {};
  const reverb = clamp(num(effect.reverb, 0), 0, 1);
  const echo = clamp(num(effect.echo, 0), 0, 1);
  const crush = clamp(num(effect.crush, 0), 0, 1);
  if (reverb > 0.02) fx.rev = [reverb * 0.7, 0.25 + 0.5 * reverb];
  if (echo > 0.02) fx.del = [echo * 0.6, clamp(num(effect.echoTime, 0.15) || 0.15, 0.03, 0.8), 0.25 + 0.3 * echo];
  if (num(effect.chorus, 0) > 0.02) fx.cho = clamp(effect.chorus!, 0, 1);
  if (num(effect.drive, 0) > 0.02) fx.drv = clamp(effect.drive!, 0, 1);
  if (crush > 0.02) fx.crush = [Math.round(9 - 5 * crush), Math.round(1 + 5 * crush)];
  return { layers, fx };
}

/** A model's custom music -> parameters for the composer (null if the style is unknown). */
export function customMusicParams(music: Partial<CustomMusic> | null | undefined): MusicParams | null {
  if (!music || !isMusicStyle(music.style)) return null;
  const params: MusicParams = { style: music.style, seed: Math.abs(Math.round(num(music.seed, 1))) % 100000 };
  const tempo = num(music.tempo, 0);
  if (tempo >= 40) params.tempo = clamp(tempo, 50, 200);
  if (parseKey(music.key) !== null) params.key = music.key;
  if (MOODS.includes(music.mood as Mood)) params.mood = music.mood as Mood;
  if (Number.isFinite(music.energy)) params.energy = clamp(Number(music.energy), 0, 1);
  if (Array.isArray(music.chords)) params.chords = music.chords.filter((c) => typeof c === 'string' && c.trim()).slice(0, 16);
  if (Array.isArray(music.melody)) params.melody = music.melody.filter((n) => Number.isFinite(n)).slice(0, 256).map((n) => clamp(Math.round(Number(n)), -1, 22));
  return params;
}

export interface MadeSound {
  dataUrl: string;
  duration: number;
  /** Where it came from: a library sound, or the model's own design. */
  from: 'library' | 'custom';
  libraryId?: string;
}

const audible = (s: { dataUrl: string; duration: number } | null): s is { dataUrl: string; duration: number } => Boolean(s) && s!.duration >= 0.03 && s!.dataUrl.length > 200;

/**
 * Renders a model's answer. Returns null when the answer can't be used (empty, wrong shape,
 * an id that isn't in the library, a design with nothing audible in it).
 */
export function renderSoundReply(reply: Partial<SoundReply> | null | undefined): MadeSound | null {
  if (!reply || typeof reply !== 'object') return null;
  try {
    const id = typeof reply.libraryId === 'string' ? reply.libraryId.trim() : '';
    if (reply.use === 'library' || (!reply.use && id)) {
      const made = findSound(id) ? renderLibrarySound(id) : null;
      return audible(made) ? { ...made, from: 'library', libraryId: id } : null;
    }
    if (reply.use === 'music') {
      const params = customMusicParams(reply.music);
      const made = params ? toDataUrl(renderMusic(params)) : null;
      return audible(made) ? { ...made, from: 'custom' } : null;
    }
    if (reply.use === 'effect') {
      const recipe = customEffectRecipe(reply.effect);
      if (!recipe) return null;
      const rendered = renderRecipe(recipe);
      // A design that renders to silence (every layer too quiet or too short) is no use; nor is a blip
      // where a sound was asked for (durations given in the wrong unit): the library match is used instead.
      if (peakOf(rendered.samples) < 0.01 || rendered.samples.length / rendered.sampleRate < 0.1) return null;
      const made = toDataUrl(rendered);
      return audible(made) ? { ...made, from: 'custom' } : null;
    }
  } catch {
    /* fall through: unusable */
  }
  return null;
}

/** The best library match for what a game asked for: used when the model's answer can't be. */
export function fallbackSound(name: string, description: string, candidates?: LibrarySound[]): MadeSound {
  for (const c of candidates ?? soundCandidates(name, description, 3)) {
    const made = renderLibrarySound(c.id);
    if (audible(made)) return { ...made, from: 'library', libraryId: c.id };
  }
  const id = soundKindFor(name, description) === 'music' ? 'music-happy-medium-bright-1' : 'blip-high-m';
  return { ...(renderLibrarySound(id) ?? recipeToDataUrl({ layers: [{ w: 'sine', f: 880, d: 0.06 }] })), from: 'library', libraryId: id };
}
