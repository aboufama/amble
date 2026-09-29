/**
 * UI sounds (§3.7): synthesized with src/audio/synth.ts (no audio files), one shared AudioContext made at
 * the first user gesture, peak about −18 dBFS (Soft −26), at most one of each per 60 ms, all under 400 ms,
 * never on hover. Off by default in school builds.
 */
import { renderSynth, SAMPLE_RATE, type SynthSegment } from '../audio/synth';
import { getState } from '../state/store';

export type UiSound =
  | 'tok'
  | 'toggleOn'
  | 'toggleOff'
  | 'paper'
  | 'lift'
  | 'drop'
  | 'pour'
  | 'step'
  | 'alive'
  | 'sent'
  | 'ready'
  | 'pick'
  | 'put'
  | 'oops'
  | 'boing'
  | 'chime';

interface Layer {
  /** Start offset in seconds. */
  at: number;
  segments: SynthSegment[];
}

const D4 = 293.66;
const A3 = 220;
const D5 = 587.33;
const FS5 = 739.99;
const A5 = 880;
const D6 = 1174.66;
const E6 = 1318.51;

const seg = (wave: SynthSegment['wave'], startFreq: number, endFreq: number, duration: number, startVolume: number, endVolume = 0): SynthSegment => ({
  wave,
  startFreq,
  endFreq,
  duration,
  startVolume,
  endVolume,
});

/** The recipes of §3.7 as synth layers, plus Home's `boing` (a hop on the First page, §2.3) and `chime` (the Trail's first load, §2.4). */
export const UI_SOUNDS: Record<UiSound, Layer[]> = {
  tok: [{ at: 0, segments: [seg('triangle', 880, 660, 0.025, 0.12)] }],
  toggleOn: [{ at: 0, segments: [seg('sine', D5, D5, 0.045, 0.5, 0.4), seg('sine', A5, A5, 0.045, 0.45, 0)] }],
  toggleOff: [{ at: 0, segments: [seg('sine', A5, A5, 0.045, 0.5, 0.4), seg('sine', D5, D5, 0.045, 0.45, 0)] }],
  paper: [{ at: 0, segments: [seg('noise', 1200, 5200, 0.12, 0.08, 0)] }],
  lift: [{ at: 0, segments: [seg('noise', 600, 2400, 0.18, 0.4, 0)] }],
  drop: [
    { at: 0, segments: [seg('sine', 70, 60, 0.06, 0.9, 0)] },
    { at: 0.05, segments: [seg('square', 2200, 2200, 0.03, 0.15, 0)] },
    { at: 0.09, segments: [seg('square', 2900, 2900, 0.03, 0.15, 0)] },
  ],
  pour: [{ at: 0, segments: [seg('sine', 380, 450, 0.02, 0, 0.5), seg('sine', 450, 620, 0.07, 0.5, 0)] }],
  step: [
    { at: 0, segments: [seg('sine', 140, 90, 0.04, 0.8, 0)] },
    { at: 0.07, segments: [seg('sine', 140, 90, 0.04, 0.8, 0)] },
  ],
  alive: [
    { at: 0, segments: [seg('sine', D5, D5, 0.09, 0.5, 0)] },
    { at: 0.07, segments: [seg('sine', FS5, FS5, 0.09, 0.5, 0)] },
    { at: 0.14, segments: [seg('sine', A5, A5, 0.09, 0.5, 0)] },
    { at: 0.21, segments: [seg('sine', D6, D6, 0.12, 0.5, 0)] },
    { at: 0.05, segments: [seg('noise', 6000, 9000, 0.2, 0.08, 0)] },
  ],
  sent: [{ at: 0, segments: [seg('sine', 440, 660, 0.15, 0.5, 0)] }],
  ready: [
    { at: 0, segments: [seg('sine', A5, A5, 0.4, 0.5, 0)] },
    { at: 0, segments: [seg('sine', E6, E6, 0.4, 0.35, 0)] },
  ],
  pick: [{ at: 0, segments: [seg('square', 520, 520, 0.03, 0.06, 0)] }],
  put: [{ at: 0, segments: [seg('square', 390, 390, 0.03, 0.06, 0)] }],
  oops: [{ at: 0, segments: [seg('triangle', D4, D4, 0.09, 0.5, 0.3), seg('triangle', A3, A3, 0.09, 0.4, 0)] }],
  boing: [{ at: 0, segments: [seg('triangle', 300, 500, 0.09, 0.6, 0)] }],
  chime: [
    { at: 0, segments: [seg('sine', D5, D5, 0.16, 0.45, 0)] },
    { at: 0.09, segments: [seg('sine', FS5, FS5, 0.16, 0.45, 0)] },
    { at: 0.18, segments: [seg('sine', A5, A5, 0.2, 0.45, 0)] },
  ],
};

/** Peak levels: −18 dBFS (on) and −26 dBFS (soft). */
const PEAK = { on: 10 ** (-18 / 20), soft: 10 ** (-26 / 20) } as const;
const MIN_GAP_MS = 60;

/** Renders a sound's layers into one mono buffer normalized to `peak`. Pure. */
export function renderUiSound(layers: Layer[], peak: number, sampleRate = SAMPLE_RATE): Float32Array {
  const rendered = layers.map((l) => ({ offset: Math.round(l.at * sampleRate), samples: renderSynth({ segments: l.segments }, sampleRate) }));
  const length = Math.max(1, ...rendered.map((r) => r.offset + r.samples.length));
  const out = new Float32Array(length);
  for (const r of rendered) for (let i = 0; i < r.samples.length; i++) out[r.offset + i] += r.samples[i];
  let max = 0;
  for (const v of out) max = Math.max(max, Math.abs(v));
  if (max > 0) for (let i = 0; i < out.length; i++) out[i] = (out[i] / max) * peak;
  return out;
}

let ctx: AudioContext | null = null;
const buffers = new Map<string, AudioBuffer>();
const lastPlayed = new Map<UiSound, number>();

/** Makes the AudioContext; call from a user gesture (main.tsx wires the first pointer or key). */
export function unlockUiSounds(): void {
  if (typeof AudioContext === 'undefined') return;
  ctx ??= new AudioContext();
  if (ctx.state === 'suspended') void ctx.resume();
}

export function playUiSound(name: UiSound): void {
  const level = getState().prefs.uiSounds;
  if (level === 'off' || !ctx || ctx.state !== 'running') return;
  const now = performance.now();
  if (now - (lastPlayed.get(name) ?? -Infinity) < MIN_GAP_MS) return;
  lastPlayed.set(name, now);
  const key = `${name}:${level}`;
  let buffer = buffers.get(key);
  if (!buffer) {
    const samples = renderUiSound(UI_SOUNDS[name], PEAK[level]);
    buffer = ctx.createBuffer(1, samples.length, SAMPLE_RATE);
    buffer.copyToChannel(samples as Float32Array<ArrayBuffer>, 0);
    buffers.set(key, buffer);
  }
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.connect(ctx.destination);
  source.start();
}
