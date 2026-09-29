/** UI sounds (§3.7): one shared set, Home's boing and chime included, every sound short and at its peak. */
import { describe, expect, it } from 'vitest';
import { SAMPLE_RATE } from '../../src/audio/synth';
import { renderUiSound, UI_SOUNDS, type UiSound } from '../../src/ui/sounds';

const SOURCES = import.meta.glob<string>('/src/**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true });
const PEAK = 10 ** (-18 / 20);

describe('UI sounds', () => {
  it('renders every sound in 400 ms or less, normalized to the peak', () => {
    for (const [name, layers] of Object.entries(UI_SOUNDS)) {
      const samples = renderUiSound(layers, PEAK);
      expect(samples.length / SAMPLE_RATE, name).toBeLessThanOrEqual(0.4);
      expect(Math.max(...samples.map(Math.abs)), name).toBeCloseTo(PEAK, 5);
    }
  });

  it("has Home's boing (a hop, §2.3) and chime (the Trail's first load, §2.4)", () => {
    const names: UiSound[] = ['boing', 'chime'];
    for (const n of names) expect(UI_SOUNDS[n]).toBeDefined();
    expect(UI_SOUNDS.boing).toEqual([{ at: 0, segments: [{ wave: 'triangle', startFreq: 300, endFreq: 500, duration: 0.09, startVolume: 0.6, endVolume: 0 }] }]);
    expect(UI_SOUNDS.chime.map((l) => [l.at, l.segments[0].wave, l.segments[0].startFreq])).toEqual([
      [0, 'sine', 587.33],
      [0.09, 'sine', 739.99],
      [0.18, 'sine', 880],
    ]);
  });

  it('keeps one AudioContext for UI sounds: no Home module or screen of the Trail and First page makes its own', () => {
    const own = Object.entries(SOURCES)
      .filter(([path]) => /^\/src\/(home|screens\/(first|trail))\//.test(path))
      .filter(([, text]) => /new AudioContext\b/.test(text))
      .map(([path]) => path);
    expect(own).toEqual([]);
  });
});
