/**
 * The sound editor's effect buttons (Faster, Slower, Louder, Softer, Mute, Fade in,
 * Fade out, Reverse, Robot), like Scratch's. Pure functions on mono samples so they
 * are testable; the editor decodes a sound, applies one, and saves it as a WAV.
 */

import { bytesToBase64, encodeWav } from './synth';

export type SoundEffect = 'faster' | 'slower' | 'louder' | 'softer' | 'mute' | 'fadeIn' | 'fadeOut' | 'reverse' | 'robot';

export const SOUND_EFFECTS: Array<{ id: SoundEffect; label: string }> = [
  { id: 'faster', label: 'Faster' },
  { id: 'slower', label: 'Slower' },
  { id: 'louder', label: 'Louder' },
  { id: 'softer', label: 'Softer' },
  { id: 'mute', label: 'Mute' },
  { id: 'fadeIn', label: 'Fade in' },
  { id: 'fadeOut', label: 'Fade out' },
  { id: 'reverse', label: 'Reverse' },
  { id: 'robot', label: 'Robot' },
];

/** Sounds are edited (and saved) at this rate, like Scratch's compressed sounds. */
export const EDIT_SAMPLE_RATE = 22050;

/** Plays the samples back `rate` times as fast (pitch goes up with speed, like Scratch). */
function resample(samples: Float32Array, rate: number): Float32Array {
  const out = new Float32Array(Math.max(1, Math.floor(samples.length / rate)));
  for (let i = 0; i < out.length; i++) {
    const pos = i * rate;
    const k = Math.floor(pos);
    const a = samples[k] ?? 0;
    const b = samples[k + 1] ?? a;
    out[i] = a + (b - a) * (pos - k);
  }
  return out;
}

const clamp = (v: number) => Math.max(-1, Math.min(1, v));

export function applyEffect(samples: Float32Array, sampleRate: number, effect: SoundEffect): Float32Array {
  const n = samples.length;
  switch (effect) {
    case 'faster':
      return resample(samples, 1.25);
    case 'slower':
      return resample(samples, 0.75);
    case 'louder':
      return samples.map((v) => clamp(v * 1.25));
    case 'softer':
      return samples.map((v) => v * 0.75);
    case 'mute':
      return new Float32Array(n);
    case 'fadeIn':
      return samples.map((v, i) => v * (n > 1 ? i / (n - 1) : 1));
    case 'fadeOut':
      return samples.map((v, i) => v * (n > 1 ? 1 - i / (n - 1) : 0));
    case 'reverse':
      return samples.slice().reverse();
    case 'robot': {
      // Ring modulation with a low tone, plus a bit of the dry sound for clarity.
      const out = new Float32Array(n);
      for (let i = 0; i < n; i++) out[i] = clamp(samples[i] * (0.25 + 0.95 * Math.sin((2 * Math.PI * 50 * i) / sampleRate)));
      return out;
    }
  }
}

/** Loudness per chunk, scaled so the loudest chunk is near full height: what the waveform draws. */
export function chunkLevels(samples: Float32Array, chunkSize = 256): number[] {
  const levels: number[] = [];
  for (let i = 0; i < samples.length; i += chunkSize) {
    const end = Math.min(samples.length, i + chunkSize);
    let sum = 0;
    for (let j = i; j < end; j++) sum += samples[j] * samples[j];
    levels.push(Math.sqrt(sum / Math.max(1, end - i)));
  }
  if (!levels.length) return [0];
  const max = levels.reduce((m, v) => Math.max(m, v), 0);
  const scale = max > 0 ? Math.min(1 / max, 8) : 0;
  return levels.map((v) => Math.min(1, Math.sqrt(v * scale)) * 0.95);
}

/** A smooth closed outline of the levels, mirrored around the middle (Scratch's waveform shape). */
export function waveformPath(levels: number[], width: number, height: number): string {
  if (levels.length < 2) levels = [levels[0] ?? 0, levels[0] ?? 0];
  const last = levels.length - 1;
  const top = levels.map((v, i) => [(width * i) / last, (-height * v) / 2] as const);
  const bottom = levels.map((_, i) => [(width * (last - i)) / last, (height * levels[last - i]) / 2] as const);
  const points = [...top, ...bottom];
  const parts = points.map(([x, y], i) => {
    const [nx, ny] = points[(i + 1) % points.length];
    return `Q${x.toFixed(1)} ${y.toFixed(1)} ${((x + nx) / 2).toFixed(1)} ${((y + ny) / 2).toFixed(1)}`;
  });
  return `M0 0 ${parts.join(' ')} Z`;
}

/** Decodes a sound to mono samples at EDIT_SAMPLE_RATE. */
export async function decodeSound(dataUrl: string): Promise<Float32Array> {
  const bytes = await (await fetch(dataUrl)).arrayBuffer();
  const probe = new OfflineAudioContext(1, 1, EDIT_SAMPLE_RATE);
  const buffer = await probe.decodeAudioData(bytes);
  const mono = new Float32Array(buffer.length);
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < data.length; i++) mono[i] += data[i] / buffer.numberOfChannels;
  }
  return mono;
}

export function encodeSound(samples: Float32Array): { dataUrl: string; mime: string; duration: number } {
  return {
    dataUrl: `data:audio/wav;base64,${bytesToBase64(encodeWav(samples, EDIT_SAMPLE_RATE))}`,
    mime: 'audio/wav',
    duration: samples.length / EDIT_SAMPLE_RATE,
  };
}
