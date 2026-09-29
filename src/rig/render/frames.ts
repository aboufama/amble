/**
 * A clip as still frames: filmstrips for walk strips and thumbnails, contact sheets for reviewing every
 * move of a drawing. The clip is simulated with the real runtime (springs included, travelling when it
 * is a walk or a run) and every frame shares one scale and anchor, so frames line up.
 */
import { resolveClip, clipsFor } from '../clips/library';
import { RigPuppet } from '../runtime/puppet';
import type { AnimTweak, BoundRig } from '../types';
import { context2d, drawVertices, makeCanvas, vertexBounds, type AnyCanvas, type Ctx2D } from './canvas';
import { bonePointsOf, drawBones, type BonesStyle } from './bones';

export interface ClipFrameOptions {
  /** Frames per loop, or across a one-shot. Default 8. */
  frames?: number;
  /** Cell height in px (default 128). The drawing is scaled to fit the whole clip in it. */
  size?: number;
  /** Art px → frame px; overrides `size`. */
  scale?: number;
  /** Padding around the drawing in every cell (px, default 6). */
  pad?: number;
  /** Which way to face (default: as drawn). */
  face?: 1 | -1;
  /** Bouncy/Speedy for this clip. */
  tweak?: AnimTweak;
  /** Move the character while it walks or runs, so springs trail and wheels roll (default true). */
  travel?: boolean;
  /** Draw the bones over each frame. */
  bones?: boolean | BonesStyle;
  /** Tint the parts ("Show pieces"). */
  pieces?: boolean;
  /** Cell background (default transparent). */
  background?: string | null;
}

/** A clip's frames with where the anchor sits in each (all frames share scale and anchor). */
export interface ClipStrip {
  clip: string;
  loop: boolean;
  /** Seconds per loop or of the one-shot. */
  dur: number;
  /** Playback rate that shows the frames at the clip's real speed. */
  fps: number;
  frames: AnyCanvas[];
  width: number;
  height: number;
  anchorX: number;
  anchorY: number;
  scale: number;
}

/** A clip recorded as frames of skinned vertices and bone points (anchor-relative art px). */
export interface ClipSamples {
  clip: string;
  loop: boolean;
  dur: number;
  verts: Float32Array[];
  bones: Float32Array[];
  flash: number[];
  alpha: number[];
}
type Sim = ClipSamples;

const TRAVEL: Record<string, number> = { walk: 1.2, run: 3.2 };

/** Runs a clip on a fresh puppet and records `n` frames of skinned vertices and bone points. */
export function sampleClip(bound: BoundRig, name: string, n: number, opts: ClipFrameOptions = {}): ClipSamples | null {
  const clip = resolveClip(bound.rig.kind, name);
  if (!clip) return null;
  const p = new RigPuppet(bound);
  if (opts.tweak) p.animator.setTweaks({ ...(bound.rig.anims ?? {}), [clip.name]: opts.tweak });
  const facing: 1 | -1 = opts.face ?? (bound.rig.facing === -1 ? -1 : 1);
  p.face(facing);
  const v = opts.travel === false ? 0 : (TRAVEL[clip.name] ?? 0) * p.skeleton.height;
  const step = 1 / 60;
  const advance = (dt: number) => {
    let left = dt;
    while (left > 1e-6) {
      const h = Math.min(step, left);
      p.update(h, v ? { dx: v * h * facing } : {});
      left -= h;
    }
  };
  // settle the turn and the springs, then start the clip from its first frame
  advance(0.25);
  p.play(clip.name, { fade: 0, loop: clip.loop });
  const rate = opts.tweak?.speed ?? bound.rig.anims?.[clip.name]?.speed ?? 1;
  const dur = clip.dur / rate;
  if (clip.loop) advance(dur);
  const sim: Sim = { clip: clip.name, loop: clip.loop, dur, verts: [], bones: [], flash: [], alpha: [] };
  let t = 0;
  for (let k = 0; k < n; k++) {
    const target = clip.loop ? (k * dur) / n : Math.min(dur - 1e-3, (k * dur) / Math.max(1, n - 1));
    advance(target - t);
    t = target;
    sim.verts.push(Float32Array.from(p.vertices!));
    sim.bones.push(bonePointsOf(p.skeleton, p.flip));
    sim.flash.push(p.pose.flash);
    sim.alpha.push(p.pose.alpha);
  }
  return sim;
}

export function unionBounds(sims: ClipSamples[]): { x0: number; y0: number; x1: number; y1: number } {
  const u = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  for (const s of sims) for (const v of s.verts) {
    const b = vertexBounds(v);
    u.x0 = Math.min(u.x0, b.x0);
    u.y0 = Math.min(u.y0, b.y0);
    u.x1 = Math.max(u.x1, b.x1);
    u.y1 = Math.max(u.y1, b.y1);
  }
  return u;
}

function drawFrame(ctx: Ctx2D, bound: BoundRig, s: Sim, k: number, x: number, y: number, scale: number, opts: ClipFrameOptions): void {
  drawVertices(ctx, bound, s.verts[k], {
    x,
    y,
    scale,
    alpha: s.alpha[k],
    tint: s.flash[k] > 0.5 ? '#ffffff' : null,
    pieces: opts.pieces,
  });
  if (opts.bones) {
    const style = typeof opts.bones === 'object' ? opts.bones : {};
    drawBones(ctx, bound.rig, s.bones[k], { look: 'stars', width: 1.5, joint: 2, glow: 0, ...style, x, y, scale });
  }
}

/**
 * Renders a clip's frames, one canvas each. Loops give `frames` evenly spaced frames of one cycle
 * (after a cycle of warm-up); one-shots give frames from the start to the end.
 */
export function renderClipFrames(bound: BoundRig, clip: string, opts: ClipFrameOptions = {}): ClipStrip | null {
  const n = Math.max(1, Math.round(opts.frames ?? 8));
  const sim = sampleClip(bound, clip, n, opts);
  if (!sim) return null;
  const pad = opts.pad ?? 6;
  const u = unionBounds([sim]);
  const size = opts.size ?? 128;
  const scale = opts.scale ?? (size - 2 * pad) / Math.max(1, u.y1 - u.y0);
  const width = Math.ceil((u.x1 - u.x0) * scale + 2 * pad), height = Math.ceil((u.y1 - u.y0) * scale + 2 * pad);
  const anchorX = pad - u.x0 * scale, anchorY = pad - u.y0 * scale;
  const frames: AnyCanvas[] = [];
  for (let k = 0; k < n; k++) {
    const c = makeCanvas(width, height);
    const ctx = context2d(c);
    if (opts.background) {
      ctx.fillStyle = opts.background;
      ctx.fillRect(0, 0, width, height);
    }
    drawFrame(ctx, bound, sim, k, anchorX, anchorY, scale, opts);
    frames.push(c);
  }
  return { clip: sim.clip, loop: sim.loop, dur: sim.dur, fps: n / sim.dur, frames, width, height, anchorX, anchorY, scale };
}

/** The frames side by side on one canvas (a spritesheet row), e.g. for caching a walk strip. */
export function packStrip(strip: ClipStrip): AnyCanvas {
  const c = makeCanvas(strip.width * strip.frames.length, strip.height);
  const ctx = context2d(c);
  strip.frames.forEach((f, i) => ctx.drawImage(f, i * strip.width, 0));
  return c;
}

export interface ContactSheetOptions extends ClipFrameOptions {
  /** Clips to show, one row each (default: every clip of the kind). */
  clips?: string[];
  /** Width of the label column (px, default 72; 0 hides the labels). */
  label?: number;
  /** Label and grid colours. */
  ink?: string;
  grid?: string;
  /** A title line above the rows. */
  title?: string;
}

/** Every clip (or `opts.clips`) as rows of frames on one canvas, all at one scale. */
export function renderContactSheet(bound: BoundRig, opts: ContactSheetOptions = {}): AnyCanvas {
  const n = Math.max(1, Math.round(opts.frames ?? 8));
  const names = opts.clips ?? clipsFor(bound.rig.kind);
  const sims = names.map((c) => sampleClip(bound, c, n, opts)).filter((s): s is Sim => !!s);
  const pad = opts.pad ?? 6;
  const size = opts.size ?? 96;
  const u = unionBounds(sims.length ? sims : []);
  if (!Number.isFinite(u.x0)) return makeCanvas(1, 1);
  const scale = opts.scale ?? (size - 2 * pad) / Math.max(1, u.y1 - u.y0);
  const cw = Math.ceil((u.x1 - u.x0) * scale + 2 * pad), ch = Math.ceil((u.y1 - u.y0) * scale + 2 * pad);
  const lw = opts.label ?? 72;
  const th = opts.title ? 22 : 0;
  const c = makeCanvas(lw + cw * n, th + ch * sims.length);
  const ctx = context2d(c);
  if (opts.background) {
    ctx.fillStyle = opts.background;
    ctx.fillRect(0, 0, c.width, c.height);
  }
  const ink = opts.ink ?? '#221b2e';
  ctx.font = '600 12px sans-serif';
  ctx.textBaseline = 'middle';
  if (opts.title) {
    ctx.fillStyle = ink;
    ctx.fillText(opts.title, 6, th / 2);
  }
  sims.forEach((s, r) => {
    const y0 = th + r * ch;
    if (lw) {
      ctx.fillStyle = ink;
      ctx.fillText(s.clip, 6, y0 + ch / 2);
    }
    if (opts.grid) {
      ctx.strokeStyle = opts.grid;
      ctx.lineWidth = 1;
      ctx.strokeRect(0.5, y0 + 0.5, c.width - 1, ch - 1);
    }
    for (let k = 0; k < s.verts.length; k++) {
      const x0 = lw + k * cw;
      drawFrame(ctx, bound, s, k, x0 + pad - u.x0 * scale, y0 + pad - u.y0 * scale, scale, opts);
    }
  });
  return c;
}
