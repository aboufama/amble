/** Clips for blobs: jiggle, hop (walk and run), a big jump, lunge, melt. The top bone lags. */
import type { Pose } from '../runtime/pose';
import { clamp01, D, ease, TAU, wobble, type Clip, type ClipCtx } from './ctx';

const idle: Clip = {
  name: 'idle', loop: true, dur: 1.8,
  fn(c, t, p) {
    const b = Math.sin((TAU * t) / this.dur);
    c.squash(p, 1 + 0.045 * b, 1 - 0.045 * b);
    c.rot(p, 'top', 3.5 * Math.sin((TAU * t) / this.dur + 0.8));
    c.rot(p, 'body', 1.5 * Math.sin((TAU * t) / (this.dur * 2)));
  },
};

function hop(c: ClipCtx, u: number, p: Pose, height: number, lean: number): void {
  if (u < 0.22) {
    const k = Math.sin((Math.PI * u) / 0.22 / 2);
    c.squash(p, 1 + 0.18 * k, 1 - 0.22 * k);
    c.rot(p, 'top', -6 * k);
  } else if (u < 0.78) {
    const a = (u - 0.22) / 0.56;
    p.gy = -height * c.H * Math.sin(Math.PI * a) * c.amount;
    const st = 0.16 * Math.pow(1 - a, 2);
    c.squash(p, 1 - st * 0.7, 1 + st);
    p.pivotY = -0.5 * c.H;
    p.grot = lean * Math.sin(Math.PI * a) * D * c.dir;
    c.rot(p, 'top', 10 * Math.cos(Math.PI * a));
  } else {
    const k = (u - 0.78) / 0.22;
    const wv = wobble(k * 0.6, 14, 4);
    c.squash(p, 1 + 0.17 * wv, 1 - 0.2 * wv);
    c.rot(p, 'top', -8 * wv);
  }
}

const walk: Clip = { name: 'walk', loop: true, dur: 0.75, gait: true, fn(c, t, p) { hop(c, (t % this.dur) / this.dur, p, 0.22, 8); } };
const run: Clip = { name: 'run', loop: true, dur: 0.5, gait: true, fn(c, t, p) { hop(c, (t % this.dur) / this.dur, p, 0.3, 14); } };
const jump: Clip = { name: 'jump', loop: false, dur: 1.1, fn(c, t, p) { hop(c, t / this.dur, p, 0.7, 0); } };

const attack: Clip = {
  name: 'attack', loop: false, dur: 0.5,
  fn(c, t, p) {
    const gather = ease(clamp01(t / 0.18)) * (1 - ease(clamp01((t - 0.18) / 0.06)));
    const lunge = t < 0.18 ? 0 : ease(clamp01((t - 0.18) / 0.07)) * (1 - ease(clamp01((t - 0.3) / 0.2)));
    c.squash(p, 1 - 0.12 * gather + 0.25 * lunge, 1 + 0.12 * gather - 0.15 * lunge);
    p.gx = (-0.05 * gather + 0.14 * lunge) * c.H * c.dir;
    p.grot = (-6 * gather + 10 * lunge) * D * c.dir;
    c.rot(p, 'top', 10 * gather - 14 * lunge);
  },
};

const die: Clip = {
  name: 'die', loop: false, dur: 1.2, hold: true,
  fn(c, t, p) {
    // melt into a puddle
    p.flash = t < 0.1 ? 1 : 0;
    const u = ease(clamp01((t - 0.1) / 0.7));
    const wv = t > 0.8 ? wobble(t - 0.8, 14, 6) * 0.1 : 0;
    p.gsx = 1 + 0.6 * u + wv;
    p.gsy = 1 - 0.72 * u - wv;
    c.rot(p, 'top', 20 * u);
    p.alpha = 1 - clamp01((t - 0.85) / 0.35);
  },
};

const win: Clip = {
  name: 'win', loop: true, dur: 0.55,
  fn(c, t, p) {
    hop(c, t / this.dur, p, 0.28, 0);
    c.rot(p, 'top', 8 * Math.sin((TAU * t) / this.dur));
  },
};

export const BLOB_CLIPS: Clip[] = [idle, walk, run, jump, attack, die, win];
