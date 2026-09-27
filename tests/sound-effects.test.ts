import { describe, expect, it } from 'vitest';
import { EDIT_SAMPLE_RATE, SOUND_EFFECTS, applyEffect, chunkLevels, encodeSound, waveformPath } from '../src/audio/effects';

const ramp = (n: number) => Float32Array.from({ length: n }, (_, i) => (i / (n - 1)) * 0.8 - 0.4);

describe('sound editor effects', () => {
  it('has the Scratch effect buttons in order', () => {
    expect(SOUND_EFFECTS.map((e) => e.label)).toEqual(['Faster', 'Slower', 'Louder', 'Softer', 'Mute', 'Fade in', 'Fade out', 'Reverse', 'Robot']);
  });

  it('changes speed by resampling (pitch goes with it)', () => {
    const s = ramp(1000);
    expect(applyEffect(s, EDIT_SAMPLE_RATE, 'faster').length).toBe(800);
    expect(applyEffect(s, EDIT_SAMPLE_RATE, 'slower').length).toBe(1333);
    const fast = applyEffect(s, EDIT_SAMPLE_RATE, 'faster');
    expect(fast[0]).toBeCloseTo(s[0]);
    expect(fast[400]).toBeCloseTo(s[500]);
  });

  it('makes sounds louder (clipped) and softer', () => {
    const s = Float32Array.from([0.5, -0.9, 0.2]);
    const close = (got: Float32Array, want: number[]) => want.forEach((v, i) => expect(got[i]).toBeCloseTo(v, 5));
    close(applyEffect(s, EDIT_SAMPLE_RATE, 'louder'), [0.625, -1, 0.25]);
    close(applyEffect(s, EDIT_SAMPLE_RATE, 'softer'), [0.375, -0.675, 0.15]);
  });

  it('mutes, fades and reverses', () => {
    const s = Float32Array.from([1, 1, 1, 1, 1]);
    expect(Array.from(applyEffect(s, EDIT_SAMPLE_RATE, 'mute'))).toEqual([0, 0, 0, 0, 0]);
    expect(Array.from(applyEffect(s, EDIT_SAMPLE_RATE, 'fadeIn'))).toEqual([0, 0.25, 0.5, 0.75, 1]);
    expect(Array.from(applyEffect(s, EDIT_SAMPLE_RATE, 'fadeOut'))).toEqual([1, 0.75, 0.5, 0.25, 0]);
    expect(Array.from(applyEffect(Float32Array.from([1, 2, 3]), EDIT_SAMPLE_RATE, 'reverse'))).toEqual([3, 2, 1]);
  });

  it('robot keeps the length and stays in range', () => {
    const out = applyEffect(ramp(2205), EDIT_SAMPLE_RATE, 'robot');
    expect(out.length).toBe(2205);
    expect(Math.max(...Array.from(out).map(Math.abs))).toBeLessThanOrEqual(1);
  });

  it('never changes the input samples', () => {
    const s = ramp(100);
    const copy = s.slice();
    for (const { id } of SOUND_EFFECTS) applyEffect(s, EDIT_SAMPLE_RATE, id);
    expect(Array.from(s)).toEqual(Array.from(copy));
  });

  it('encodes edited sounds as WAV at the edit rate', () => {
    const snd = encodeSound(new Float32Array(EDIT_SAMPLE_RATE / 2));
    expect(snd.mime).toBe('audio/wav');
    expect(snd.duration).toBeCloseTo(0.5);
    expect(snd.dataUrl.startsWith('data:audio/wav;base64,UklGR')).toBe(true);
  });

  it('draws a closed, mirrored waveform scaled to the loudest part', () => {
    const levels = chunkLevels(Float32Array.from({ length: 2048 }, (_, i) => (i < 1024 ? 0.5 : 0.05) * Math.sin(i)), 256);
    expect(levels).toHaveLength(8);
    expect(Math.max(...levels)).toBeCloseTo(0.95, 2);
    expect(levels[7]).toBeLessThan(levels[0]);
    const path = waveformPath(levels, 600, 160);
    expect(path.startsWith('M0 0 Q')).toBe(true);
    expect(path.endsWith('Z')).toBe(true);
    expect(chunkLevels(new Float32Array(0))).toEqual([0]);
  });
});
