/**
 * Tiny retro sound synthesizer. Used for the "Make a sound" presets and for
 * sounds the compiler generates (it describes them as a list of segments).
 * Pure JS (no Web Audio) so it's deterministic and testable.
 */

export type Wave = 'sine' | 'square' | 'triangle' | 'sawtooth' | 'noise';

export interface SynthSegment {
  wave: Wave;
  /** Hz at the start/end of the segment (pitch slides between them). For noise: brightness. */
  startFreq: number;
  endFreq: number;
  /** Seconds. */
  duration: number;
  /** 0..1 */
  startVolume: number;
  endVolume: number;
}

export interface SynthRecipe {
  segments: SynthSegment[];
}

export const SAMPLE_RATE = 22050;

function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) / 4294967296) * 2 - 1;
  };
}

/** Renders a recipe to mono samples in [-1, 1]. */
export function renderSynth(recipe: SynthRecipe, sampleRate = SAMPLE_RATE): Float32Array {
  const segments = recipe.segments
    .slice(0, 64)
    .map((s) => ({
      ...s,
      duration: Math.max(0.005, Math.min(8, Number(s.duration) || 0.1)),
      startFreq: Math.max(1, Math.min(20000, Number(s.startFreq) || 440)),
      endFreq: Math.max(1, Math.min(20000, Number(s.endFreq) || Number(s.startFreq) || 440)),
      startVolume: Math.max(0, Math.min(1, Number(s.startVolume ?? 0.8))),
      endVolume: Math.max(0, Math.min(1, Number(s.endVolume ?? 0))),
    }));
  const total = Math.min(20 * sampleRate, Math.round(segments.reduce((sum, s) => sum + s.duration, 0) * sampleRate));
  const out = new Float32Array(Math.max(1, total));
  const noise = rng(1234567);
  let i = 0;
  let phase = 0;
  let lp = 0;
  for (const s of segments) {
    const n = Math.round(s.duration * sampleRate);
    const fade = Math.min(n / 4, Math.round(0.004 * sampleRate));
    for (let k = 0; k < n && i < out.length; k++, i++) {
      const t = n > 1 ? k / (n - 1) : 0;
      const freq = s.startFreq * Math.pow(s.endFreq / s.startFreq, t);
      let v: number;
      if (s.wave === 'noise') {
        const alpha = Math.min(1, (2 * Math.PI * freq) / sampleRate);
        lp += alpha * (noise() - lp);
        v = lp * Math.min(4, 1 / Math.sqrt(alpha + 0.01));
      } else {
        phase = (phase + freq / sampleRate) % 1;
        switch (s.wave) {
          case 'square':
            v = phase < 0.5 ? 0.6 : -0.6;
            break;
          case 'triangle':
            v = 1 - 4 * Math.abs(phase - 0.5);
            break;
          case 'sawtooth':
            v = (2 * phase - 1) * 0.7;
            break;
          default:
            v = Math.sin(2 * Math.PI * phase);
        }
      }
      let env = s.startVolume + (s.endVolume - s.startVolume) * t;
      if (k < fade) env *= k / fade;
      if (n - k < fade) env *= (n - k) / fade;
      out[i] = v * env;
    }
  }
  let peak = 0;
  for (const v of out) peak = Math.max(peak, Math.abs(v));
  if (peak > 0.9) for (let k = 0; k < out.length; k++) out[k] = (out[k] / peak) * 0.9;
  return out;
}

/** Encodes mono samples as a 16-bit PCM WAV file. */
export function encodeWav(samples: Float32Array, sampleRate = SAMPLE_RATE): Uint8Array {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const writeStr = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };
  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const v = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, v < 0 ? v * 0x8000 : v * 0x7fff, true);
  }
  return new Uint8Array(buffer);
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(binary);
}

/** Recipe -> WAV data URL + duration. */
export function synthToDataUrl(recipe: SynthRecipe): { dataUrl: string; duration: number } {
  const samples = renderSynth(recipe);
  const wav = encodeWav(samples);
  return { dataUrl: `data:audio/wav;base64,${bytesToBase64(wav)}`, duration: samples.length / SAMPLE_RATE };
}

const seg = (wave: Wave, startFreq: number, endFreq: number, duration: number, startVolume = 0.8, endVolume = 0): SynthSegment => ({
  wave,
  startFreq,
  endFreq,
  duration,
  startVolume,
  endVolume,
});

export const SOUND_PRESETS: Record<string, SynthRecipe> = {
  coin: { segments: [seg('square', 988, 988, 0.07, 0.6, 0.6), seg('square', 1319, 1319, 0.22, 0.6, 0)] },
  jump: { segments: [seg('square', 220, 660, 0.22, 0.7, 0.1)] },
  laser: { segments: [seg('sawtooth', 1600, 200, 0.2, 0.7, 0.05)] },
  hit: { segments: [seg('noise', 3000, 400, 0.14, 0.9, 0)] },
  explosion: { segments: [seg('noise', 1800, 90, 0.9, 1, 0)] },
  powerup: {
    segments: [
      seg('square', 523, 523, 0.07, 0.6, 0.6),
      seg('square', 659, 659, 0.07, 0.6, 0.6),
      seg('square', 784, 784, 0.07, 0.6, 0.6),
      seg('square', 1047, 1047, 0.25, 0.6, 0),
    ],
  },
  blip: { segments: [seg('sine', 880, 880, 0.08, 0.7, 0)] },
  pop: { segments: [seg('sine', 520, 1200, 0.07, 0.9, 0)] },
  gameover: {
    segments: [
      seg('triangle', 523, 523, 0.18, 0.7, 0.6),
      seg('triangle', 392, 392, 0.18, 0.7, 0.6),
      seg('triangle', 330, 330, 0.18, 0.7, 0.6),
      seg('triangle', 262, 180, 0.6, 0.7, 0),
    ],
  },
};
