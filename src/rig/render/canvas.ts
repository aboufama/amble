/**
 * Canvas 2D rendering of a rigged drawing, for UI previews and thumbnails without Phaser: each
 * triangle is clipped (grown by half a pixel so neighbours overlap and no seams show) and drawn from
 * the part atlas through its own affine transform.
 */
import type { BoundRig, Pixels } from '../types';
import type { Pose } from '../runtime/pose';
import type { RigPuppet } from '../runtime/puppet';
import { Skeleton, skinVertices } from '../runtime/skeleton';

export type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
export type AnyCanvas = HTMLCanvasElement | OffscreenCanvas;

/** A canvas in the current context: an OffscreenCanvas when available (workers), else a DOM canvas. */
export function makeCanvas(w: number, h: number): AnyCanvas {
  const W = Math.max(1, Math.ceil(w)), H = Math.max(1, Math.ceil(h));
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(W, H);
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  return c;
}

export function context2d(c: AnyCanvas): Ctx2D {
  const ctx = c.getContext('2d') as Ctx2D | null;
  if (!ctx) throw new Error('Canvas 2D is not available');
  return ctx;
}

/** Pixels onto a canvas. */
export function pixelsToCanvas(p: Pixels, canvas?: AnyCanvas): AnyCanvas {
  const c = canvas ?? makeCanvas(p.width, p.height);
  const data = new Uint8ClampedArray(p.data.buffer as ArrayBuffer, p.data.byteOffset, p.width * p.height * 4);
  context2d(c).putImageData(new ImageData(data, p.width, p.height), 0, 0);
  return c;
}

const atlasCache = new WeakMap<Pixels, AnyCanvas>();

/** The part atlas as a canvas (made once per atlas, so views of one bound rig share it). */
export function atlasCanvas(bound: BoundRig): AnyCanvas {
  let c = atlasCache.get(bound.atlas);
  if (!c) atlasCache.set(bound.atlas, (c = pixelsToCanvas(bound.atlas)));
  return c;
}

export interface DrawOptions {
  /** Where the anchor (the feet) goes on the canvas, before `scale`. Default (0, 0). */
  x?: number;
  y?: number;
  /** Art px → canvas px. Default 1. */
  scale?: number;
  /** Extra horizontal mirror (-1). The puppet's own flip is already in its vertices. */
  flip?: number;
  alpha?: number;
  /** Solid colour over the whole character (a hurt flash), with its strength 0..1. */
  tint?: string | null;
  tintAmount?: number;
  /** Debug: the triangle edges. */
  wireframe?: boolean;
  /** "Show pieces": tint every part in its own colour. */
  pieces?: boolean;
}

const PIECE_COLOURS = ['#e6194b', '#3cb44b', '#4363d8', '#f58231', '#911eb4', '#42d4f4', '#f032e6', '#9a6324', '#469990', '#808000'];

/**
 * Draws skinned vertices (anchor-relative art px) with the rig's atlas. The core of every Canvas 2D
 * path; `drawRigged` and `drawPuppet` feed it.
 */
export function drawVertices(ctx: Ctx2D, bound: BoundRig, verts: Float32Array, opts: DrawOptions = {}): void {
  const k = opts.scale ?? 1, f = opts.flip ?? 1;
  const ox = opts.x ?? 0, oy = opts.y ?? 0;
  const tintAmount = opts.tint ? opts.tintAmount ?? 1 : 0;
  if (tintAmount > 0 || opts.pieces) {
    drawTinted(ctx, bound, verts, opts);
    return;
  }
  const atlas = atlasCanvas(bound);
  const { uvs, indices } = bound;
  const AW = bound.atlas.width, AH = bound.atlas.height;
  const base = ctx.getTransform();
  ctx.save();
  ctx.globalAlpha *= opts.alpha ?? 1;
  ctx.imageSmoothingEnabled = true;
  for (let t = 0; t < indices.length; t += 3) {
    const i0 = indices[t], i1 = indices[t + 1], i2 = indices[t + 2];
    const x0 = ox + verts[2 * i0] * k * f, y0 = oy + verts[2 * i0 + 1] * k;
    const x1 = ox + verts[2 * i1] * k * f, y1 = oy + verts[2 * i1 + 1] * k;
    const x2 = ox + verts[2 * i2] * k * f, y2 = oy + verts[2 * i2 + 1] * k;
    const u0 = uvs[2 * i0] * AW, v0 = uvs[2 * i0 + 1] * AH;
    const u1 = uvs[2 * i1] * AW, v1 = uvs[2 * i1 + 1] * AH;
    const u2 = uvs[2 * i2] * AW, v2 = uvs[2 * i2 + 1] * AH;
    // affine map from atlas px to canvas px
    const den = (u1 - u0) * (v2 - v0) - (u2 - u0) * (v1 - v0);
    if (Math.abs(den) < 1e-9) continue;
    const a = ((x1 - x0) * (v2 - v0) - (x2 - x0) * (v1 - v0)) / den;
    const b = ((y1 - y0) * (v2 - v0) - (y2 - y0) * (v1 - v0)) / den;
    const c = ((x2 - x0) * (u1 - u0) - (x1 - x0) * (u2 - u0)) / den;
    const d = ((y2 - y0) * (u1 - u0) - (y1 - y0) * (u2 - u0)) / den;
    const e = x0 - a * u0 - c * v0;
    const g = y0 - b * u0 - d * v0;
    // grow the clip triangle by ~0.6 px about its centre so neighbours overlap
    const mx = (x0 + x1 + x2) / 3, my = (y0 + y1 + y2) / 3;
    const grow = (x: number, y: number): [number, number] => {
      const dx = x - mx, dy = y - my, l = Math.hypot(dx, dy) || 1;
      return [x + (dx / l) * 0.6, y + (dy / l) * 0.6];
    };
    const [px0, py0] = grow(x0, y0), [px1, py1] = grow(x1, y1), [px2, py2] = grow(x2, y2);
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(px0, py0);
    ctx.lineTo(px1, py1);
    ctx.lineTo(px2, py2);
    ctx.closePath();
    ctx.clip();
    ctx.setTransform(base);
    ctx.transform(a, b, c, d, e, g);
    const sx = Math.max(0, Math.floor(Math.min(u0, u1, u2)) - 1), sy = Math.max(0, Math.floor(Math.min(v0, v1, v2)) - 1);
    const sw = Math.min(AW - sx, Math.ceil(Math.max(u0, u1, u2)) + 1 - sx), sh = Math.min(AH - sy, Math.ceil(Math.max(v0, v1, v2)) + 1 - sy);
    if (sw > 0 && sh > 0) ctx.drawImage(atlas, sx, sy, sw, sh, sx, sy, sw, sh);
    ctx.restore();
  }
  if (opts.wireframe) {
    ctx.strokeStyle = 'rgba(30, 60, 200, 0.45)';
    ctx.lineWidth = 0.75;
    ctx.beginPath();
    for (let t = 0; t < indices.length; t += 3) {
      const i0 = indices[t], i1 = indices[t + 1], i2 = indices[t + 2];
      ctx.moveTo(ox + verts[2 * i0] * k * f, oy + verts[2 * i0 + 1] * k);
      ctx.lineTo(ox + verts[2 * i1] * k * f, oy + verts[2 * i1 + 1] * k);
      ctx.lineTo(ox + verts[2 * i2] * k * f, oy + verts[2 * i2 + 1] * k);
      ctx.closePath();
    }
    ctx.stroke();
  }
  ctx.restore();
}

/** Bounds of skinned vertices (anchor-relative art px). */
export function vertexBounds(verts: Float32Array): { x0: number; y0: number; x1: number; y1: number } {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < verts.length; i += 2) {
    x0 = Math.min(x0, verts[i]);
    x1 = Math.max(x1, verts[i]);
    y0 = Math.min(y0, verts[i + 1]);
    y1 = Math.max(y1, verts[i + 1]);
  }
  return { x0, y0, x1, y1 };
}

/** Tinted drawing (hurt flash, "Show pieces"): drawn on a scratch canvas, coloured, then composited. */
function drawTinted(ctx: Ctx2D, bound: BoundRig, verts: Float32Array, opts: DrawOptions): void {
  const k = opts.scale ?? 1, f = opts.flip ?? 1;
  const b = vertexBounds(verts);
  const pad = 2;
  const x0 = Math.min(b.x0 * f, b.x1 * f) * k - pad, y0 = b.y0 * k - pad;
  const w = Math.abs(b.x1 - b.x0) * k + 2 * pad, h = (b.y1 - b.y0) * k + 2 * pad;
  const scratch = makeCanvas(w, h);
  const sctx = context2d(scratch);
  const inner: DrawOptions = { ...opts, x: -x0, y: -y0, tint: null, pieces: false, alpha: 1 };
  if (opts.pieces) {
    for (const pr of bound.partRanges) {
      const part = makeCanvas(w, h);
      const pctx = context2d(part);
      drawVertices(pctx, { ...bound, indices: bound.indices.subarray(pr.first * 3, (pr.first + pr.count) * 3) }, verts, inner);
      pctx.globalCompositeOperation = 'source-atop';
      pctx.globalAlpha = 0.45;
      pctx.fillStyle = PIECE_COLOURS[bound.partRanges.indexOf(pr) % PIECE_COLOURS.length];
      pctx.fillRect(0, 0, w, h);
      sctx.drawImage(part, 0, 0);
    }
  } else drawVertices(sctx, bound, verts, inner);
  if (opts.tint && (opts.tintAmount ?? 1) > 0) {
    sctx.globalCompositeOperation = 'source-atop';
    sctx.globalAlpha = opts.tintAmount ?? 1;
    sctx.fillStyle = opts.tint;
    sctx.fillRect(0, 0, w, h);
  }
  ctx.save();
  ctx.globalAlpha *= opts.alpha ?? 1;
  ctx.drawImage(scratch, (opts.x ?? 0) + x0, (opts.y ?? 0) + y0);
  ctx.restore();
}

const still = new WeakMap<BoundRig, { sk: Skeleton; verts: Float32Array }>();

/**
 * Draws a rig in a pose (no springs, no animation state): thumbnails, the rest pose, a frozen frame.
 * Pass `pose` null for the drawing as drawn.
 */
export function drawRigged(ctx: Ctx2D, bound: BoundRig, pose: Pose | null, opts: DrawOptions = {}): void {
  let s = still.get(bound);
  if (!s) still.set(bound, (s = { sk: new Skeleton(bound.rig), verts: new Float32Array(bound.rest.length) }));
  if (pose) s.sk.solve(pose, 0, 0, 0, false);
  else {
    const P = s.sk.n;
    const K = s.sk.K;
    for (let i = 0; i < P; i++) K.set([1, 0, 0, 1, 0, 0], i * 6);
  }
  skinVertices(s.sk, bound, s.verts);
  drawVertices(ctx, bound, s.verts, {
    ...opts,
    alpha: (opts.alpha ?? 1) * (pose?.alpha ?? 1),
    tint: opts.tint ?? (pose && pose.flash > 0.5 ? '#ffffff' : null),
  });
}

/** Draws a puppet as it is now (after `puppet.update`), including its flash and fade. */
export function drawPuppet(ctx: Ctx2D, puppet: RigPuppet, opts: DrawOptions = {}): void {
  if (!puppet.bound || !puppet.vertices) return;
  drawVertices(ctx, puppet.bound, puppet.vertices, {
    ...opts,
    alpha: (opts.alpha ?? 1) * puppet.pose.alpha,
    tint: opts.tint ?? (puppet.pose.flash > 0.5 ? '#ffffff' : null),
  });
}
