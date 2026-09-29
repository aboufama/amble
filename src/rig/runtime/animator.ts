/**
 * Plays procedural clips on a skeleton: one base clip crossfading from the previous one (0.2 s
 * smoothstep; walk ↔ run keep their phase so feet don't pop), one-shots that return to what was
 * playing, and upper-body overlays (attack, shoot, hurt, wave play on the arms, spine and head over
 * running legs). Applies the student's Bouncy/Speedy tweaks and caps big arm raises on flat drawings,
 * which would expose a torso side nobody drew.
 */
import { resolveClip } from '../clips/library';
import { ClipCtx, D, clamp01, ease, type Clip } from '../clips/ctx';
import type { AnimTweak, CharacterKind } from '../types';
import { Pose } from './pose';
import type { Skeleton } from './skeleton';

export interface PlayOptions {
  /** Override the clip's own looping. */
  loop?: boolean;
  /** Playback rate multiplier. */
  speed?: number;
  /** Crossfade seconds (default 0.2). */
  fade?: number;
}

interface Layer {
  clip: Clip;
  t: number;
  loop: boolean;
  rate: number;
  /** Fading out: seconds since it began, and how long it takes. */
  out?: { t: number; dur: number };
}

const UPPER_ROLES = new Set(['spine', 'neck', 'head', 'armL1', 'armL2', 'armR1', 'armR2', 'wingL1', 'wingL2', 'wingR1', 'wingR2']);
const LOCOMOTION = new Set(['walk', 'run', 'rise', 'fall', 'fly', 'swim', 'glide']);

export interface AnimatorOptions {
  /** Parts were cut from a flat drawing: arm raises are capped at 45°. */
  flat?: boolean;
  /** Per-clip tweaks (`RigData.anims`). */
  tweaks?: Record<string, AnimTweak>;
}

export class Animator {
  readonly ctx: ClipCtx;
  /** Global playback rate (follow() sets it from speed so feet don't slide). */
  speed = 1;
  onDone?: (clip: string) => void;
  private base: Layer;
  private prev: Layer | null = null;
  private fadeT = 0;
  private fadeDur = 0.2;
  private overlay: Layer | null = null;
  private returnTo = 'idle';
  private readonly tmp: Pose;
  private readonly tmp2: Pose;
  private readonly upperMask: Uint8Array;
  private readonly armCap: number;
  private tweaks: Record<string, AnimTweak>;

  constructor(readonly sk: Skeleton, readonly kind: CharacterKind, opts: AnimatorOptions = {}) {
    this.ctx = new ClipCtx(sk);
    this.tmp = new Pose(sk.n);
    this.tmp2 = new Pose(sk.n);
    this.tweaks = opts.tweaks ?? {};
    this.armCap = (opts.flat ?? true) ? 45 * D : 150 * D;
    this.ctx.armCap = this.armCap / D;
    const idle = resolveClip(kind, 'idle')!;
    this.base = { clip: idle, t: 0, loop: true, rate: 1 };
    // upper body: those roles and everything hanging off them (a held wand, an antenna)
    const bones = sk.rig.bones;
    this.upperMask = new Uint8Array(sk.n);
    bones.forEach((b, i) => {
      const inherited = b.parent >= 0 && this.upperMask[b.parent] === 1 && b.role !== 'hips';
      if (UPPER_ROLES.has(b.role) || inherited) this.upperMask[i] = 1;
    });
  }

  setTweaks(tweaks: Record<string, AnimTweak> | undefined): void {
    this.tweaks = tweaks ?? {};
  }

  /** The clip the character is visibly doing (an overlay wins over the legs). */
  get current(): string {
    return this.overlay?.clip.name ?? this.base.clip.name;
  }

  /** The base (whole-body) clip. */
  get baseClip(): string {
    return this.base.clip.name;
  }

  /** A whole-body one-shot (jump, land, attack while standing...) is still playing. */
  get busy(): boolean {
    return !this.base.loop && this.base.t < this.base.clip.dur;
  }

  has(name: string): boolean {
    return resolveClip(this.kind, name) !== null;
  }

  /** Plays a clip by name or alias. Returns false for a clip this kind doesn't have (or turned off). */
  play(name: string, opts: PlayOptions = {}): boolean {
    const clip = resolveClip(this.kind, name);
    if (!clip || this.tweaks[clip.name]?.off) return false;
    const loop = opts.loop ?? clip.loop;
    const rate = opts.speed ?? 1;
    const fade = opts.fade ?? 0.2;
    if (clip.upper && !loop && this.base.loop && LOCOMOTION.has(this.base.clip.name)) {
      this.overlay = { clip, t: 0, loop: false, rate };
      return true;
    }
    if (clip === this.base.clip && loop && this.base.loop) {
      this.base.rate = rate;
      return true;
    }
    let t = 0;
    const cur = this.base;
    if (clip.gait && cur.clip.gait && cur.loop) t = ((cur.t % cur.clip.dur) / cur.clip.dur) * clip.dur;
    if (!loop && cur.loop) this.returnTo = cur.clip.name;
    else if (loop) this.returnTo = clip.name;
    this.prev = fade > 0 ? cur : null;
    this.fadeT = 0;
    this.fadeDur = fade;
    this.base = { clip, t, loop, rate };
    // an arm move over the legs fades out with the switch instead of snapping away
    const o = this.overlay;
    if (o && !clip.upper && !o.out) {
      if (fade > 0) o.out = { t: 0, dur: Math.min(0.15, fade) };
      else this.overlay = null;
    }
    return true;
  }

  private tweak(c: Clip): AnimTweak {
    return this.tweaks[c.name] ?? {};
  }

  private evaluate(layer: Layer, out: Pose): void {
    const tw = this.tweak(layer.clip);
    this.ctx.amount = tw.amount ?? 1;
    const c = layer.clip;
    const t = layer.loop ? layer.t % c.dur : Math.min(layer.t, c.dur);
    c.fn(this.ctx, t, out);
    this.ctx.amount = 1;
  }

  private advance(layer: Layer, dt: number): void {
    layer.t += dt * layer.rate * this.speed * (this.tweak(layer.clip).speed ?? 1);
  }

  update(dt: number, out: Pose): void {
    this.advance(this.base, dt);
    const b = this.base;
    if (!b.loop && b.t >= b.clip.dur && !b.clip.hold) {
      const done = b.clip.name;
      b.t = b.clip.dur;
      const back = b.clip.next ?? this.returnTo;
      if (!this.play(back, { fade: 0.15 })) this.play('idle', { fade: 0.15 });
      this.onDone?.(done);
    }
    out.reset();
    this.evaluate(this.base, out);
    if (this.prev) {
      this.fadeT += dt;
      const k = this.fadeDur > 0 ? ease(clamp01(this.fadeT / this.fadeDur)) : 1;
      if (k >= 1) this.prev = null;
      else {
        this.advance(this.prev, dt);
        this.tmp.reset();
        this.evaluate(this.prev, this.tmp);
        out.blendFrom(this.tmp, k);
      }
    }
    const o = this.overlay;
    if (o) {
      this.advance(o, dt);
      if (o.out) o.out.t += dt;
      if (o.t >= o.clip.dur || (o.out && o.out.t >= o.out.dur)) {
        this.overlay = null;
        this.onDone?.(o.clip.name);
      } else {
        this.tmp2.reset();
        this.evaluate(o, this.tmp2);
        let w = Math.min(ease(clamp01(o.t / 0.06)), ease(clamp01((o.clip.dur - o.t) / 0.1)));
        if (o.out) w *= 1 - ease(clamp01(o.out.t / o.out.dur));
        const m = this.upperMask;
        for (let i = 0; i < out.n; i++) {
          if (!m[i]) continue;
          out.rot[i] += (this.tmp2.rot[i] - out.rot[i]) * w;
          out.dx[i] += (this.tmp2.dx[i] - out.dx[i]) * w;
          out.dy[i] += (this.tmp2.dy[i] - out.dy[i]) * w;
          out.sx[i] += (this.tmp2.sx[i] - out.sx[i]) * w;
          out.sy[i] += (this.tmp2.sy[i] - out.sy[i]) * w;
        }
        out.flash = Math.max(out.flash, this.tmp2.flash);
      }
    }
    this.capArms(out);
  }

  /**
   * On flat drawings a raised arm shows a torso side nobody drew: cap the raise. And no arm swings up
   * past nearly straight up, so an arm drawn raised (holding a wand) never sweeps across the face.
   */
  private capArms(out: Pose): void {
    for (const role of ['armL1', 'armR1']) {
      const i = this.sk.role(role);
      if (i < 0) continue;
      const up = this.sk.up[i];
      // how far the drawn arm already is from hanging straight down
      const a = this.sk.restA[i] - Math.PI / 2;
      const elev = Math.abs(Math.atan2(Math.sin(a), Math.cos(a)));
      const cap = Math.max(0, Math.min(this.armCap, 165 * D - elev));
      if (out.rot[i] * up > cap) out.rot[i] = cap * up;
    }
  }

  /** Jumps a clip to time t (seconds), without crossfade: for previews and contact sheets. */
  seek(t: number): void {
    this.base.t = t;
    this.prev = null;
    this.overlay = null;
  }
}
