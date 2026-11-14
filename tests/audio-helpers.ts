/** Measurements for the audio tests: what a listener would notice, as numbers. */

export function peak(x: Float32Array): number {
  let p = 0;
  for (let i = 0; i < x.length; i++) p = Math.max(p, Math.abs(x[i]));
  return p;
}

export function rms(x: Float32Array): number {
  let s = 0;
  for (let i = 0; i < x.length; i++) s += x[i] * x[i];
  return Math.sqrt(s / Math.max(1, x.length));
}

export const finite = (x: Float32Array): boolean => x.every((v) => Number.isFinite(v));

/** Zero crossings per second: a cheap measure of how bright or high a sound is. */
export function crossings(x: Float32Array, sampleRate: number): number {
  let n = 0;
  for (let i = 1; i < x.length; i++) if (x[i - 1] < 0 !== x[i] < 0) n++;
  return (n * sampleRate) / Math.max(1, x.length);
}

/** The loudness contour in `parts` equal slices, scaled so the loudest is 1. */
export function contour(x: Float32Array, parts = 12): number[] {
  const out: number[] = [];
  for (let k = 0; k < parts; k++) out.push(rms(x.subarray(Math.floor((k * x.length) / parts), Math.floor(((k + 1) * x.length) / parts))));
  const max = Math.max(...out, 1e-9);
  return out.map((v) => v / max);
}

/** Brightness over time, in `parts` slices (a sound that rises reads differently from one that falls). */
export function movement(x: Float32Array, sampleRate: number, parts = 4): number[] {
  const out: number[] = [];
  for (let k = 0; k < parts; k++) out.push(crossings(x.subarray(Math.floor((k * x.length) / parts), Math.floor(((k + 1) * x.length) / parts)), sampleRate));
  return out;
}

/**
 * How different two sounds are, 0 = the same: the largest of the relative differences in
 * length and in brightness (overall, and slice by slice), and the distance between their
 * loudness contours.
 */
export function difference(a: { samples: Float32Array; sampleRate: number }, b: { samples: Float32Array; sampleRate: number }): number {
  const rel = (p: number, q: number): number => Math.abs(p - q) / Math.max(p, q, 1e-9);
  const ca = contour(a.samples);
  const cb = contour(b.samples);
  const shape = Math.sqrt(ca.reduce((s, v, i) => s + (v - cb[i]) ** 2, 0) / ca.length);
  const ma = movement(a.samples, a.sampleRate);
  const mb = movement(b.samples, b.sampleRate);
  const moved = Math.max(...ma.map((v, i) => rel(v, mb[i])));
  return Math.max(rel(a.samples.length / a.sampleRate, b.samples.length / b.sampleRate), rel(crossings(a.samples, a.sampleRate), crossings(b.samples, b.sampleRate)), shape, moved * 0.5);
}

function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    for (let i = 0; i < n; i += len) {
      for (let k = 0; k < len / 2; k++) {
        const wr = Math.cos(ang * k);
        const wi = Math.sin(ang * k);
        const vr = re[i + k + len / 2] * wr - im[i + k + len / 2] * wi;
        const vi = re[i + k + len / 2] * wi + im[i + k + len / 2] * wr;
        re[i + k + len / 2] = re[i + k] - vr;
        im[i + k + len / 2] = im[i + k] - vi;
        re[i + k] += vr;
        im[i + k] += vi;
      }
    }
  }
}

/** Energy in octave-wide bands from 50 Hz up, in dB relative to the whole (the tone colour). */
export function bandProfile(x: Float32Array, sampleRate: number): number[] {
  const size = 2048;
  const power = new Float64Array(size / 2 + 1);
  // Whole frames; a sound shorter than one frame is padded with silence.
  for (let s = 0; s === 0 || s + size <= x.length; s += size) {
    const re = new Float64Array(size);
    const im = new Float64Array(size);
    for (let i = 0; i < size; i++) re[i] = (x[s + i] ?? 0) * (x.length < size ? 1 : 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / size));
    fft(re, im);
    for (let k = 0; k <= size / 2; k++) power[k] += re[k] * re[k] + im[k] * im[k];
  }
  const edges = [50, 100, 200, 400, 800, 1600, 3200, 6400];
  const bands = new Array<number>(edges.length).fill(1e-12);
  let total = 1e-12;
  for (let k = 1; k <= size / 2; k++) {
    const f = (k * sampleRate) / size;
    total += power[k];
    for (let b = edges.length - 1; b >= 0; b--) {
      if (f >= edges[b]) {
        bands[b] += power[k];
        break;
      }
    }
  }
  return bands.map((v) => Math.max(-60, 10 * Math.log10(v / total)));
}

/** The dominant pitch of a steady sound, by autocorrelation. */
export function pitch(x: Float32Array, sampleRate: number, lowest = 40, highest = 4000): number {
  const n = Math.min(x.length, 8192);
  const lo = Math.floor(sampleRate / highest);
  const hi = Math.min(n - 2, Math.ceil(sampleRate / lowest));
  const ac: number[] = [];
  for (let lag = lo; lag <= hi; lag++) {
    let s = 0;
    for (let i = 0; i + lag < n; i++) s += x[i] * x[i + lag];
    ac[lag] = s / (n - lag);
  }
  let best = 0;
  let bestValue = -Infinity;
  for (let lag = lo + 1; lag < hi; lag++) {
    if (ac[lag] > ac[lag - 1] && ac[lag] >= ac[lag + 1] && ac[lag] > bestValue * 1.05) {
      bestValue = ac[lag];
      best = lag;
    }
  }
  return best ? sampleRate / best : 0;
}

/**
 * How much of a click there is where a loop wraps round: the sharpest corner at the seam,
 * relative to the sharpest corners anywhere else in the loop (the 99.9th percentile).
 * Below 1, the seam is no sharper than the music itself.
 */
export function seam(x: Float32Array): number {
  const n = x.length;
  const corner = (i: number): number => Math.abs(x[(i - 1 + n) % n] - 2 * x[i % n] + x[(i + 1) % n]);
  const all = new Float32Array(n);
  for (let i = 0; i < n; i++) all[i] = corner(i);
  const atSeam = Math.max(all[0], all[n - 1], all[1], all[n - 2]);
  const sorted = Float32Array.from(all).sort();
  return atSeam / Math.max(sorted[Math.floor(n * 0.999)], 1e-9);
}

/** Decodes a 16-bit mono WAV data URL back to samples. */
export function decodeWav(dataUrl: string): { samples: Float32Array; sampleRate: number } {
  const bytes = Uint8Array.from(atob(dataUrl.split(',')[1]), (c) => c.charCodeAt(0));
  const view = new DataView(bytes.buffer);
  const samples = new Float32Array((bytes.length - 44) / 2);
  for (let i = 0; i < samples.length; i++) samples[i] = view.getInt16(44 + i * 2, true) / 32768;
  return { samples, sampleRate: view.getUint32(24, true) };
}
