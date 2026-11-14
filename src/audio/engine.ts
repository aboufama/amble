/**
 * The sound engine: an offline synthesizer in plain TypeScript (no Web Audio, no dependencies),
 * so the same recipe always renders to the same samples, in the browser and in tests.
 *
 * A recipe is a list of layers (voices) mixed together, then a chain of effects:
 *
 *   layer  = oscillator / noise / plucked string  ->  drive  ->  filter (with a sweep)  ->  ADSR
 *   recipe = sum of layers  ->  filters, drive, bitcrush, chorus  ->  delay + reverb sends
 *            ->  limiter  ->  trim  ->  (seamless loop)  ->  level
 *
 * Effects (src/audio/sfx.ts), drums and instruments (src/audio/instruments.ts), jingles and
 * music loops (src/audio/music.ts) are all written as recipes for this engine.
 */

import { bytesToBase64, encodeWav } from './synth';

export type Wave = 'sine' | 'triangle' | 'saw' | 'square' | 'noise' | 'pink' | 'brown' | 'pluck';

/** One voice. Times in seconds, pitches in Hz. Short keys: thousands of these are written by hand. */
export interface Layer {
  w: Wave;
  /** When it starts. */
  t?: number;
  /** How long the note is held (attack + decay + sustain); the release comes after. */
  d?: number;
  /** Pitch at the start, and where it glides to (over `g` seconds, default the held time). */
  f?: number;
  f2?: number;
  g?: number;
  /** Glide shape: 1 = even, below 1 = most of the change early, above 1 = late. */
  c?: number;
  /** [attack, decay, sustain level 0..1, release]. */
  env?: readonly [number, number, number, number];
  /** Volume, 0..1 (the mix is levelled at the end, so this is relative to the other layers). */
  v?: number;
  /** Vibrato: [rate Hz, depth in semitones, delay before it starts]. */
  vib?: readonly [number, number, number?];
  /** Tremolo: [rate Hz, depth 0..1, shape: 0 smooth, 1 on/off]. */
  trem?: readonly [number, number, number?];
  /** Unison: how many detuned copies, and their total spread in cents. */
  uni?: number;
  det?: number;
  /** Pulse width of a square wave (0.5 = square), and its wobble [rate Hz, depth]. */
  pw?: number;
  pwm?: readonly [number, number];
  /** FM (sine and triangle): [modulator ratio, amount at the start, amount at the end]. */
  fm?: readonly [number, number, number?];
  /** Filter: type, cutoff at the start, cutoff at the end (over `fg` seconds, default the held time), resonance Q. */
  ft?: 'lp' | 'hp' | 'bp';
  fc?: number;
  fc2?: number;
  fg?: number;
  q?: number;
  /** Filter wobble: [rate Hz, depth in octaves]. */
  flfo?: readonly [number, number];
  /** Overdrive before the filter, 0..1. */
  drv?: number;
  /** Plucked string: brightness 0..1. */
  br?: number;
  /** A run of notes: semitones above `f` (null = rest), one every `st` seconds. */
  n?: ReadonlyArray<number | null>;
  st?: number;
  /** Scatter: [copies, over how many seconds, pitch spread in semitones, volume spread 0..1]. */
  rep?: readonly [number, number, number?, number?];
}

export interface Fx {
  /** Reverb: mix, or [mix, size 0..1, damping 0..1]. */
  rev?: number | readonly [number, number, number?];
  /** Echo: [mix, time in seconds, feedback 0..0.9]. */
  del?: readonly [number, number, number];
  /** Chorus: mix, or [mix, rate Hz, depth ms]. */
  cho?: number | readonly [number, number, number?];
  /** Overdrive 0..1. */
  drv?: number;
  /** Bitcrush: [bits, hold every n samples]. */
  crush?: readonly [number, number];
  /** Ring modulation frequency (robot voices). */
  ring?: number;
  /** Tone: low-pass and high-pass cutoffs in Hz. */
  lp?: number;
  hp?: number;
  /** Squash: gain into the limiter (1 = off, 3 = loud and dense). */
  lim?: number;
}

export interface Recipe {
  layers: Layer[];
  fx?: Fx;
  /** Makes the random parts (noise, scatter) different. */
  seed?: number;
  /** Blend the end into the start, so it can repeat as an ambience. */
  loop?: boolean;
  /** Peak level, 0..1 (default 0.89). */
  level?: number;
  /** Sample rate; by default short sounds are rendered brighter than long ones. */
  sr?: number;
}

export interface Rendered {
  samples: Float32Array;
  sampleRate: number;
}

export const SFX_RATE = 32000;
export const LONG_RATE = 22050;
export const PEAK = 0.89;

const WAVES: readonly Wave[] = ['sine', 'triangle', 'saw', 'square', 'noise', 'pink', 'brown', 'pluck'];
const TAU = Math.PI * 2;
const CB = 16;
const DEFAULT_ENV = [0.003, 0.08, 0.6, 0.06] as const;

export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
export const num = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);

/** Deterministic random numbers in [0, 1) (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A stable number for a string (FNV-1a), for seeds. */
export function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export const midiHz = (m: number): number => 440 * Math.pow(2, (m - 69) / 12);

// -----------------------------------------------------------------------------
// One voice
// -----------------------------------------------------------------------------

const blep = (t: number, dt: number): number => {
  if (t < dt) {
    t /= dt;
    return t + t - t * t - 1;
  }
  if (t > 1 - dt) {
    t = (t - 1) / dt;
    return t * t + t + t + 1;
  }
  return 0;
};

/**
 * A recipe may only use so much voice time (a run of notes, scattered over many copies, could
 * otherwise take minutes to render). Voices past the budget are left out.
 */
let voiceBudget = Infinity;
const VOICE_SECONDS = 400;

/** Adds one note of a layer to `out`, starting `at` seconds in. */
export function renderVoice(out: Float32Array, L: Layer, sr: number, rnd: () => number, at = 0, fMul = 1, vMul = 1): void {
  const w: Wave = WAVES.includes(L.w) ? L.w : 'sine';
  const hold = clamp(num(L.d, 0.15), 0.001, 30);
  const env = L.env ?? DEFAULT_ENV;
  const isNoise = w === 'noise' || w === 'pink' || w === 'brown';
  const isPluck = w === 'pluck';
  const aN = Math.max(isNoise || isPluck ? 1 : Math.round(0.0006 * sr), Math.round(clamp(num(env[0], 0.003), 0, 20) * sr));
  const dN = Math.max(1, Math.round(clamp(num(env[1], 0.1), 0, 30) * sr));
  const sus = clamp(num(env[2], 0.6), 0, 1);
  const rN = Math.max(Math.round(0.003 * sr), Math.round(clamp(num(env[3], 0.05), 0, 30) * sr));
  const hN = Math.max(1, Math.round(hold * sr));
  const start = Math.round(at * sr);
  const n = Math.min(out.length - start, hN + rN);
  const vol = clamp(num(L.v, 0.7), 0, 8) * vMul;
  if (n <= 0 || start < 0 || vol <= 0 || voiceBudget <= 0) return;
  voiceBudget -= n;

  // Pitch.
  const top = sr * 0.45;
  const f0 = clamp(num(L.f, 440) * fMul, 1, top);
  const f1 = clamp(num(L.f2, num(L.f, 440)) * fMul, 1, top);
  const glide = Math.max(0.001, num(L.g, hold));
  const lnRatio = Math.log(f1 / f0);
  const curve = clamp(num(L.c, 1), 0.05, 20);
  const vibRate = L.vib ? num(L.vib[0], 0) : 0;
  const vibDepth = L.vib ? num(L.vib[1], 0) * 0.0577622650467 : 0;
  const vibDelay = L.vib ? num(L.vib[2], 0) : 0;
  const freqAt = (t: number): number => {
    let f = f0;
    if (lnRatio !== 0) {
      let u = t / glide;
      if (u > 1) u = 1;
      if (curve !== 1) u = Math.pow(u, curve);
      f = f0 * Math.exp(lnRatio * u);
    }
    if (vibDepth !== 0 && t > vibDelay) {
      const tv = t - vibDelay;
      f *= Math.exp(vibDepth * (tv < 0.08 ? tv / 0.08 : 1) * Math.sin(TAU * vibRate * tv));
    }
    return f > top ? top : f;
  };

  // Oscillators.
  const U = isNoise || isPluck ? 1 : clamp(Math.round(num(L.uni, num(L.det, 0) > 0 ? 3 : 1)), 1, 7);
  const ph = new Float64Array(U);
  const dr = new Float64Array(U);
  const det = num(L.det, U > 1 ? 14 : 0);
  for (let u = 0; u < U; u++) {
    dr[u] = U > 1 ? Math.pow(2, ((u / (U - 1) - 0.5) * det) / 1200) : 1;
    ph[u] = U > 1 ? rnd() : w === 'saw' ? 0.5 : w === 'triangle' ? 0.25 : 0;
  }
  const uGain = 1 / Math.sqrt(U);
  const pw0 = clamp(num(L.pw, 0.5), 0.03, 0.97);
  const pwmRate = L.pwm ? num(L.pwm[0], 0) : 0;
  const pwmDepth = L.pwm ? num(L.pwm[1], 0) : 0;
  const fmOn = Boolean(L.fm) && (w === 'sine' || w === 'triangle');
  const fmRatio = fmOn ? num(L.fm![0], 1) : 0;
  const fmA = fmOn ? num(L.fm![1], 0) : 0;
  const fmB = fmOn ? num(L.fm![2], fmA) : 0;
  let mph = 0;

  // Noise.
  let ns = (Math.floor(rnd() * 4294967295) | 1) >>> 0;
  let b0 = 0;
  let b1 = 0;
  let b2 = 0;
  let brown = 0;

  // Plucked string (Karplus-Strong, tuned with an allpass).
  let ks: Float32Array | null = null;
  let kN = 0;
  let kp = 0;
  let kPrev = 0;
  let kB = 0;
  let kC = 0;
  let kG = 0;
  let kx1 = 0;
  let ky1 = 0;
  if (isPluck) {
    const bright = clamp(num(L.br, 0.6), 0, 1);
    // High strings lose less each time round, or they would die at once.
    kB = (0.5 - 0.46 * bright) * Math.min(1, Math.pow(330 / f0, 0.8));
    const period = sr / Math.min(f0, sr / 6);
    kN = Math.max(2, Math.floor(period - kB - 0.1));
    const frac = period - kB - kN;
    kC = (1 - frac) / (1 + frac);
    const t60 = Math.max(0.05, (hold + num(env[3], 0.05)) * 1.3 + 0.15);
    kG = Math.min(0.9996, Math.pow(10, -3 / (Math.min(f0, sr / 6) * t60)));
    ks = new Float32Array(kN);
    // The pick: noise, low-passed a few harmonics above the note (twice, for a rounder tone).
    const a = Math.min(1, (TAU * f0 * (1.5 + 30 * bright * bright)) / sr);
    let lp = 0;
    let lp2 = 0;
    let mean = 0;
    for (let i = -kN; i < kN; i++) {
      lp += a * (rnd() * 2 - 1 - lp);
      lp2 += a * (lp - lp2);
      if (i < 0) continue;
      ks[i] = lp2;
      mean += lp2;
    }
    mean /= kN;
    let peak = 1e-6;
    for (let i = 0; i < kN; i++) {
      ks[i] -= mean;
      peak = Math.max(peak, Math.abs(ks[i]));
    }
    for (let i = 0; i < kN; i++) ks[i] /= peak;
  }

  // Filter (trapezoidal state-variable).
  const ft = L.ft;
  const fc0 = clamp(num(L.fc, 2000), 15, 20000);
  const fc1 = clamp(num(L.fc2, fc0), 15, 20000);
  const lnFc = Math.log(fc1 / fc0);
  const fTime = Math.max(0.001, num(L.fg, hold));
  const k = 1 / clamp(num(L.q, 0.71), 0.3, 40);
  const flfoRate = L.flfo ? num(L.flfo[0], 0) : 0;
  const flfoDepth = L.flfo ? num(L.flfo[1], 0) * Math.LN2 : 0;
  const fTop = sr * 0.44;
  let a1 = 0;
  let a2 = 0;
  let a3 = 0;
  let ic1 = 0;
  let ic2 = 0;

  const drive = clamp(num(L.drv, 0), 0, 1);
  const dGain = 1 + drive * 9;
  const dComp = 1 / (1 - Math.exp(-dGain * 1.2));
  const tremRate = L.trem ? num(L.trem[0], 0) : 0;
  const tremDepth = L.trem ? clamp(num(L.trem[1], 0), 0, 1) : 0;
  const tremSquare = L.trem ? num(L.trem[2], 0) >= 0.5 : false;

  let freq = freqAt(0);
  let dFreq = 0;
  let trem = 1;
  let dTrem = 0;
  let pw = pw0;
  let fmIdx = fmA;
  let e = 0;
  let eOff = 0;
  const waveCode = w === 'sine' ? 0 : w === 'triangle' ? 1 : w === 'saw' ? 2 : w === 'square' ? 3 : w === 'noise' ? 4 : w === 'pink' ? 5 : w === 'brown' ? 6 : 7;

  for (let i = 0; i < n; i++) {
    if (i % CB === 0) {
      const t = (i + CB) / sr;
      dFreq = (freqAt(t) - freq) / CB;
      if (tremDepth !== 0) {
        const p = (tremRate * t) % 1;
        const target = tremSquare ? (p < 0.5 ? 1 : 1 - tremDepth) : 1 - tremDepth * (0.5 - 0.5 * Math.cos(TAU * p));
        dTrem = (target - trem) / CB;
      }
      if (pwmDepth !== 0) pw = clamp(pw0 + pwmDepth * Math.sin(TAU * pwmRate * t), 0.03, 0.97);
      if (fmOn) {
        const u = Math.min(1, t / hold);
        fmIdx = fmB + (fmA - fmB) * (1 - u) * (1 - u);
      }
      if (ft) {
        let fc = lnFc !== 0 ? fc0 * Math.exp(lnFc * Math.min(1, t / fTime)) : fc0;
        if (flfoDepth !== 0) fc *= Math.exp(flfoDepth * Math.sin(TAU * flfoRate * t));
        const g = Math.tan((Math.PI * (fc > fTop ? fTop : fc < 15 ? 15 : fc)) / sr);
        a1 = 1 / (1 + g * (g + k));
        a2 = g * a1;
        a3 = g * a2;
      }
    }
    freq += dFreq;
    trem += dTrem;
    const inc = freq / sr;

    let x = 0;
    switch (waveCode) {
      case 0:
        if (fmOn) {
          mph += inc * fmRatio;
          if (mph >= 1) mph -= Math.floor(mph);
          const mod = fmIdx * Math.sin(TAU * mph);
          for (let u = 0; u < U; u++) {
            let p = ph[u] + inc * dr[u];
            if (p >= 1) p -= 1;
            ph[u] = p;
            x += Math.sin(TAU * p + mod);
          }
        } else {
          for (let u = 0; u < U; u++) {
            let p = ph[u] + inc * dr[u];
            if (p >= 1) p -= 1;
            ph[u] = p;
            x += Math.sin(TAU * p);
          }
        }
        break;
      case 1: {
        let mod = 0;
        if (fmOn) {
          mph += inc * fmRatio;
          if (mph >= 1) mph -= Math.floor(mph);
          mod = (fmIdx * Math.sin(TAU * mph)) / TAU;
        }
        for (let u = 0; u < U; u++) {
          let p = ph[u] + inc * dr[u];
          if (p >= 1) p -= 1;
          ph[u] = p;
          let q = p + mod;
          q -= Math.floor(q);
          x += 1 - 4 * Math.abs(q - 0.5);
        }
        break;
      }
      case 2:
        for (let u = 0; u < U; u++) {
          const dt = inc * dr[u];
          let p = ph[u] + dt;
          if (p >= 1) p -= 1;
          ph[u] = p;
          x += 2 * p - 1 - blep(p, dt);
        }
        x *= 0.8;
        break;
      case 3:
        for (let u = 0; u < U; u++) {
          const dt = inc * dr[u];
          let p = ph[u] + dt;
          if (p >= 1) p -= 1;
          ph[u] = p;
          let p2 = p + 1 - pw;
          if (p2 >= 1) p2 -= 1;
          x += (p < pw ? 1 : -1) + blep(p, dt) - blep(p2, dt);
        }
        x *= 0.7;
        break;
      case 4:
        ns ^= ns << 13;
        ns ^= ns >>> 17;
        ns ^= ns << 5;
        x = (ns >>> 0) / 2147483648 - 1;
        break;
      case 5: {
        ns ^= ns << 13;
        ns ^= ns >>> 17;
        ns ^= ns << 5;
        const white = (ns >>> 0) / 2147483648 - 1;
        b0 = 0.99765 * b0 + white * 0.099046;
        b1 = 0.963 * b1 + white * 0.2965164;
        b2 = 0.57 * b2 + white * 1.0526913;
        x = (b0 + b1 + b2 + white * 0.1848) * 0.3;
        break;
      }
      case 6: {
        ns ^= ns << 13;
        ns ^= ns >>> 17;
        ns ^= ns << 5;
        const white = (ns >>> 0) / 2147483648 - 1;
        brown = (brown + 0.03 * white) / 1.03;
        x = brown * 5;
        break;
      }
      default: {
        const cur = ks![kp];
        const lp = (1 - kB) * cur + kB * kPrev;
        kPrev = cur;
        const ap = kC * lp + kx1 - kC * ky1;
        kx1 = lp;
        ky1 = ap;
        ks![kp] = ap * kG;
        if (++kp === kN) kp = 0;
        x = cur;
      }
    }
    x *= uGain;

    if (drive !== 0) {
      const y = x * dGain;
      x = (y < 0 ? Math.exp(y * 1.2) - 1 : 1 - Math.exp(-y * 1.2)) * dComp;
    }
    if (ft) {
      const v3 = x - ic2;
      const v1 = a1 * ic1 + a2 * v3;
      const v2 = ic2 + a2 * ic1 + a3 * v3;
      ic1 = 2 * v1 - ic1;
      ic2 = 2 * v2 - ic2;
      x = ft === 'lp' ? v2 : ft === 'bp' ? v1 : x - k * v1 - v2;
    }

    if (i < hN) {
      if (i < aN) e = i / aN;
      else if (i < aN + dN) {
        const u = 1 - (i - aN) / dN;
        e = sus + (1 - sus) * u * u * u;
      } else e = sus;
      eOff = e;
    } else {
      const u = 1 - (i - hN) / rN;
      e = eOff * u * u * u;
    }
    out[start + i] += x * e * vol * trem;
  }
}

/** How long a layer lasts, with its notes, scatter and release. */
export function layerEnd(L: Layer): number {
  const notes = L.n?.length ? L.n.length : 1;
  const hold = clamp(num(L.d, 0.15), 0.001, 30);
  return Math.max(0, num(L.t, 0)) + (notes - 1) * Math.max(0, num(L.st, hold)) + (L.rep ? Math.max(0, num(L.rep[1], 0)) : 0) + hold + clamp(num((L.env ?? DEFAULT_ENV)[3], 0.05), 0.003, 30);
}

/** Adds a whole layer (every note and scattered copy) to `out`, `at` seconds in. */
export function renderLayer(out: Float32Array, L: Layer, sr: number, rnd: () => number, at = 0, fMul = 1, vMul = 1): void {
  const t0 = at + Math.max(0, num(L.t, 0));
  const notes: ReadonlyArray<number | null> = L.n?.length ? L.n.slice(0, 256) : [0];
  const step = Math.max(0, num(L.st, clamp(num(L.d, 0.15), 0.001, 30)));
  const copies = L.rep ? clamp(Math.round(num(L.rep[0], 1)), 1, 600) : 1;
  for (let r = 0; r < copies; r++) {
    let tOff = 0;
    let f = fMul;
    let v = vMul;
    if (L.rep && r > 0) {
      tOff = rnd() * Math.max(0, num(L.rep[1], 0));
      f *= Math.pow(2, ((rnd() * 2 - 1) * num(L.rep[2], 0)) / 12);
      v *= 1 - rnd() * clamp(num(L.rep[3], 0), 0, 1);
    }
    for (let i = 0; i < notes.length; i++) {
      const s = notes[i];
      if (s === null || s === undefined || !Number.isFinite(s)) continue;
      renderVoice(out, L, sr, rnd, t0 + tOff + i * step, f * Math.pow(2, s / 12), v);
    }
  }
}

// -----------------------------------------------------------------------------
// Effects
// -----------------------------------------------------------------------------

/** A static low-, high- or band-pass over a whole buffer (in place). */
export function filterBuffer(x: Float32Array, sr: number, type: 'lp' | 'hp' | 'bp', fc: number, q = 0.71): void {
  const g = Math.tan((Math.PI * clamp(fc, 15, sr * 0.44)) / sr);
  const k = 1 / q;
  const a1 = 1 / (1 + g * (g + k));
  const a2 = g * a1;
  const a3 = g * a2;
  let ic1 = 0;
  let ic2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v3 = x[i] - ic2;
    const v1 = a1 * ic1 + a2 * v3;
    const v2 = ic2 + a2 * ic1 + a3 * v3;
    ic1 = 2 * v1 - ic1;
    ic2 = 2 * v2 - ic2;
    x[i] = type === 'lp' ? v2 : type === 'bp' ? v1 : x[i] - k * v1 - v2;
  }
}

/** Soft overdrive (in place). */
export function driveBuffer(x: Float32Array, amount: number): void {
  const g = 1 + clamp(amount, 0, 1) * 11;
  const comp = 1 / Math.tanh(g * 0.8);
  for (let i = 0; i < x.length; i++) x[i] = Math.tanh(x[i] * g) * comp * 0.8;
}

/** Fewer bits and a lower sample rate, like an old console (in place). */
export function crushBuffer(x: Float32Array, bits: number, hold: number): void {
  const levels = Math.pow(2, clamp(bits, 2, 16) - 1);
  const h = Math.max(1, Math.round(hold));
  let held = 0;
  for (let i = 0; i < x.length; i++) {
    if (i % h === 0) held = Math.round(x[i] * levels) / levels;
    x[i] = held;
  }
}

/** Two modulated taps mixed with the dry sound (in place). */
export function chorusBuffer(x: Float32Array, sr: number, mix: number, rate = 0.8, depthMs = 3.5): void {
  const base = 0.014 * sr;
  const depth = (depthMs / 1000) * sr;
  const size = Math.ceil(base + depth + 4);
  const buf = new Float32Array(size);
  let wp = 0;
  const m = clamp(mix, 0, 1);
  for (let i = 0; i < x.length; i++) {
    buf[wp] = x[i];
    const p = (TAU * rate * i) / sr;
    let wet = 0;
    for (let tap = 0; tap < 2; tap++) {
      const d = base + depth * Math.sin(p + tap * 1.9) * (tap ? 0.8 : 1);
      let rp = wp - d;
      if (rp < 0) rp += size;
      const i0 = Math.floor(rp);
      const fr = rp - i0;
      wet += buf[i0] + fr * (buf[i0 + 1 === size ? 0 : i0 + 1] - buf[i0]);
    }
    x[i] = x[i] * (1 - m * 0.3) + wet * 0.5 * m;
    if (++wp === size) wp = 0;
  }
}

/** The echoes of `x` (wet only): a feedback delay that gets darker each time round. */
export function delayWet(x: Float32Array, sr: number, time: number, feedback: number): Float32Array {
  const out = new Float32Array(x.length);
  const d = Math.max(1, Math.round(clamp(time, 0.005, 2) * sr));
  const fb = clamp(feedback, 0, 0.92);
  let lp = 0;
  for (let i = d; i < x.length; i++) {
    lp += 0.45 * (out[i - d] - lp);
    out[i] = x[i - d] + lp * fb;
  }
  return out;
}

const COMBS = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617];
const ALLPASSES = [556, 441, 341, 225];

/** Seconds for a reverb of this size to die away (60 dB). */
export const reverbTime = (size: number): number => 0.25 + 3.6 * clamp(size, 0, 1) ** 2;

/** The reverb of `x` (wet only): eight damped combs into four allpasses (Freeverb's layout). */
export function reverbWet(x: Float32Array, sr: number, size = 0.5, damp = 0.4): Float32Array {
  const n = x.length;
  const out = new Float32Array(n);
  const scale = sr / 44100;
  const t60 = reverbTime(size);
  const d1 = clamp(damp, 0, 0.95) * 0.5;
  const d2 = 1 - d1;
  const pre = Math.round(0.008 * sr);
  for (const len0 of COMBS) {
    const len = Math.max(8, Math.round(len0 * scale));
    const fb = Math.pow(10, (-3 * len) / (sr * t60));
    const buf = new Float32Array(len);
    let idx = 0;
    let store = 0;
    for (let i = pre; i < n; i++) {
      const y = buf[idx];
      store = y * d2 + store * d1;
      buf[idx] = x[i - pre] + store * fb;
      if (++idx === len) idx = 0;
      out[i] += y;
    }
  }
  for (const len0 of ALLPASSES) {
    const len = Math.max(4, Math.round(len0 * scale));
    const buf = new Float32Array(len);
    let idx = 0;
    for (let i = 0; i < n; i++) {
      const y = buf[idx];
      const v = out[i];
      out[i] = y - v;
      buf[idx] = v + y * 0.5;
      if (++idx === len) idx = 0;
    }
  }
  // Even out the level across sizes (longer tails ring louder).
  const g = 0.059 / Math.sqrt(0.4 + t60);
  for (let i = 0; i < n; i++) out[i] *= g;
  return out;
}

/**
 * Look-ahead limiter (in place): nothing leaves above `ceiling`. With `circular`, the buffer is
 * treated as a loop, so the gain at the end flows into the start.
 */
export function limitBuffer(x: Float32Array, sr: number, ceiling = PEAK, circular = false): void {
  const n = x.length;
  if (!n) return;
  const look = Math.max(1, Math.min(n, Math.round(0.004 * sr)));
  const rel = 1 - Math.exp(-1 / (0.09 * sr));
  const total = circular ? n * 2 + look : n;
  const need = new Float32Array(total + look);
  need.fill(1);
  for (let i = 0; i < total; i++) {
    const a = Math.abs(x[i % n]);
    need[i] = a > ceiling ? ceiling / a : 1;
  }
  // The smallest gain needed over the next `look` samples (a sliding minimum)...
  const minAhead = new Float32Array(total);
  const dq = new Int32Array(total + look);
  let head = 0;
  let tail = 0;
  for (let i = 0; i < total + look; i++) {
    while (tail > head && need[dq[tail - 1]] >= need[i]) tail--;
    dq[tail++] = i;
    const j = i - look;
    if (j >= 0 && j < total) {
      while (dq[head] < j) head++;
      minAhead[j] = need[dq[head]];
    }
  }
  // ...averaged over the same window, so the gain glides down before each peak and never exceeds
  // what any sample needs; then it recovers slowly.
  const off = circular ? n : 0;
  let sum = 0;
  let g = 1;
  for (let i = 0; i < total; i++) {
    sum += minAhead[i];
    if (i >= look) sum -= minAhead[i - look];
    const avg = sum / (i < look ? i + 1 : look);
    g += (1 - g) * rel;
    if (avg < g) g = avg;
    if (i >= off && i < off + n) need[i] = g;
  }
  for (let i = 0; i < n; i++) {
    const v = x[i] * need[off + i];
    x[i] = v > ceiling ? ceiling : v < -ceiling ? -ceiling : v;
  }
}

export function peakOf(x: Float32Array): number {
  let peak = 0;
  for (let i = 0; i < x.length; i++) {
    const a = x[i] < 0 ? -x[i] : x[i];
    if (a > peak) peak = a;
  }
  return peak;
}

/** How loud a buffer is while it is sounding: RMS over the 50 ms blocks within 30 dB of the loudest. */
export function loudness(x: Float32Array, sr: number): number {
  const block = Math.max(1, Math.round(0.05 * sr));
  const energies: number[] = [];
  let max = 0;
  for (let i = 0; i < x.length; i += block) {
    const end = Math.min(x.length, i + block);
    let e = 0;
    for (let j = i; j < end; j++) e += x[j] * x[j];
    e /= end - i;
    energies.push(e);
    if (e > max) max = e;
  }
  if (max <= 0) return 0;
  let sum = 0;
  let n = 0;
  for (const e of energies) {
    if (e >= max * 0.001) {
      sum += e;
      n++;
    }
  }
  return Math.sqrt(sum / Math.max(1, n));
}

/** Scales to a peak level (in place). Silence stays silent. */
export function levelBuffer(x: Float32Array, peak = PEAK): void {
  const p = peakOf(x);
  if (p < 1e-9) return;
  const g = peak / p;
  for (let i = 0; i < x.length; i++) x[i] *= g;
}

/** Applies the recipe-level effects to a mix (in place); returns the buffer. */
export function applyFx(x: Float32Array, sr: number, fx: Fx): Float32Array {
  if (fx.hp) filterBuffer(x, sr, 'hp', fx.hp);
  if (fx.lp) filterBuffer(x, sr, 'lp', fx.lp);
  if (fx.drv) driveBuffer(x, fx.drv);
  if (fx.ring) for (let i = 0; i < x.length; i++) x[i] *= 0.3 + 0.9 * Math.sin((TAU * fx.ring * i) / sr);
  if (fx.crush) {
    crushBuffer(x, fx.crush[0], (fx.crush[1] * sr) / LONG_RATE);
    filterBuffer(x, sr, 'hp', 60);
  }
  if (fx.cho) {
    const c = typeof fx.cho === 'number' ? ([fx.cho] as const) : fx.cho;
    chorusBuffer(x, sr, c[0], num(c[1], 0.8), num(c[2], 3.5));
  }
  let wet: Float32Array | null = null;
  if (fx.del && fx.del[0] > 0) {
    wet = delayWet(x, sr, fx.del[1], fx.del[2]);
    const m = clamp(fx.del[0], 0, 1);
    for (let i = 0; i < x.length; i++) x[i] += wet[i] * m;
  }
  if (fx.rev) {
    const r = typeof fx.rev === 'number' ? ([fx.rev] as const) : fx.rev;
    const m = clamp(r[0], 0, 1.5);
    if (m > 0) {
      wet = reverbWet(x, sr, num(r[1], 0.45), num(r[2], 0.4));
      for (let i = 0; i < x.length; i++) x[i] += wet[i] * m;
    }
  }
  return x;
}

/** How much longer the effects ring after the last note. */
export function fxTail(fx: Fx | undefined): number {
  if (!fx) return 0;
  let tail = 0;
  if (fx.del && fx.del[0] > 0) {
    const fb = clamp(fx.del[2], 0, 0.92);
    tail = Math.min(2.5, fx.del[1] * (1 + (fb > 0.01 ? Math.log(0.03) / Math.log(fb) : 0)));
  }
  if (fx.rev) {
    const r = typeof fx.rev === 'number' ? ([fx.rev] as const) : fx.rev;
    if (r[0] > 0) tail += Math.min(3, reverbTime(num(r[1], 0.45)) * 0.75);
  }
  return tail;
}

// -----------------------------------------------------------------------------
// Recipes
// -----------------------------------------------------------------------------

const MAX_SECONDS = 20;
/** No sound is louder than this while it sounds (see `loudness`), so held tones don't dwarf clicks. */
const MAX_LOUDNESS = 0.3;

/** Where a layer's pattern ends: the point a loop wraps round to its start. */
function layerBody(L: Layer): number {
  const t = Math.max(0, num(L.t, 0));
  const hold = clamp(num(L.d, 0.15), 0.001, 30);
  if (L.rep) return t + Math.max(hold, num(L.rep[1], 0));
  if (L.n?.length) return t + L.n.length * Math.max(0, num(L.st, hold));
  return t + hold;
}

/** Turns the lows down by half (in place): small speakers can't play them, and they eat the headroom. */
export function trimLows(x: Float32Array, sr: number, below = 110, amount = 0.5): void {
  const a = 1 - Math.exp((-TAU * below) / sr);
  let lp = 0;
  for (let i = 0; i < x.length; i++) {
    lp += a * (x[i] - lp);
    x[i] -= amount * lp;
  }
}

/** Renders a recipe to mono samples in [-1, 1]. Always the same samples for the same recipe. */
export function renderRecipe(recipe: Recipe): Rendered {
  const layers = (recipe.layers ?? []).slice(0, 160);
  const fx = recipe.fx;
  let end = 0.03;
  let body = 0.03;
  for (const L of layers) {
    end = Math.max(end, layerEnd(L));
    body = Math.max(body, layerBody(L));
  }
  body = Math.min(MAX_SECONDS, body);
  end = Math.min(MAX_SECONDS, recipe.loop ? Math.max(end, body) : end);
  const total = Math.min(MAX_SECONDS, end + fxTail(fx) + 0.01);
  const sr = recipe.sr ?? ((recipe.loop ? body : total) > 1.25 ? LONG_RATE : SFX_RATE);
  const buf = new Float32Array(Math.max(8, Math.round(total * sr)));
  const rnd = rng((recipe.seed ?? 1) * 2654435761 + 12345);
  voiceBudget = VOICE_SECONDS * sr;
  try {
    for (const L of layers) renderLayer(buf, L, sr, rnd);
  } finally {
    voiceBudget = Infinity;
  }
  for (let i = 0; i < buf.length; i++) if (!Number.isFinite(buf[i])) buf[i] = 0;
  if (fx) applyFx(buf, sr, fx);
  trimLows(buf, sr);

  let samples: Float32Array;
  const loop = Boolean(recipe.loop) && body > 0.2;
  if (loop) {
    // A loop: everything that rings on past the end of the pattern (releases, echoes, reverb) is
    // wrapped round to the start, so it repeats without a gap or a click.
    const n = Math.round(body * sr);
    const fade = Math.min(buf.length, Math.round(0.03 * sr));
    for (let i = 0; i < fade; i++) buf[buf.length - 1 - i] *= i / fade;
    samples = new Float32Array(n);
    for (let i = 0; i < buf.length; i++) samples[i % n] += buf[i];
  } else {
    // Trim the silence at the end, then fade the very end so it never clicks.
    const peak = peakOf(buf);
    let last = buf.length - 1;
    const floor = peak * 0.0015;
    while (last > 0 && Math.abs(buf[last]) <= floor) last--;
    const len = Math.min(buf.length, Math.max(Math.round(0.04 * sr), last + 1 + Math.round(0.004 * sr)));
    samples = buf.slice(0, len);
    const fade = Math.min(len, Math.round((len < buf.length ? 0.004 : 0.012) * sr));
    for (let i = 0; i < fade; i++) samples[len - 1 - i] *= i / fade;
  }

  const level = clamp(num(recipe.level, PEAK), 0.02, PEAK);
  if (fx?.lim && fx.lim > 1) {
    levelBuffer(samples, level * fx.lim);
    limitBuffer(samples, sr, level, loop);
  } else levelBuffer(samples, level);
  const loud = loudness(samples, sr);
  const cap = (MAX_LOUDNESS * level) / PEAK;
  if (loud > cap) for (let i = 0; i < samples.length; i++) samples[i] *= cap / loud;
  return { samples, sampleRate: sr };
}

/** Samples -> a WAV data URL and its length in seconds. */
export function toDataUrl(r: Rendered): { dataUrl: string; duration: number } {
  return { dataUrl: `data:audio/wav;base64,${bytesToBase64(encodeWav(r.samples, r.sampleRate))}`, duration: r.samples.length / r.sampleRate };
}

/** Recipe -> WAV data URL + duration. */
export function recipeToDataUrl(recipe: Recipe): { dataUrl: string; duration: number } {
  return toDataUrl(renderRecipe(recipe));
}
