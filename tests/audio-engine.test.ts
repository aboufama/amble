import { describe, expect, it, vi } from 'vitest';
import { PEAK, limitBuffer, loudness, renderRecipe, reverbWet, toDataUrl, type Layer, type Recipe, type Wave } from '../src/audio/engine';
import { PATCHES, clap, cymbal, hat, kick, snare, tom } from '../src/audio/instruments';
import { bandProfile, crossings, decodeWav, finite, peak, pitch, rms, seam } from './audio-helpers';

// Rendering hundreds of sounds takes a while on a slow machine.
vi.setConfig({ testTimeout: 60_000 });

const tone = (w: Wave, extra: Partial<Layer> = {}): Recipe => ({ layers: [{ w, f: 440, d: 0.3, ...extra }] });

describe('sound engine', () => {
  it('renders every kind of source: audible, finite, never clipping', () => {
    for (const w of ['sine', 'triangle', 'saw', 'square', 'noise', 'pink', 'brown', 'pluck'] as Wave[]) {
      const { samples, sampleRate } = renderRecipe(tone(w));
      expect(samples.length / sampleRate, w).toBeGreaterThan(0.1);
      expect(finite(samples), w).toBe(true);
      expect(peak(samples), w).toBeGreaterThan(0.3);
      expect(peak(samples), w).toBeLessThanOrEqual(PEAK + 1e-6);
      expect(rms(samples), w).toBeGreaterThan(0.02);
    }
  });

  it('is deterministic: the same recipe is the same samples', () => {
    const recipe: Recipe = { layers: [{ w: 'noise', d: 0.3, ft: 'bp', fc: 900, fc2: 3000, rep: [5, 0.2, 7, 0.5] }, { w: 'saw', f: 220, f2: 880, d: 0.3, uni: 3, det: 20 }], fx: { rev: [0.3, 0.5], del: [0.3, 0.1, 0.4], cho: 0.5 } };
    const a = renderRecipe(recipe);
    const b = renderRecipe(recipe);
    expect(a.sampleRate).toBe(b.sampleRate);
    expect(Array.from(a.samples)).toEqual(Array.from(b.samples));
    // A different seed changes the noise.
    expect(Array.from(renderRecipe({ ...recipe, seed: 7 }).samples)).not.toEqual(Array.from(a.samples));
  });

  it('plays tones at the pitch asked for, and glides between pitches', () => {
    for (const w of ['sine', 'triangle', 'saw', 'square', 'pluck'] as Wave[]) {
      for (const f of [110, 440, 1000]) {
        const { samples, sampleRate } = renderRecipe({ layers: [{ w, f, d: 0.5, env: [0.005, 0.01, 1, 0.05] }], sr: 32000 });
        const got = pitch(samples.subarray(2000, 12000), sampleRate, f / 2.5, f * 2.2);
        expect(Math.abs(got - f) / f, `${w} ${f}`).toBeLessThan(0.015);
      }
    }
    const up = renderRecipe({ layers: [{ w: 'sine', f: 300, f2: 1200, d: 0.4, env: [0.005, 0.01, 1, 0.01] }] });
    const n = up.samples.length;
    expect(crossings(up.samples.subarray(Math.floor(n * 0.75)), up.sampleRate)).toBeGreaterThan(2 * crossings(up.samples.subarray(0, Math.floor(n * 0.25)), up.sampleRate));
  });

  it('shapes sound with envelopes and filters', () => {
    const struck = renderRecipe({ layers: [{ w: 'saw', f: 220, d: 0.4, env: [0.001, 0.4, 0, 0.02] }] }).samples;
    expect(rms(struck.subarray(0, 2000))).toBeGreaterThan(4 * rms(struck.subarray(struck.length - 3000)));
    const swell = renderRecipe({ layers: [{ w: 'saw', f: 220, d: 0.4, env: [0.35, 0.02, 1, 0.02] }] }).samples;
    expect(rms(swell.subarray(0, 2000))).toBeLessThan(0.3 * rms(swell.subarray(9000, 12000)));
    // A low-pass takes the top off noise; a high-pass takes the bottom off.
    const top = (r: { samples: Float32Array; sampleRate: number }) => bandProfile(r.samples, r.sampleRate)[7];
    const low = (r: { samples: Float32Array; sampleRate: number }) => bandProfile(r.samples, r.sampleRate)[2];
    const plain = renderRecipe({ layers: [{ w: 'noise', d: 0.5 }] });
    const dull = renderRecipe({ layers: [{ w: 'noise', d: 0.5, ft: 'lp', fc: 500 }] });
    const thin = renderRecipe({ layers: [{ w: 'noise', d: 0.5, ft: 'hp', fc: 5000 }] });
    expect(top(dull)).toBeLessThan(top(plain) - 20);
    expect(low(thin)).toBeLessThan(low(plain) - 20);
    // Resonance rings at the cutoff.
    const ringing = renderRecipe({ layers: [{ w: 'noise', d: 0.5, ft: 'bp', fc: 1000, q: 20 }], sr: 32000 });
    expect(bandProfile(ringing.samples, ringing.sampleRate)[4]).toBeGreaterThan(-2);
  });

  it('adds FM, unison, vibrato and pulse width as overtones and movement', () => {
    const bright = (r: Recipe) => {
      const out = renderRecipe(r);
      return crossings(out.samples, out.sampleRate);
    };
    expect(bright(tone('sine', { fm: [3.5, 4, 4] }))).toBeGreaterThan(1.5 * bright(tone('sine')));
    // A thin pulse has stronger high overtones than a square.
    const high = (r: Recipe) => {
      const out = renderRecipe(r);
      return bandProfile(out.samples, out.sampleRate)[6];
    };
    expect(high(tone('square', { pw: 0.08 }))).toBeGreaterThan(high(tone('square', { pw: 0.5 })) + 3);
    const one = renderRecipe(tone('saw', { d: 0.6 })).samples;
    const thick = renderRecipe(tone('saw', { d: 0.6, uni: 5, det: 40 })).samples;
    // Detuned copies beat against each other: the level wobbles where one voice is steady.
    const wobble = (x: Float32Array) => {
      const levels = Array.from({ length: 12 }, (_, i) => rms(x.subarray(3000 + i * 1000, 4000 + i * 1000)));
      return (Math.max(...levels) - Math.min(...levels)) / Math.max(...levels);
    };
    expect(wobble(thick)).toBeGreaterThan(wobble(one) + 0.03);
  });

  it('has drums that sound like drums', () => {
    const profile = (layers: Layer[]) => {
      const r = renderRecipe({ layers });
      return { r, bands: bandProfile(r.samples, r.sampleRate), seconds: r.samples.length / r.sampleRate };
    };
    const k = profile(kick());
    const h = profile(hat());
    const s = profile(snare());
    // A kick is low, a hat is high, a snare is both a tone and a hiss.
    expect(Math.max(k.bands[0], k.bands[1])).toBeGreaterThan(-6);
    expect(k.bands[7]).toBeLessThan(-25);
    expect(h.bands[7]).toBeGreaterThan(-3);
    expect(h.bands[1]).toBeLessThan(-30);
    expect(s.bands[7]).toBeGreaterThan(-12);
    expect(Math.max(s.bands[1], s.bands[2])).toBeGreaterThan(-15);
    expect(h.seconds).toBeLessThan(0.2);
    expect(profile(cymbal()).seconds).toBeGreaterThan(0.8);
    for (const layers of [tom(), clap()]) expect(peak(profile(layers).r.samples)).toBeGreaterThan(0.3);
    // Every instrument makes a sound at a low, middle and high note.
    for (const [name, patch] of Object.entries(PATCHES)) {
      for (const f of [110, 440, 1320]) {
        const r = renderRecipe({ layers: patch(f, 0.3, 0.8) });
        expect(finite(r.samples), name).toBe(true);
        expect(rms(r.samples), `${name} ${f}`).toBeGreaterThan(0.01);
      }
    }
  });

  it('has effects: echo, reverb, chorus, drive and bitcrush change the sound', () => {
    const dry: Recipe = { layers: [{ w: 'square', f: 660, d: 0.06, env: [0.001, 0.06, 0, 0.01] }] };
    const len = (r: Recipe) => {
      const out = renderRecipe(r);
      return out.samples.length / out.sampleRate;
    };
    expect(len({ ...dry, fx: { del: [0.5, 0.15, 0.5] } })).toBeGreaterThan(len(dry) + 0.3);
    expect(len({ ...dry, fx: { rev: [0.5, 0.7] } })).toBeGreaterThan(len(dry) + 0.5);
    // A bigger room rings longer.
    const impulse = new Float32Array(22050 * 3);
    impulse[0] = 1;
    const tail = (size: number) => rms(reverbWet(impulse, 22050, size).subarray(22050, 44100));
    expect(tail(0.9)).toBeGreaterThan(20 * tail(0.3));
    const held = tone('sine', { d: 0.4 });
    const a = Array.from(renderRecipe(held).samples);
    for (const fx of [{ cho: 0.7 }, { drv: 0.8 }, { crush: [4, 4] as const }, { ring: 60 }]) {
      const out = renderRecipe({ ...held, fx });
      expect(finite(out.samples)).toBe(true);
      expect(peak(out.samples)).toBeLessThanOrEqual(PEAK + 1e-6);
      expect(Array.from(out.samples)).not.toEqual(a);
    }
  });

  it('never lets a sound leave above the ceiling', () => {
    const x = Float32Array.from({ length: 8000 }, (_, i) => Math.sin(i * 0.2) * (i > 3000 && i < 3200 ? 4 : 0.4));
    const before = x.slice();
    limitBuffer(x, 22050, 0.89);
    expect(peak(x)).toBeLessThanOrEqual(0.89 + 1e-6);
    // Away from the peak, the sound is left alone; near it, it is turned down rather than chopped flat.
    expect(x[500]).toBeCloseTo(before[500], 5);
    const flat = x.subarray(3000, 3200).filter((v) => Math.abs(v) > 0.889).length;
    expect(flat).toBeLessThan(40);
    // Loud layers are levelled, quiet recipes stay quiet, silence stays silent.
    expect(peak(renderRecipe({ layers: [{ w: 'saw', f: 200, d: 0.2, v: 8 }, { w: 'noise', d: 0.2, v: 8 }] }).samples)).toBeLessThanOrEqual(PEAK + 1e-6);
    expect(peak(renderRecipe({ layers: [{ w: 'sine', f: 440, d: 0.2 }], level: 0.4 }).samples)).toBeLessThanOrEqual(0.4 + 1e-6);
    expect(peak(renderRecipe({ layers: [] }).samples)).toBe(0);
    // A held square is no louder than the cap, however it peaks.
    const square = renderRecipe(tone('square', { d: 1 }));
    expect(loudness(square.samples, square.sampleRate)).toBeLessThan(0.31);
  });

  it('wraps a looping sound round on itself without a click', () => {
    // A smooth pad with reverb: anything but a perfect wrap would be the sharpest corner in it.
    const recipe: Recipe = { layers: [{ w: 'sine', f: 220, d: 1.5, env: [0.2, 0.1, 1, 0.4] }, { w: 'triangle', f: 331, d: 1.5, env: [0.3, 0.1, 1, 0.3] }], fx: { rev: [0.5, 0.6] }, loop: true };
    const { samples, sampleRate } = renderRecipe(recipe);
    expect(samples.length / sampleRate).toBeCloseTo(1.5, 2);
    expect(seam(samples)).toBeLessThan(1.5);
    // The loop starts with the end of the last time round still ringing; played once, it starts from silence.
    const once = renderRecipe({ ...recipe, loop: false, sr: sampleRate }).samples;
    expect(once.length).toBeGreaterThan(samples.length);
    expect(rms(samples.subarray(0, 60))).toBeGreaterThan(0.02);
    expect(rms(once.subarray(0, 60))).toBeLessThan(0.004);
    // A noisy loop wraps too: its seam is no sharper than the noise itself.
    const noisy = renderRecipe({ layers: [{ w: 'pink', d: 1.5, ft: 'bp', fc: 700, q: 2, env: [0.3, 0.1, 1, 0.3] }], fx: { rev: [0.4, 0.6] }, loop: true });
    expect(noisy.samples.length / noisy.sampleRate).toBeCloseTo(1.5, 2);
    expect(seam(noisy.samples)).toBeLessThan(1.5);
  });

  it('survives bad input', () => {
    const bad = { w: 'saw', f: NaN, f2: -5, d: 1e9, env: [NaN, -1, 9, Infinity], v: 99, fc: -3, q: 0, n: [0, NaN, null, 1e9], st: -1, rep: [1e9, -4, NaN, 7] } as unknown as Layer;
    const out = renderRecipe({ layers: [bad, { w: 'nope' as Wave }, {} as Layer], fx: { rev: [9, 9, 9], del: [9, 9, 9], crush: [0, 0], drv: 9, lp: -1 } });
    expect(finite(out.samples)).toBe(true);
    expect(peak(out.samples)).toBeLessThanOrEqual(PEAK + 1e-6);
    expect(out.samples.length / out.sampleRate).toBeLessThanOrEqual(20.01);
  });

  it('encodes 16-bit mono WAV data URLs', () => {
    const r = renderRecipe(tone('sine'));
    const { dataUrl, duration } = toDataUrl(r);
    expect(dataUrl.startsWith('data:audio/wav;base64,UklGR')).toBe(true);
    expect(duration).toBeCloseTo(r.samples.length / r.sampleRate, 6);
    const back = decodeWav(dataUrl);
    expect(back.sampleRate).toBe(r.sampleRate);
    expect(back.samples.length).toBe(r.samples.length);
    expect(Math.abs(back.samples[1000] - r.samples[1000])).toBeLessThan(1 / 16000);
  });
});
