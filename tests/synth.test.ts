import { describe, expect, it } from 'vitest';
import { encodeWav, renderSynth, SOUND_PRESETS, SAMPLE_RATE } from '../src/audio/synth';

describe('synth', () => {
  it('renders presets to bounded samples and valid WAV', () => {
    for (const [name, recipe] of Object.entries(SOUND_PRESETS)) {
      const samples = renderSynth(recipe);
      expect(samples.length, name).toBeGreaterThan(SAMPLE_RATE * 0.05);
      expect(Math.max(...samples.map(Math.abs)), name).toBeLessThanOrEqual(0.91);
      const wav = encodeWav(samples);
      expect(String.fromCharCode(...wav.slice(0, 4))).toBe('RIFF');
      expect(wav.length).toBe(44 + samples.length * 2);
    }
  });

  it('survives bad input', () => {
    const s = renderSynth({ segments: [{ wave: 'noise', startFreq: -5, endFreq: NaN, duration: 99, startVolume: 3, endVolume: -1 }] });
    expect(s.length).toBe(8 * SAMPLE_RATE);
    expect(s.every((v) => Number.isFinite(v))).toBe(true);
  });
});
