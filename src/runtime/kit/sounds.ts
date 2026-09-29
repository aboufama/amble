/**
 * The kit's built-in sounds, as synth recipes (rendered to AudioBuffers at boot by src/audio/synth.ts,
 * so games need no sound files), with captions for players who turn captions on. Pure.
 */
import type { SynthSegment, Wave } from '../../audio/synth';

const seg = (wave: Wave, startFreq: number, endFreq: number, duration: number, startVolume: number, endVolume: number): SynthSegment => ({
  wave,
  startFreq,
  endFreq,
  duration,
  startVolume,
  endVolume,
});

export const SOUND_NAMES = [
  'coin', 'jump', 'laser', 'shoot', 'hit', 'stomp', 'explosion', 'boom', 'powerup', 'blip', 'pop', 'dash', 'zap', 'thud', 'roar',
  'flip', 'slowmo', 'combo', 'hurt', 'win', 'lose', 'bubble', 'splash',
] as const;
export type SoundName = (typeof SOUND_NAMES)[number];

export const SOUNDS: Record<SoundName, SynthSegment[]> = {
  coin: [seg('square', 988, 988, 0.06, 0.5, 0.5), seg('square', 1319, 1319, 0.18, 0.5, 0)],
  jump: [seg('square', 240, 620, 0.16, 0.45, 0.05)],
  laser: [seg('sawtooth', 1500, 240, 0.16, 0.4, 0.02)],
  shoot: [seg('square', 900, 300, 0.07, 0.3, 0)],
  hit: [seg('noise', 3000, 500, 0.1, 0.8, 0)],
  stomp: [seg('square', 400, 90, 0.12, 0.6, 0), seg('noise', 800, 200, 0.06, 0.4, 0)],
  explosion: [seg('noise', 1800, 90, 0.55, 0.9, 0)],
  boom: [seg('noise', 900, 40, 1.1, 1, 0), seg('sine', 90, 30, 0.5, 0.9, 0)],
  powerup: [seg('square', 523, 523, 0.06, 0.5, 0.5), seg('square', 659, 659, 0.06, 0.5, 0.5), seg('square', 784, 784, 0.06, 0.5, 0.5), seg('square', 1047, 1047, 0.2, 0.5, 0)],
  blip: [seg('sine', 880, 880, 0.07, 0.6, 0)],
  pop: [seg('sine', 520, 1200, 0.06, 0.8, 0)],
  dash: [seg('noise', 5000, 900, 0.18, 0.5, 0)],
  zap: [seg('square', 1800, 1200, 0.04, 0.4, 0.4), seg('square', 2400, 600, 0.1, 0.4, 0)],
  thud: [seg('sine', 140, 50, 0.14, 0.9, 0)],
  roar: [seg('sawtooth', 110, 70, 0.7, 0.8, 0), seg('noise', 600, 200, 0.4, 0.5, 0)],
  flip: [seg('triangle', 300, 1200, 0.18, 0.6, 0.2), seg('triangle', 1200, 300, 0.18, 0.6, 0)],
  slowmo: [seg('sine', 600, 90, 0.8, 0.6, 0)],
  combo: [seg('square', 660, 660, 0.05, 0.4, 0.4), seg('square', 990, 990, 0.1, 0.4, 0)],
  hurt: [seg('square', 500, 120, 0.22, 0.6, 0)],
  win: [seg('square', 523, 523, 0.12, 0.5, 0.5), seg('square', 659, 659, 0.12, 0.5, 0.5), seg('square', 784, 784, 0.12, 0.5, 0.5), seg('square', 1047, 1047, 0.4, 0.5, 0)],
  lose: [seg('triangle', 523, 523, 0.16, 0.6, 0.5), seg('triangle', 392, 392, 0.16, 0.6, 0.5), seg('triangle', 262, 180, 0.5, 0.6, 0)],
  bubble: [seg('sine', 300, 900, 0.08, 0.6, 0.2), seg('sine', 900, 1400, 0.05, 0.3, 0)],
  splash: [seg('noise', 2400, 300, 0.35, 0.7, 0), seg('sine', 220, 120, 0.15, 0.3, 0)],
};

export const SOUND_CAPTIONS: Record<SoundName, string> = {
  coin: '[ding]', jump: '[boing]', laser: '[pew]', shoot: '[pew]', hit: '[thwack]', stomp: '[stomp]', explosion: '[boom]', boom: '[BOOM]',
  powerup: '[power-up]', blip: '[blip]', pop: '[pop]', dash: '[whoosh]', zap: '[zap]', thud: '[thud]', roar: '[roar]', flip: '[whirr]',
  slowmo: '[slow-motion]', combo: '[combo]', hurt: '[ouch]', win: '[fanfare]', lose: '[sad trombone]', bubble: '[bloop]', splash: '[splash]',
};

export const MUSIC_STYLES = ['boss', 'adventure', 'chase', 'chill', 'spooky', 'chaos'] as const;
export type MusicStyle = (typeof MUSIC_STYLES)[number];

export interface MusicStyleDef {
  bpm: number;
  /** Scale degrees in semitones. */
  scale: number[];
  /** MIDI root note. */
  root: number;
  /** Chord progression as scale degrees, one per bar. */
  prog: number[];
  wave: OscillatorType;
}

export const MUSIC: Record<MusicStyle, MusicStyleDef> = {
  boss: { bpm: 150, scale: [0, 2, 3, 5, 7, 8, 10], root: 45, prog: [0, 5, 3, 6], wave: 'sawtooth' },
  adventure: { bpm: 126, scale: [0, 2, 4, 5, 7, 9, 11], root: 48, prog: [0, 4, 5, 3], wave: 'square' },
  chase: { bpm: 168, scale: [0, 2, 3, 5, 7, 8, 11], root: 45, prog: [0, 0, 5, 4], wave: 'square' },
  chill: { bpm: 92, scale: [0, 2, 4, 7, 9], root: 50, prog: [0, 3, 1, 4], wave: 'triangle' },
  spooky: { bpm: 84, scale: [0, 1, 3, 6, 7, 10], root: 44, prog: [0, 3, 0, 4], wave: 'triangle' },
  chaos: { bpm: 140, scale: [0, 3, 5, 6, 7, 10], root: 43, prog: [0, 2, 4, 3], wave: 'square' },
};

/** Checks a game's own recipe (`static sounds`); returns null when it is unusable. */
export function parseRecipe(v: unknown): SynthSegment[] | null {
  const list = Array.isArray(v) ? v : typeof v === 'object' && v !== null && Array.isArray((v as { segments?: unknown }).segments) ? (v as { segments: unknown[] }).segments : null;
  if (!list || !list.length) return null;
  const waves: Wave[] = ['sine', 'square', 'triangle', 'sawtooth', 'noise'];
  const out: SynthSegment[] = [];
  for (const s of list.slice(0, 32)) {
    if (typeof s !== 'object' || s === null) continue;
    const o = s as Record<string, unknown>;
    const n = (x: unknown, d: number) => (typeof x === 'number' && Number.isFinite(x) ? x : d);
    const wave = waves.includes(o.wave as Wave) ? (o.wave as Wave) : 'square';
    out.push(seg(wave, n(o.startFreq, 440), n(o.endFreq, n(o.startFreq, 440)), n(o.duration, 0.1), n(o.startVolume, 0.6), n(o.endVolume, 0)));
  }
  return out.length ? out : null;
}
