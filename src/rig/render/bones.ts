/**
 * Draws a skeleton on a Canvas 2D context in two looks:
 * - 'stars': the constellation that stands for bones everywhere in Amble (glowing lines, star joints),
 *   used by "just bones" figures and guides;
 * - 'diagram': the Bones view's tapered bones, screen-left side striped, screen-right side dotted,
 *   the middle plain, with L/R lettered joints, so colour is never the only cue.
 * Points are anchor-relative art px (x0, y0, x1, y1 per bone), as `bonePointsOf` gives them.
 */
import type { Skeleton } from '../runtime/skeleton';
import type { RigData } from '../types';
import type { Ctx2D } from './canvas';

export type Side = 'L' | 'R' | 'C';

export interface BonesStyle {
  /** Where the anchor goes on the canvas, before `scale`. */
  x?: number;
  y?: number;
  /** Art px → canvas px. */
  scale?: number;
  look?: 'stars' | 'diagram';
  /** Colours of the screen-left side, the screen-right side and the middle. */
  left?: string;
  right?: string;
  centre?: string;
  /** Line width (stars) or the widest bone width cap (diagram), canvas px. */
  width?: number;
  /** Joint radius, canvas px. */
  joint?: number;
  /** L/R letters in the joints (diagram look). */
  letters?: boolean;
  /** Blurred glow behind the lines. */
  glow?: number;
  /** A dashed ground line through the anchor with a marker under it. */
  ground?: boolean;
  alpha?: number;
}

export const BONE_COLOURS = { left: '#86f3cb', right: '#ffc15e', centre: '#f4ecdc' } as const;

/** Which side a bone is on: by its role (armL1, legFR2...), else by where its tip is. */
export function boneSide(rig: RigData, i: number, pts?: Float32Array): Side {
  const b = rig.bones[i];
  const m = /([LR])\d$/.exec(b.role === 'extra' ? '' : b.role);
  if (m) return m[1] as Side;
  const tipX = pts ? pts[i * 4 + 2] : b.x2 - rig.anchor[0];
  const w = Math.abs(pts ? pts[i * 4 + 2] - pts[i * 4] : b.x2 - b.x);
  if (w < 2) return 'C';
  return tipX < 0 ? 'L' : 'R';
}

/** Bone joints and tips (anchor-relative art px) of a solved skeleton, mirrored by `flip`. */
export function bonePointsOf(sk: Skeleton, flip = 1, out = new Float32Array(sk.n * 4)): Float32Array {
  for (let i = 0; i < sk.n; i++) {
    const [x1, y1, x2, y2] = sk.bonePoints(i);
    out[i * 4] = x1 * flip;
    out[i * 4 + 1] = y1;
    out[i * 4 + 2] = x2 * flip;
    out[i * 4 + 3] = y2;
  }
  return out;
}

/** The bones as drawn (rest pose), anchor-relative. */
export function restBonePoints(rig: RigData): Float32Array {
  const out = new Float32Array(rig.bones.length * 4);
  const [ax, ay] = rig.anchor;
  rig.bones.forEach((b, i) => out.set([b.x - ax, b.y - ay, b.x2 - ax, b.y2 - ay], i * 4));
  return out;
}

interface Joint {
  x: number;
  y: number;
  side: Side;
  tip: boolean;
}

/** One joint per bone start (merged where bones share it) plus the tips of bones with no children. */
export function jointsOf(rig: RigData, pts: Float32Array): Joint[] {
  const joints: Joint[] = [];
  const add = (x: number, y: number, side: Side, tip: boolean) => {
    const near = joints.find((j) => Math.hypot(j.x - x, j.y - y) < 0.75);
    if (near) {
      if (near.side === 'C') near.side = side;
      near.tip &&= tip;
    } else joints.push({ x, y, side, tip });
  };
  const hasChild = new Uint8Array(rig.bones.length);
  rig.bones.forEach((b) => {
    if (b.parent >= 0) hasChild[b.parent] = 1;
  });
  rig.bones.forEach((_b, i) => {
    const s = boneSide(rig, i, pts);
    add(pts[i * 4], pts[i * 4 + 1], s, false);
    if (!hasChild[i]) add(pts[i * 4 + 2], pts[i * 4 + 3], s, true);
  });
  return joints;
}

const patterns = new WeakMap<object, Map<string, CanvasPattern | null>>();

function patternFor(ctx: Ctx2D, kind: 'stripes' | 'dots', colour: string): CanvasPattern | null {
  let m = patterns.get(ctx);
  if (!m) patterns.set(ctx, (m = new Map()));
  const key = kind + colour;
  if (m.has(key)) return m.get(key)!;
  let p: CanvasPattern | null = null;
  const size = 8;
  const tile = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(size, size) : Object.assign(document.createElement('canvas'), { width: size, height: size });
  const t = tile.getContext('2d') as Ctx2D | null;
  if (t) {
    t.fillStyle = colour;
    t.fillRect(0, 0, size, size);
    t.fillStyle = 'rgba(34, 27, 46, 0.45)';
    if (kind === 'stripes') {
      t.beginPath();
      t.moveTo(0, size * 0.6);
      t.lineTo(size * 0.6, 0);
      t.lineTo(size, 0);
      t.lineTo(size, size * 0.1);
      t.lineTo(size * 0.1, size);
      t.lineTo(0, size);
      t.closePath();
      t.fill();
    } else {
      t.beginPath();
      t.arc(size / 2, size / 2, 1.4, 0, Math.PI * 2);
      t.fill();
    }
    p = ctx.createPattern(tile, 'repeat');
  }
  m.set(key, p);
  return p;
}

/** Draws bones from their points (anchor-relative art px). */
export function drawBones(ctx: Ctx2D, rig: RigData, pts: Float32Array, style: BonesStyle = {}): void {
  const k = style.scale ?? 1, ox = style.x ?? 0, oy = style.y ?? 0;
  const look = style.look ?? 'stars';
  const col = { L: style.left ?? BONE_COLOURS.left, R: style.right ?? BONE_COLOURS.right, C: style.centre ?? BONE_COLOURS.centre };
  const X = (v: number) => ox + v * k, Y = (v: number) => oy + v * k;
  const n = rig.bones.length;
  const sides = Array.from({ length: n }, (_, i) => boneSide(rig, i, pts));
  ctx.save();
  ctx.globalAlpha *= style.alpha ?? 1;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (style.ground) {
    ctx.save();
    ctx.strokeStyle = col.R;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 4]);
    let x0 = Infinity, x1 = -Infinity;
    for (let i = 0; i < n; i++) {
      x0 = Math.min(x0, pts[i * 4], pts[i * 4 + 2]);
      x1 = Math.max(x1, pts[i * 4], pts[i * 4 + 2]);
    }
    const pad = Math.max(8, (x1 - x0) * 0.25);
    ctx.beginPath();
    ctx.moveTo(X(x0 - pad), Y(0));
    ctx.lineTo(X(x1 + pad), Y(0));
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = col.R;
    ctx.beginPath();
    ctx.moveTo(X(0), Y(0) + 4);
    ctx.lineTo(X(0) - 5, Y(0) + 11);
    ctx.lineTo(X(0) + 5, Y(0) + 11);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
  const order = [...Array(n).keys()].sort((a, b) => (sides[a] === 'C' ? 1 : 0) - (sides[b] === 'C' ? 1 : 0));
  if (look === 'stars') {
    const lw = style.width ?? 2;
    ctx.lineWidth = lw;
    if (style.glow ?? 6) {
      ctx.shadowBlur = style.glow ?? 6;
    }
    for (const i of order) {
      ctx.strokeStyle = col[sides[i]];
      ctx.shadowColor = col[sides[i]];
      ctx.beginPath();
      ctx.moveTo(X(pts[i * 4]), Y(pts[i * 4 + 1]));
      ctx.lineTo(X(pts[i * 4 + 2]), Y(pts[i * 4 + 3]));
      ctx.stroke();
    }
    const r = style.joint ?? 3;
    for (const j of jointsOf(rig, pts)) {
      ctx.fillStyle = col[j.side];
      ctx.shadowColor = col[j.side];
      star(ctx, X(j.x), Y(j.y), j.tip ? r * 0.8 : r);
    }
  } else {
    const cap = style.width ?? 14;
    for (const i of order) {
      const x1 = X(pts[i * 4]), y1 = Y(pts[i * 4 + 1]), x2 = X(pts[i * 4 + 2]), y2 = Y(pts[i * 4 + 3]);
      const len = Math.hypot(x2 - x1, y2 - y1);
      if (len < 1) continue;
      const ux = (x2 - x1) / len, uy = (y2 - y1) / len;
      const w = Math.min(cap, Math.max(3, len * 0.2)) / 2;
      const mx = x1 + ux * len * 0.18, my = y1 + uy * len * 0.18;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(mx - uy * w, my + ux * w);
      ctx.lineTo(x2, y2);
      ctx.lineTo(mx + uy * w, my - ux * w);
      ctx.closePath();
      const s = sides[i];
      ctx.fillStyle = s === 'C' ? col.C : patternFor(ctx, s === 'L' ? 'stripes' : 'dots', col[s]) ?? col[s];
      ctx.fill();
      ctx.strokeStyle = 'rgba(34, 27, 46, 0.8)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    const r = style.joint ?? 7;
    const font = Math.max(7, Math.round(r * 1.1));
    for (const j of jointsOf(rig, pts)) {
      const cx = X(j.x), cy = Y(j.y);
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fillStyle = '#fdf8ec';
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = '#221b2e';
      ctx.stroke();
      if ((style.letters ?? true) && j.side !== 'C' && r >= 5) {
        ctx.fillStyle = '#221b2e';
        ctx.font = `700 ${font}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(j.side, cx, cy + 0.5);
      }
    }
  }
  ctx.restore();
}

function star(ctx: Ctx2D, x: number, y: number, r: number): void {
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4 - Math.PI / 2;
    const rr = i % 2 === 0 ? r * 1.6 : r * 0.55;
    const px = x + Math.cos(a) * rr, py = y + Math.sin(a) * rr;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.arc(x, y, r * 0.7, 0, Math.PI * 2);
  ctx.fill();
}
