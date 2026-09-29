/**
 * Paints the pieces of a stand-in character: one strip per bone (its silhouette part, if any, plus the
 * bone line and star-joints), drawn in the bone's own frame so the puppet only has to rotate them. Each
 * strip holds GHOST_STYLE.phases copies side by side, one per dash phase, for the marching outline.
 */
import type { ArtSpec } from '../spec';
import { mix } from '../color';
import { hash } from '../util';
import { GHOST_STYLE, newCanvas, OUTLINE_REACH, paintBone, paintSilhouette, type GhostShape } from './paint';
import { solve, templateFor, type BoneDef, type Template } from './templates';

export interface PaintedPart {
  bone: string;
  /** `frames` pictures side by side, each `frameWidth` wide. */
  canvas: HTMLCanvasElement;
  frameWidth: number;
  frames: number;
  /** The joint's position in one frame, 0..1 (the image origin). */
  originX: number;
  originY: number;
  depth: number;
}

const FLIPPED: ReadonlySet<GhostShape> = new Set<GhostShape>(['dome', 'wing', 'fin']);

function paintFrame(ctx: CanvasRenderingContext2D, spec: ArtSpec, bone: BoneDef, scale: number, jx: number, jy: number, phase: number): void {
  const part = bone.part;
  if (part) {
    const color = bone.far ? mix(spec.color, 0x08091e, 0.3) : spec.color;
    const cx = jx + part.cx * scale;
    const cy = jy + part.cy * scale;
    ctx.save();
    if (FLIPPED.has(part.shape)) {
      ctx.translate(0, cy * 2);
      ctx.scale(1, -1);
    }
    paintSilhouette(ctx, part.shape, cx, cy, part.w * scale, part.h * scale, color, scale, hash(spec.key + bone.name), phase);
    ctx.restore();
  }
  if (bone.length > 0) paintBone(ctx, jx, jy, jx, jy + bone.length * scale, scale, bone.end ? 'both' : 'start');
}

export function paintPart(spec: ArtSpec, bone: BoneDef, scale: number, frames: number = GHOST_STYLE.phases): PaintedPart | null {
  const part = bone.part;
  if (!part && bone.length <= 0) return null;
  const margin = OUTLINE_REACH + GHOST_STYLE.jointRadius + 2;
  let x0 = -margin;
  let x1 = margin;
  let y0 = -margin;
  let y1 = bone.length + margin;
  if (part) {
    x0 = Math.min(x0, part.cx - part.w / 2 - margin);
    x1 = Math.max(x1, part.cx + part.w / 2 + margin);
    y0 = Math.min(y0, part.cy - part.h / 2 - margin);
    y1 = Math.max(y1, part.cy + part.h / 2 + margin);
  }
  const fw = Math.ceil((x1 - x0) * scale);
  const fh = Math.ceil((y1 - y0) * scale);
  const n = part ? frames : 1;
  const { canvas, ctx } = newCanvas(fw * n, fh);
  const jx = -x0 * scale;
  const jy = -y0 * scale;
  for (let i = 0; i < n; i++) {
    ctx.save();
    ctx.translate(i * fw, 0);
    ctx.beginPath();
    ctx.rect(0, 0, fw, fh);
    ctx.clip();
    paintFrame(ctx, spec, bone, scale, jx, jy, i);
    ctx.restore();
  }
  return { bone: bone.name, canvas, frameWidth: fw, frames: n, originX: jx / fw, originY: jy / fh, depth: bone.depth };
}

export function paintParts(spec: ArtSpec, template: Template, scale: number, frames: number = GHOST_STYLE.phases): PaintedPart[] {
  const out: PaintedPart[] = [];
  for (const b of template.bones) {
    const p = paintPart(spec, b, scale, frames);
    if (p) out.push(p);
  }
  return out.sort((a, b) => a.depth - b.depth);
}

/** The whole stand-in character in its rest pose, as one picture exactly w x h (for plain Phaser use). */
export function paintCharacter(spec: ArtSpec, scale: number): HTMLCanvasElement {
  const template = templateFor(spec.rig, spec.w, spec.h);
  const parts = paintParts(spec, template, scale, 1);
  const world = solve(template, {});
  const { canvas, ctx } = newCanvas(spec.w * scale, spec.h * scale);
  // Rest poses reach a little past the box (outlines, star-joints): shrink to keep it all inside.
  const k = 0.9;
  ctx.translate((spec.w * scale) / 2, spec.h * scale);
  ctx.scale(k, k);
  ctx.translate(-(spec.w * scale) / 2, -spec.h * scale * 0.02);
  for (const p of parts) {
    const j = world.get(p.bone);
    if (!j) continue;
    ctx.save();
    ctx.translate((spec.w / 2 + j.x) * scale, j.y * scale);
    ctx.rotate(j.angle);
    ctx.drawImage(p.canvas, 0, 0, p.frameWidth, p.canvas.height, -p.originX * p.frameWidth, -p.originY * p.canvas.height, p.frameWidth, p.canvas.height);
    ctx.restore();
  }
  return canvas;
}
