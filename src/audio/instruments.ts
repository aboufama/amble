/**
 * Drums and instruments for the sound engine, each a function that returns layers.
 * Drums are small physical sketches (a membrane's pitch drop, snare wires as filtered noise,
 * cymbals as inharmonic FM plus noise); instruments take (frequency, held seconds, velocity).
 */

import type { Layer } from './engine';

type Env = readonly [number, number, number, number];

// -----------------------------------------------------------------------------
// Drums
// -----------------------------------------------------------------------------

/** A kick drum: a sine that drops fast to `f`, with a click on top. */
export function kick(f = 52, decay = 0.3, click = 0.5, drv = 0.15, v = 1): Layer[] {
  return [
    { w: 'sine', f: f * 3.6, f2: f, g: 0.085, c: 0.42, d: 0.03, env: [0.0008, 0.03, 0.85, decay], v, drv },
    { w: 'sine', f: f * 6, f2: f * 2, g: 0.03, c: 0.5, d: 0.012, env: [0.0005, 0.012, 0.6, 0.05], v: 0.3 * v },
    { w: 'noise', d: 0.003, env: [0, 0.004, 0.4, 0.012], ft: 'lp', fc: 4200, v: 0.5 * click * v },
  ];
}

/** A snare: two drum-head tones and the wires (high-passed noise). */
export function snare(f = 190, decay = 0.19, snap = 0.75, v = 1): Layer[] {
  return [
    { w: 'triangle', f: f * 1.45, f2: f, g: 0.03, c: 0.5, d: 0.012, env: [0.0005, 0.012, 0.7, decay * 0.55], v: 0.6 * v },
    { w: 'sine', f: f * 1.78, f2: f * 1.5, g: 0.03, d: 0.01, env: [0.0005, 0.01, 0.6, decay * 0.35], v: 0.3 * v },
    { w: 'noise', d: 0.012, env: [0, 0.012, 0.7, decay], ft: 'hp', fc: 1500, q: 0.9, v: snap * v },
    { w: 'noise', d: 0.004, env: [0, 0.004, 0.5, 0.02], ft: 'bp', fc: 3800, q: 1.2, v: 0.5 * snap * v },
  ];
}

/** A hi-hat: bright noise and two clashing FM partials. Long decays make it an open hat. */
export function hat(decay = 0.045, v = 1, bright = 1): Layer[] {
  return [
    { w: 'noise', d: 0.003, env: [0, 0.004, 0.6, decay], ft: 'hp', fc: 6500 * bright, q: 1.4, v: 0.8 * v },
    { w: 'sine', f: 5200 * bright, fm: [1.414, 5, 3], d: 0.003, env: [0, 0.004, 0.5, decay * 0.7], ft: 'hp', fc: 5000, v: 0.3 * v },
    { w: 'sine', f: 3650 * bright, fm: [2.76, 4, 2], d: 0.003, env: [0, 0.004, 0.5, decay * 0.5], ft: 'hp', fc: 5000, v: 0.2 * v },
  ];
}

/** Hand claps: three quick bursts, then the room. */
export function clap(decay = 0.16, v = 1): Layer[] {
  return [
    { w: 'noise', n: [0, 0, 0], st: 0.011, d: 0.003, env: [0, 0.004, 0.3, 0.008], ft: 'bp', fc: 1300, q: 1.6, v },
    { w: 'noise', t: 0.031, d: 0.006, env: [0, 0.01, 0.6, decay], ft: 'bp', fc: 1500, q: 1.1, v: 0.9 * v },
  ];
}

/** A tom: like a small kick with a longer ring. */
export function tom(f = 120, decay = 0.3, v = 1): Layer[] {
  return [
    { w: 'sine', f: f * 1.7, f2: f, g: 0.07, c: 0.5, d: 0.02, env: [0.001, 0.02, 0.85, decay], v },
    { w: 'triangle', f: f * 2.5, f2: f * 1.5, g: 0.05, d: 0.01, env: [0.001, 0.01, 0.5, decay * 0.3], v: 0.25 * v },
    { w: 'noise', d: 0.004, env: [0, 0.006, 0.3, 0.03], ft: 'bp', fc: f * 9, q: 1, v: 0.3 * v },
  ];
}

/** A cymbal: a wash of bright noise over inharmonic partials. Short and high = splash, long = crash. */
export function cymbal(decay = 1.3, v = 1, bright = 1): Layer[] {
  return [
    { w: 'noise', d: 0.01, env: [0.001, 0.05, 0.7, decay], ft: 'hp', fc: 3200 * bright, q: 0.8, v: 0.8 * v },
    { w: 'noise', d: 0.01, env: [0.001, 0.03, 0.5, decay * 0.6], ft: 'bp', fc: 7500 * bright, q: 2, v: 0.5 * v },
    { w: 'sine', f: 4100 * bright, fm: [1.34, 7, 4], d: 0.01, env: [0.001, 0.05, 0.6, decay * 0.8], ft: 'hp', fc: 3000, v: 0.3 * v },
    { w: 'sine', f: 2950 * bright, fm: [2.71, 6, 3], d: 0.01, env: [0.001, 0.05, 0.5, decay * 0.5], ft: 'hp', fc: 3000, v: 0.2 * v },
  ];
}

/** A ride cymbal: a clear ping over a quiet wash. */
export function ride(decay = 0.5, v = 1): Layer[] {
  return [
    { w: 'sine', f: 5100, fm: [1.52, 2.2, 0.6], d: 0.004, env: [0, 0.01, 0.5, decay], v: 0.45 * v },
    { w: 'sine', f: 3420, fm: [2.4, 1.8, 0.5], d: 0.004, env: [0, 0.01, 0.4, decay * 0.7], v: 0.3 * v },
    { w: 'noise', d: 0.004, env: [0, 0.01, 0.35, decay * 0.6], ft: 'hp', fc: 6000, v: 0.35 * v },
  ];
}

export function rim(v = 1): Layer[] {
  return [
    { w: 'sine', f: 1750, d: 0.003, env: [0, 0.004, 0.5, 0.03], v: 0.7 * v },
    { w: 'triangle', f: 480, d: 0.003, env: [0, 0.004, 0.5, 0.04], v: 0.5 * v },
    { w: 'noise', d: 0.002, env: [0, 0.003, 0.3, 0.012], ft: 'bp', fc: 3000, q: 1.5, v: 0.6 * v },
  ];
}

export function cowbell(f = 560, decay = 0.25, v = 1): Layer[] {
  return [
    { w: 'square', f, d: 0.01, env: [0.0005, 0.015, 0.45, decay], ft: 'bp', fc: f * 2.2, q: 2.5, v: 0.8 * v },
    { w: 'square', f: f * 1.508, d: 0.01, env: [0.0005, 0.015, 0.45, decay * 0.8], ft: 'bp', fc: f * 2.6, q: 2.5, v: 0.7 * v },
  ];
}

export function clave(f = 2450, v = 1): Layer[] {
  return [
    { w: 'sine', f, d: 0.003, env: [0, 0.004, 0.6, 0.06], v: 0.9 * v },
    { w: 'sine', f: f * 2.76, d: 0.002, env: [0, 0.003, 0.4, 0.02], v: 0.25 * v },
  ];
}

export function woodblock(f = 1050, v = 1): Layer[] {
  return [
    { w: 'sine', f, f2: f * 0.96, d: 0.004, env: [0, 0.005, 0.5, 0.05], v: 0.9 * v },
    { w: 'sine', f: f * 1.62, d: 0.003, env: [0, 0.004, 0.4, 0.025], v: 0.4 * v },
    { w: 'noise', d: 0.002, env: [0, 0.002, 0.3, 0.008], ft: 'bp', fc: f * 2.4, q: 2, v: 0.35 * v },
  ];
}

/** A hand drum: `slap` adds the sharp edge of an open-handed hit. */
export function conga(f = 240, decay = 0.2, slap = 0.3, v = 1): Layer[] {
  return [
    { w: 'sine', f: f * 1.25, f2: f, g: 0.03, d: 0.01, fm: [1.6, 0.8, 0], env: [0.0005, 0.01, 0.8, decay], v },
    { w: 'noise', d: 0.003, env: [0, 0.004, 0.3, 0.02 + 0.04 * slap], ft: 'bp', fc: 1800 + 1800 * slap, q: 1.4, v: (0.3 + 0.7 * slap) * v },
  ];
}

export function shaker(decay = 0.05, v = 1): Layer[] {
  return [{ w: 'noise', d: 0.016, env: [0.012, 0.01, 0.6, decay], ft: 'hp', fc: 5200, q: 1.2, v: 0.7 * v }];
}

export function tambourine(decay = 0.14, v = 1): Layer[] {
  return [
    { w: 'noise', d: 0.004, env: [0, 0.01, 0.5, decay], ft: 'hp', fc: 6200, q: 1.5, v: 0.6 * v },
    { w: 'sine', f: 6100, fm: [1.31, 4, 2], d: 0.004, env: [0, 0.01, 0.5, decay], rep: [3, 0.02, 3, 0.4], v: 0.3 * v },
  ];
}

/** The orchestra's triangle: three high partials that ring. */
export function triangleHit(decay = 0.9, v = 1): Layer[] {
  return [
    { w: 'sine', f: 4420, d: 0.004, env: [0, 0.01, 0.8, decay], v: 0.5 * v },
    { w: 'sine', f: 6250, d: 0.004, env: [0, 0.01, 0.7, decay * 0.7], v: 0.35 * v },
    { w: 'sine', f: 9300, d: 0.003, env: [0, 0.01, 0.5, decay * 0.4], v: 0.2 * v },
  ];
}

/** A kettledrum: a pitched boom with the head's overtones. */
export function timpani(f = 87, decay = 0.9, v = 1): Layer[] {
  return [
    { w: 'sine', f: f * 1.35, f2: f, g: 0.05, c: 0.5, d: 0.03, env: [0.001, 0.03, 0.85, decay], v },
    { w: 'sine', f: f * 1.5, d: 0.02, env: [0.001, 0.02, 0.6, decay * 0.6], v: 0.4 * v },
    { w: 'sine', f: f * 1.98, d: 0.02, env: [0.001, 0.02, 0.5, decay * 0.4], v: 0.25 * v },
    { w: 'noise', d: 0.006, env: [0, 0.008, 0.3, 0.05], ft: 'lp', fc: 700, v: 0.5 * v },
  ];
}

/** Brushes on a snare: a soft swish. */
export function brush(decay = 0.12, v = 1): Layer[] {
  return [{ w: 'pink', d: 0.02, env: [0.008, 0.02, 0.6, decay], ft: 'bp', fc: 3200, q: 0.8, v }];
}

/** Old-console drums, made of square waves and short noise. */
export function chipKick(v = 1): Layer[] {
  return [{ w: 'square', f: 220, f2: 42, g: 0.07, c: 0.6, d: 0.05, env: [0.0005, 0.05, 0.6, 0.06], v: 0.9 * v }];
}
export function chipSnare(decay = 0.1, v = 1): Layer[] {
  return [
    { w: 'noise', d: 0.01, env: [0, 0.01, 0.7, decay], ft: 'bp', fc: 2600, q: 0.6, v: 0.9 * v },
    { w: 'square', f: 330, f2: 180, d: 0.02, env: [0, 0.02, 0.3, 0.02], v: 0.3 * v },
  ];
}
export function chipHat(decay = 0.03, v = 1): Layer[] {
  return [{ w: 'noise', d: 0.003, env: [0, 0.003, 0.7, decay], ft: 'hp', fc: 7000, v: 0.6 * v }];
}

// -----------------------------------------------------------------------------
// Instruments: (frequency Hz, held seconds, velocity 0..1) -> layers
// -----------------------------------------------------------------------------

export type Patch = (f: number, d: number, v: number) => Layer[];

const perc = (decay: number, rel = decay): Env => [0.002, decay, 0, rel];

const patches = {
  // ---- basses ----
  subBass: (f, d, v) => [{ w: 'sine', f, d, fm: [1, 0.9, 0.2], env: [0.004, 0.25, 0.75, 0.07], v: 0.95 * v }],
  sawBass: (f, d, v) => [
    { w: 'saw', f, d, env: [0.004, 0.2, 0.65, 0.06], ft: 'lp', fc: 500 + 1900 * v, fc2: 260, fg: 0.22, q: 1.8, v: 0.75 * v },
    { w: 'sine', f, d, env: [0.004, 0.1, 0.85, 0.06], v: 0.55 * v },
  ],
  squareBass: (f, d, v) => [{ w: 'square', f, d, pw: 0.5, env: [0.002, 0.08, 0.75, 0.03], ft: 'lp', fc: 2400, v: 0.6 * v }],
  triBass: (f, d, v) => [{ w: 'triangle', f, d, env: [0.002, 0.06, 0.85, 0.03], v: 0.95 * v }],
  pluckBass: (f, d, v) => [
    { w: 'pluck', f, d: d + 0.25, br: 0.3, env: [0.001, 0.3, 0.8, 0.12], ft: 'lp', fc: 1500, v: 0.9 * v },
    { w: 'sine', f, d, env: [0.004, 0.3, 0.4, 0.1], v: 0.45 * v },
  ],
  fmBass: (f, d, v) => [{ w: 'sine', f, d, fm: [1, 2.6 + 2 * v, 0.5], env: [0.002, 0.18, 0.55, 0.05], v: 0.85 * v }],
  acidBass: (f, d, v) => [{ w: 'saw', f, d, env: [0.003, 0.12, 0.6, 0.04], ft: 'lp', fc: 300 + 2600 * v, fc2: 220, fg: 0.16, q: 7, drv: 0.25, v: 0.7 * v }],
  tuba: (f, d, v) => [{ w: 'saw', f, d, env: [0.025, 0.1, 0.8, 0.07], ft: 'lp', fc: 380 + 300 * v, q: 1.1, v: 0.95 * v }, { w: 'sine', f, d, env: [0.02, 0.1, 0.8, 0.07], v: 0.4 * v }],
  growlBass: (f, d, v) => [{ w: 'saw', f, d, uni: 3, det: 22, env: [0.004, 0.1, 0.8, 0.05], ft: 'lp', fc: 900 + 900 * v, q: 2.2, drv: 0.5, v: 0.7 * v }, { w: 'square', f: f / 2, d, env: [0.004, 0.1, 0.8, 0.05], ft: 'lp', fc: 300, v: 0.4 * v }],

  // ---- chords ----
  pad: (f, d, v) => [{ w: 'saw', f, d, uni: 3, det: 20, env: [0.22, 0.4, 0.8, 0.5], ft: 'lp', fc: 900 + 1100 * v, q: 0.8, v: 0.55 * v }],
  warmPad: (f, d, v) => [{ w: 'triangle', f, d, uni: 3, det: 14, env: [0.3, 0.4, 0.85, 0.7], ft: 'lp', fc: 1400, v: 0.7 * v }, { w: 'sine', f: f * 2, d, env: [0.4, 0.4, 0.5, 0.7], v: 0.12 * v }],
  glassPad: (f, d, v) => [{ w: 'sine', f, d, uni: 3, det: 10, fm: [2, 0.9, 0.5], env: [0.35, 0.5, 0.8, 0.9], v: 0.6 * v }, { w: 'sine', f: f * 3.01, d, env: [0.5, 0.5, 0.4, 0.9], v: 0.07 * v }],
  strings: (f, d, v) => [{ w: 'saw', f, d, uni: 3, det: 16, vib: [5.2, 0.12, 0.25], env: [0.09, 0.2, 0.85, 0.22], ft: 'lp', fc: 1800 + 1500 * v, v: 0.55 * v }],
  choir: (f, d, v) => [
    { w: 'saw', f, d, uni: 3, det: 18, vib: [4.8, 0.1, 0.3], env: [0.18, 0.3, 0.85, 0.4], ft: 'bp', fc: 650, q: 2.2, v: 0.8 * v },
    { w: 'saw', f, d, env: [0.2, 0.3, 0.8, 0.4], ft: 'bp', fc: 1150, q: 3.5, v: 0.35 * v },
  ],
  epiano: (f, d, v) => [
    { w: 'sine', f, d, fm: [1, 1.4 + v, 0.15], env: [0.003, 0.9, 0.25, 0.25], v: 0.7 * v },
    { w: 'sine', f, d: Math.min(d, 0.08), fm: [14, 0.9 * v, 0], env: [0.001, 0.08, 0, 0.08], v: 0.22 * v },
  ],
  organ: (f, d, v) => [
    { w: 'sine', f, d, env: [0.006, 0.05, 0.92, 0.05], v: 0.55 * v },
    { w: 'sine', f: f * 2, d, env: [0.006, 0.05, 0.9, 0.05], v: 0.3 * v },
    { w: 'sine', f: f * 3, d, env: [0.006, 0.05, 0.85, 0.05], v: 0.16 * v },
    { w: 'sine', f: f * 4, d, env: [0.006, 0.05, 0.8, 0.05], v: 0.08 * v },
  ],
  piano: (f, d, v) => [
    { w: 'pluck', f, d: d + 0.5, br: 0.45 + 0.3 * v, env: [0.001, 0.8, 0.5, 0.25], v: 0.8 * v },
    { w: 'sine', f, d, fm: [1, 0.8, 0.1], env: [0.002, 0.7, 0.2, 0.2], v: 0.35 * v },
  ],
  guitar: (f, d, v) => [{ w: 'pluck', f, d: d + 0.35, br: 0.62, env: [0.001, 0.5, 0.7, 0.2], v: 0.9 * v }],
  nylon: (f, d, v) => [{ w: 'pluck', f, d: d + 0.3, br: 0.4, env: [0.001, 0.5, 0.7, 0.2], ft: 'lp', fc: 3200, v: 0.95 * v }],
  powerGuitar: (f, d, v) => [
    { w: 'saw', f, d, uni: 2, det: 9, env: [0.004, 0.2, 0.8, 0.06], drv: 0.85, ft: 'lp', fc: 2600, q: 1.3, v: 0.5 * v },
    { w: 'square', f: f / 2, d, pw: 0.4, env: [0.004, 0.2, 0.8, 0.06], drv: 0.6, ft: 'lp', fc: 1300, v: 0.3 * v },
  ],
  brass: (f, d, v) => [{ w: 'saw', f, d, uni: 2, det: 7, vib: [5.4, 0.1, 0.3], env: [0.03, 0.15, 0.8, 0.09], ft: 'lp', fc: 500, fc2: 1400 + 2200 * v, fg: 0.07, q: 1.2, v: 0.7 * v }],
  chipChord: (f, d, v) => [{ w: 'square', f, d, pw: 0.25, env: [0.002, 0.05, 0.7, 0.03], v: 0.42 * v }],
  harp: (f, d, v) => [{ w: 'pluck', f, d: d + 0.8, br: 0.75, env: [0.001, 1, 0.6, 0.5], v: 0.9 * v }],
  accordion: (f, d, v) => [
    { w: 'square', f, d, pw: 0.32, env: [0.03, 0.1, 0.85, 0.07], ft: 'lp', fc: 2600, v: 0.4 * v },
    { w: 'saw', f: f * 1.004, d, env: [0.03, 0.1, 0.85, 0.07], ft: 'lp', fc: 3000, v: 0.3 * v },
  ],
  stab: (f, d, v) => [{ w: 'saw', f, d: Math.min(d, 0.14), uni: 3, det: 16, env: [0.002, 0.12, 0.3, 0.08], ft: 'lp', fc: 3800, fc2: 900, fg: 0.12, q: 1.5, v: 0.55 * v }],

  // ---- bells and mallets ----
  musicBox: (f, _d, v) => [
    { w: 'sine', f, d: 0.02, fm: [5.41, 1.6 * v, 0], env: [0.001, 0.02, 0.9, 1.1], v: 0.7 * v },
    { w: 'sine', f: f * 2.01, d: 0.01, env: [0.001, 0.01, 0.7, 0.35], v: 0.18 * v },
  ],
  bell: (f, _d, v) => [
    { w: 'sine', f, d: 0.02, fm: [3.5, 2.4 * v, 0.2], env: [0.001, 0.02, 0.9, 1.6], v: 0.6 * v },
    { w: 'sine', f: f * 2.76, d: 0.02, env: [0.001, 0.02, 0.8, 0.7], v: 0.15 * v },
  ],
  glock: (f, _d, v) => [
    { w: 'sine', f, d: 0.01, env: [0.001, 0.01, 0.9, 0.9], v: 0.7 * v },
    { w: 'sine', f: f * 2.76, d: 0.01, env: [0.001, 0.01, 0.8, 0.3], v: 0.22 * v },
    { w: 'sine', f: f * 5.4, d: 0.005, env: [0.001, 0.005, 0.7, 0.1], v: 0.12 * v },
  ],
  marimba: (f, _d, v) => [
    { w: 'sine', f, d: 0.015, env: [0.001, 0.015, 0.85, 0.32], v: 0.85 * v },
    { w: 'sine', f: f * 3.93, d: 0.006, env: [0.001, 0.006, 0.6, 0.06], v: 0.3 * v },
    { w: 'noise', d: 0.002, env: [0, 0.002, 0.3, 0.008], ft: 'bp', fc: 2200, v: 0.15 * v },
  ],
  xylophone: (f, _d, v) => [
    { w: 'sine', f, d: 0.01, env: [0.001, 0.01, 0.85, 0.2], v: 0.8 * v },
    { w: 'sine', f: f * 3, d: 0.006, env: [0.001, 0.006, 0.6, 0.07], v: 0.35 * v },
    { w: 'noise', d: 0.002, env: [0, 0.002, 0.3, 0.006], ft: 'bp', fc: 3500, v: 0.2 * v },
  ],
  steelDrum: (f, _d, v) => [
    { w: 'sine', f, d: 0.03, fm: [2, 1.6 * v, 0.3], env: [0.002, 0.03, 0.8, 0.5], v: 0.7 * v },
    { w: 'sine', f: f * 2.01, d: 0.03, fm: [1.5, 0.8, 0], env: [0.002, 0.03, 0.6, 0.25], v: 0.25 * v },
  ],
  kalimba: (f, _d, v) => [
    { w: 'sine', f, d: 0.01, fm: [1, 0.5, 0], env: [0.001, 0.01, 0.9, 0.6], v: 0.8 * v },
    { w: 'sine', f: f * 5.9, d: 0.004, env: [0.001, 0.004, 0.6, 0.05], v: 0.2 * v },
  ],
  pizz: (f, _d, v) => [{ w: 'pluck', f, d: 0.12, br: 0.35, env: [0.001, 0.12, 0.6, 0.12], ft: 'lp', fc: 2600, v: 0.95 * v }],
  banjo: (f, _d, v) => [{ w: 'pluck', f, d: 0.25, br: 0.95, env: [0.001, 0.25, 0.5, 0.15], ft: 'hp', fc: 250, v: 0.9 * v }],
  koto: (f, d, v) => [{ w: 'pluck', f: f * 0.985, f2: f, d: d + 0.5, br: 0.85, env: [0.001, 0.6, 0.6, 0.35], v: 0.9 * v }, { w: 'sine', f, d: 0.02, fm: [3, 1, 0], env: [0.001, 0.02, 0.5, 0.12], v: 0.2 * v }],

  // ---- leads ----
  squareLead: (f, d, v) => [{ w: 'square', f, d, pw: 0.5, vib: [5.5, 0.18, 0.18], env: [0.004, 0.08, 0.78, 0.05], v: 0.5 * v }],
  pulseLead: (f, d, v) => [{ w: 'square', f, d, pw: 0.22, vib: [5.5, 0.15, 0.2], env: [0.003, 0.08, 0.75, 0.05], v: 0.5 * v }],
  sawLead: (f, d, v) => [{ w: 'saw', f, d, uni: 2, det: 12, vib: [5.5, 0.15, 0.2], env: [0.006, 0.1, 0.78, 0.07], ft: 'lp', fc: 2400 + 2200 * v, q: 1.2, v: 0.55 * v }],
  synthPluck: (f, d, v) => [{ w: 'saw', f, d: Math.min(d, 0.2), uni: 2, det: 8, env: [0.002, 0.2, 0.15, 0.15], ft: 'lp', fc: 5000, fc2: 600, fg: 0.16, q: 1.6, v: 0.6 * v }],
  flute: (f, d, v) => [
    { w: 'sine', f, d, vib: [5, 0.14, 0.2], env: [0.045, 0.1, 0.88, 0.09], v: 0.75 * v },
    { w: 'sine', f: f * 2, d, env: [0.05, 0.1, 0.6, 0.08], v: 0.12 * v },
    { w: 'pink', d, env: [0.02, 0.08, 0.35, 0.06], ft: 'bp', fc: f * 2, q: 1.5, v: 0.25 * v },
  ],
  whistle: (f, d, v) => [
    { w: 'sine', f: f * 0.97, f2: f, g: 0.04, d, vib: [6, 0.2, 0.12], env: [0.02, 0.08, 0.9, 0.06], v: 0.8 * v },
    { w: 'noise', d, env: [0.02, 0.06, 0.25, 0.05], ft: 'bp', fc: f, q: 6, v: 0.25 * v },
  ],
  ocarina: (f, d, v) => [
    { w: 'triangle', f, d, vib: [5.2, 0.12, 0.2], env: [0.03, 0.08, 0.9, 0.08], ft: 'lp', fc: f * 3, v: 0.8 * v },
    { w: 'pink', d: Math.min(d, 0.06), env: [0.01, 0.05, 0, 0.03], ft: 'bp', fc: f * 2, q: 2, v: 0.2 * v },
  ],
  trumpet: (f, d, v) => [{ w: 'saw', f, d, vib: [5.6, 0.14, 0.25], env: [0.02, 0.1, 0.85, 0.07], ft: 'lp', fc: 700, fc2: 2000 + 2600 * v, fg: 0.05, q: 1.6, v: 0.7 * v }],
  violin: (f, d, v) => [{ w: 'saw', f, d, vib: [5.8, 0.22, 0.14], env: [0.06, 0.1, 0.9, 0.12], ft: 'lp', fc: 2600 + 1200 * v, q: 1.4, v: 0.65 * v }],
  theremin: (f, d, v) => [{ w: 'sine', f: f * 0.94, f2: f, g: 0.09, d, vib: [5.6, 0.38, 0.1], fm: [1, 0.25, 0.25], env: [0.07, 0.1, 0.9, 0.18], v: 0.8 * v }],
  harmonica: (f, d, v) => [
    { w: 'square', f, d, pw: 0.3, vib: [5.5, 0.1, 0.25], env: [0.03, 0.1, 0.85, 0.08], ft: 'bp', fc: 1700, q: 1, v: 0.75 * v },
    { w: 'saw', f: f * 1.003, d, env: [0.03, 0.1, 0.8, 0.08], ft: 'lp', fc: 2500, v: 0.2 * v },
  ],
  oboe: (f, d, v) => [{ w: 'square', f, d, pw: 0.16, vib: [5.5, 0.16, 0.18], env: [0.03, 0.08, 0.88, 0.07], ft: 'bp', fc: 1300, q: 1.1, v: 0.9 * v }],
  calliope: (f, d, v) => [
    { w: 'sine', f, d, trem: [6.5, 0.2], env: [0.012, 0.05, 0.9, 0.05], v: 0.6 * v },
    { w: 'square', f: f * 2, d, env: [0.012, 0.05, 0.8, 0.05], ft: 'lp', fc: 3500, v: 0.14 * v },
    { w: 'noise', d: Math.min(d, 0.04), env: [0.002, 0.04, 0, 0.02], ft: 'bp', fc: f * 3, q: 2, v: 0.25 * v },
  ],
  clarinet: (f, d, v) => [{ w: 'square', f, d, pw: 0.5, vib: [5, 0.08, 0.3], env: [0.03, 0.08, 0.88, 0.07], ft: 'lp', fc: 1500 + 800 * v, v: 0.6 * v }],
  bassoon: (f, d, v) => [{ w: 'square', f, d, pw: 0.3, env: [0.02, 0.06, 0.8, 0.05], ft: 'lp', fc: 900, q: 1.5, v: 0.8 * v }],
} satisfies Record<string, Patch>;

export type PatchName = keyof typeof patches;
export const PATCHES: Record<PatchName, Patch> = patches;

/** Modal sound (bells, bars, glass): sine partials [ratio, level, decay scale] that ring out. */
export function modal(f: number, decay: number, parts: ReadonlyArray<readonly [number, number, number]>, v = 1, t = 0): Layer[] {
  return parts.map(([ratio, level, scale]) => ({ w: 'sine' as const, t, f: f * ratio, d: 0.006, env: [0.001, 0.006, 0.9, decay * scale] as Env, v: level * v }));
}

export const BELL_PARTS = [[0.5, 0.25, 1], [1, 1, 0.9], [1.19, 0.5, 0.8], [1.56, 0.35, 0.6], [2, 0.5, 0.7], [2.51, 0.3, 0.5], [2.66, 0.25, 0.4], [3.01, 0.2, 0.3], [4.1, 0.15, 0.25]] as const;
export const CHIME_PARTS = [[1, 1, 1], [2.76, 0.5, 0.55], [5.4, 0.3, 0.3], [8.93, 0.15, 0.15]] as const;
export const GLASS_PARTS = [[1, 1, 1], [2.32, 0.45, 0.6], [4.25, 0.3, 0.35], [6.63, 0.2, 0.2]] as const;
export const GONG_PARTS = [[1, 1, 1], [1.37, 0.7, 0.9], [1.63, 0.5, 0.8], [2.09, 0.6, 0.7], [2.71, 0.4, 0.6], [3.17, 0.35, 0.5], [3.9, 0.3, 0.4], [4.7, 0.22, 0.3], [5.83, 0.15, 0.22]] as const;

export { perc };
