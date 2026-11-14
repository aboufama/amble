/**
 * The JSON schema for the model's answer to a sound request (Structured Outputs, strict mode:
 * every property required, no extras; "or nothing" is spelled anyOf [null, object]).
 * The matching types and the code that checks an answer are in src/audio/custom.ts.
 */

import { CUSTOM_FILTERS, CUSTOM_SOURCES } from './custom';
import { MOODS, MUSIC_STYLES } from './music';

const str = (description?: string) => ({ type: 'string', ...(description ? { description } : {}) });
const num = (description?: string) => ({ type: 'number', ...(description ? { description } : {}) });

const SOUND_LAYER_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'source', 'start', 'duration', 'freq', 'freqEnd', 'attack', 'decay', 'sustain', 'release', 'volume', 'vibratoRate', 'vibratoDepth', 'tremoloRate', 'tremoloDepth',
    'detune', 'pulseWidth', 'fmRatio', 'fmAmount', 'filter', 'cutoff', 'cutoffEnd', 'resonance', 'notes', 'noteStep',
  ],
  properties: {
    source: { type: 'string', enum: [...CUSTOM_SOURCES] },
    start: num('Seconds from the start of the sound.'),
    duration: num('Seconds the note is held.'),
    freq: num('Hz at the start.'),
    freqEnd: num('Hz at the end (the pitch glides there); same as freq for a steady pitch.'),
    attack: num('Seconds to fade in.'),
    decay: num('Seconds to fall to the sustain level.'),
    sustain: num('Level held after the decay, 0..1 (0 for struck and plucked sounds).'),
    release: num('Seconds to fade out after the note.'),
    volume: num('0..1'),
    vibratoRate: num('Hz (0 = none).'),
    vibratoDepth: num('Semitones (0 = none).'),
    tremoloRate: num('Hz (0 = none).'),
    tremoloDepth: num('0..1 (0 = none).'),
    detune: num('Cents of spread across three detuned copies, for a thick sound (0 = one voice).'),
    pulseWidth: num('Square wave only: 0.5 = square, 0.1 = thin and nasal.'),
    fmRatio: num('Sine only: frequency ratio of the modulator (1, 2, 3.5...).'),
    fmAmount: num('Sine only: 0 = pure, 2 = bell-like, 6 = harsh.'),
    filter: { type: 'string', enum: [...CUSTOM_FILTERS] },
    cutoff: num('Filter cutoff in Hz at the start.'),
    cutoffEnd: num('Filter cutoff in Hz at the end (the filter sweeps there).'),
    resonance: num('0..1'),
    notes: { type: 'array', items: num(), description: 'A run of notes, in semitones above freq, e.g. [0, 4, 7, 12]; [] for one note.' },
    noteStep: num('Seconds between the notes of the run.'),
  },
} as const;

/** The reply to a sound request: a library sound, or a sound of the model's own design. */
export const SOUND_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['use', 'libraryId', 'effect', 'music'],
  properties: {
    use: { type: 'string', enum: ['library', 'effect', 'music'], description: '"library" to use a library sound; "effect" or "music" to design your own.' },
    libraryId: str('With "library": the id of the library sound, exactly as listed. Otherwise "".'),
    effect: {
      description: 'With "effect": your own sound effect. Otherwise null.',
      anyOf: [
        { type: 'null' },
        {
          type: 'object',
          additionalProperties: false,
          required: ['layers', 'reverb', 'echo', 'echoTime', 'chorus', 'drive', 'crush'],
          properties: {
            layers: { type: 'array', items: SOUND_LAYER_SCHEMA, description: 'One to eight voices, mixed together.' },
            reverb: num('0..1'),
            echo: num('0..1'),
            echoTime: num('Seconds between echoes.'),
            chorus: num('0..1'),
            drive: num('Overdrive, 0..1'),
            crush: num('8-bit crunch, 0..1'),
          },
        },
      ],
    },
    music: {
      description: 'With "music": a loop for the composer to write. Otherwise null.',
      anyOf: [
        { type: 'null' },
        {
          type: 'object',
          additionalProperties: false,
          required: ['style', 'tempo', 'key', 'mood', 'energy', 'seed', 'chords', 'melody'],
          properties: {
            style: { type: 'string', enum: MUSIC_STYLES.map((s) => s.id) },
            tempo: num("Beats per minute, or 0 for the style's own."),
            key: { type: 'string', enum: ['', 'C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'], description: '"" lets the seed choose.' },
            mood: { type: 'string', enum: [...MOODS] },
            energy: num('0 (sparse and gentle) .. 1 (busy and driving).'),
            seed: num('Any whole number: a different seed writes a different tune.'),
            chords: { type: 'array', items: str(), description: 'One chord per bar in roman numerals, e.g. ["I", "V", "vi", "IV"]; [] for the style\'s own.' },
            melody: { type: 'array', items: num(), description: 'The lead tune on an eighth-note grid: scale steps 1..15 (8 = an octave up), 0 = rest, -1 = hold the note; [] to have it composed.' },
          },
        },
      ],
    },
  },
} as const;
