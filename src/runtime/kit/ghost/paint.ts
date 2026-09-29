/**
 * Stand-ins ("just bones") for art the student has not drawn yet. The owner's rule: human art is the star,
 * so a stand-in must read clearly in play (right size, animated, role colour) and look plainly unfinished:
 * - a flat silhouette in the role tint at 55 %, with white pencil hatching (38°, 9 px apart, 28 %);
 * - a dashed cream outline (2.4 px, 7 on / 6 off) over a 5.5 px dark halo, so it reads on any background;
 * - characters: the kind's bones on top (2 px mint bones, mint star-joints);
 * - a paper name tag with a pencil badge ("✎ GRUMBLE · draw me").
 * Never eyes, faces, shading, highlights or texture. Projectiles are glowing energy dots (an effect, not
 * art). Everything is painted once per key into canvases (dash phases included), never per frame.
 */
import type { ArtSpec } from '../spec';
import { cssColor, mix, rgba } from '../color';
import { hash, seeded, TAU } from '../util';

export const INK = 0x221b2e;
export const PAPER = '#fdf8ec';
export const PAPER_LINE = '#8c7b5a';
export const OUTLINE = '#f4ecdc';
export const HALO = 'rgba(8,9,30,0.55)';
export const MINT = '#86f3cb';
export const TAG_FONT = '"Atkinson Hyperlegible Next", "Atkinson Hyperlegible", "Fredoka", system-ui, sans-serif';

/** The look, in game px (painted at `scale`). */
export const GHOST_STYLE = {
  fillAlpha: 0.55,
  hatchAngle: 38,
  hatchGap: 9,
  hatchWidth: 1.4,
  hatchAlpha: 0.28,
  outlineWidth: 2.4,
  dash: 7,
  gap: 6,
  halo: 5.5,
  boneWidth: 2,
  jointRadius: 3,
  boneAlpha: 0.85,
  /** How fast the dashes march (px/s); still under reduced motion. */
  march: 20,
  /** Dash phases painted per stand-in part (the marching animation cycles through them). */
  phases: 4,
} as const;

/** The dash offset of phase `i` (game px). */
export function dashOffset(i: number): number {
  return -((GHOST_STYLE.dash + GHOST_STYLE.gap) * i) / GHOST_STYLE.phases;
}

export type GhostShape = 'box' | 'ellipse' | 'capsule' | 'diamond' | 'star' | 'heart' | 'coin' | 'tile' | 'circle' | 'dome' | 'wing' | 'fin' | 'roundbox';

/** How far a stand-in's painted outline reaches past its shape (game px). */
export const OUTLINE_REACH = GHOST_STYLE.halo / 2 + 1;

export function newCanvas(w: number, h: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.ceil(w));
  canvas.height = Math.max(1, Math.ceil(h));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('No 2D canvas');
  return { canvas, ctx };
}

/** Traces a shape centred at (cx, cy) filling a w x h box. `wobble` (0..1) makes big outlines slightly hand-made. */
export function traceShape(ctx: CanvasRenderingContext2D, shape: GhostShape, cx: number, cy: number, w: number, h: number, seed = 1, wobble = 0): void {
  ctx.beginPath();
  const rw = w / 2;
  const rh = h / 2;
  if (shape === 'box' || shape === 'tile' || shape === 'roundbox') {
    const r = shape === 'roundbox' ? Math.min(rw, rh) * 0.45 : Math.min(rw, rh) * 0.22;
    ctx.roundRect(cx - rw, cy - rh, w, h, r);
    return;
  }
  if (shape === 'capsule') {
    ctx.roundRect(cx - rw, cy - rh, w, h, Math.min(rw, rh));
    return;
  }
  if (shape === 'circle' || shape === 'coin' || (shape === 'ellipse' && wobble <= 0)) {
    ctx.ellipse(cx, cy, rw, rh, 0, 0, TAU);
    return;
  }
  const r = seeded(seed);
  const ph = r() * TAU;
  const amp = wobble * 0.025;
  const wob = (t: number) => 1 + amp * Math.sin(t * 3 + ph) + amp * 0.6 * Math.sin(t * 5 + ph * 2);
  const pts: Array<[number, number]> = [];
  if (shape === 'star') {
    for (let i = 0; i < 10; i++) {
      const t = (i / 10) * TAU - Math.PI / 2;
      const k = i % 2 ? 0.46 : 1;
      pts.push([cx + Math.cos(t) * rw * k, cy + Math.sin(t) * rh * k]);
    }
  } else if (shape === 'diamond') {
    pts.push([cx, cy - rh], [cx + rw, cy], [cx, cy + rh], [cx - rw, cy]);
  } else if (shape === 'heart') {
    for (let i = 0; i < 48; i++) {
      const t = (i / 48) * TAU;
      const x = 16 * Math.pow(Math.sin(t), 3);
      const y = -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t));
      pts.push([cx + (x / 17) * rw, cy + (y / 16) * rh + rh * 0.08]);
    }
  } else if (shape === 'dome') {
    // A gumdrop: round top, flat-ish bottom (blobs).
    for (let i = 0; i <= 40; i++) {
      const t = Math.PI + (i / 40) * Math.PI;
      pts.push([cx + Math.cos(t) * rw * wob(t), cy + rh * 0.25 + Math.sin(t) * rh * 1.25 * wob(t)]);
    }
    pts.push([cx + rw * 0.92, cy + rh * 0.86], [cx + rw * 0.7, cy + rh], [cx - rw * 0.7, cy + rh], [cx - rw * 0.92, cy + rh * 0.86]);
  } else if (shape === 'wing') {
    // A leaf: the root at the bottom, the tip at the top.
    pts.push([cx - rw * 0.25, cy + rh], [cx - rw, cy - rh * 0.05], [cx - rw * 0.3, cy - rh], [cx + rw * 0.65, cy - rh * 0.6], [cx + rw * 0.45, cy + rh * 0.45]);
  } else if (shape === 'fin') {
    // A forked tail: attached at the bottom, the fork at the top.
    pts.push([cx, cy + rh], [cx - rw, cy - rh], [cx, cy - rh * 0.4], [cx + rw, cy - rh]);
  } else {
    for (let i = 0; i < 48; i++) {
      const t = (i / 48) * TAU;
      pts.push([cx + Math.cos(t) * rw * wob(t), cy + Math.sin(t) * rh * wob(t)]);
    }
  }
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (const [x, y] of pts.slice(1)) ctx.lineTo(x, y);
  ctx.closePath();
}

/** White pencil hatching over the current clip, in a w x h area at (x, y). */
function hatch(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, scale: number): void {
  const s = GHOST_STYLE;
  const a = (s.hatchAngle * Math.PI) / 180;
  const gap = s.hatchGap * scale;
  const len = Math.hypot(w, h);
  ctx.save();
  ctx.translate(x + w / 2, y + h / 2);
  ctx.rotate(-a);
  ctx.strokeStyle = `rgba(255,255,255,${s.hatchAlpha})`;
  ctx.lineWidth = s.hatchWidth * scale;
  ctx.lineCap = 'round';
  ctx.beginPath();
  for (let d = -len / 2; d <= len / 2; d += gap) {
    ctx.moveTo(-len / 2, d);
    ctx.lineTo(len / 2, d);
  }
  ctx.stroke();
  ctx.restore();
}

/** The fill of a stand-in shape: the role tint at 55 %, hatched. */
function fillGhost(ctx: CanvasRenderingContext2D, shape: GhostShape, cx: number, cy: number, w: number, h: number, color: number, scale: number, seed: number, wobble: number): void {
  ctx.save();
  traceShape(ctx, shape, cx, cy, w, h, seed, wobble);
  ctx.fillStyle = rgba(color, GHOST_STYLE.fillAlpha);
  ctx.fill();
  ctx.clip();
  hatch(ctx, cx - w / 2, cy - h / 2, w, h, scale);
  ctx.restore();
}

/** The outline: a dark halo, then cream dashes at dash phase `phase`. */
function outlineGhost(ctx: CanvasRenderingContext2D, shape: GhostShape, cx: number, cy: number, w: number, h: number, scale: number, seed: number, wobble: number, phase: number): void {
  const s = GHOST_STYLE;
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  traceShape(ctx, shape, cx, cy, w, h, seed, wobble);
  ctx.strokeStyle = HALO;
  ctx.lineWidth = s.halo * scale;
  ctx.stroke();
  ctx.setLineDash([s.dash * scale, s.gap * scale]);
  ctx.lineDashOffset = dashOffset(phase) * scale;
  ctx.lineCap = 'butt';
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = s.outlineWidth * scale;
  ctx.stroke();
  ctx.restore();
}

/** A whole stand-in shape: fill, hatching and outline. */
export function paintSilhouette(ctx: CanvasRenderingContext2D, shape: GhostShape, cx: number, cy: number, w: number, h: number, color: number, scale: number, seed = 1, phase = 0): void {
  const wobble = Math.min(w, h) / scale > 60 ? 1 : 0;
  fillGhost(ctx, shape, cx, cy, w, h, color, scale, seed, wobble);
  outlineGhost(ctx, shape, cx, cy, w, h, scale, seed, wobble, phase);
}

/** A four-point mint star (a joint), with a faint dark rim so it reads on light tints. */
function starJoint(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  const path = () => {
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const t = (i / 8) * TAU - Math.PI / 2;
      const k = i % 2 ? r * 0.38 : r;
      ctx.lineTo(x + Math.cos(t) * k, y + Math.sin(t) * k);
    }
    ctx.closePath();
  };
  path();
  ctx.lineJoin = 'round';
  ctx.strokeStyle = 'rgba(8,9,30,0.45)';
  ctx.lineWidth = r * 0.5;
  ctx.stroke();
  ctx.fillStyle = MINT;
  ctx.fill();
}

/** A bone: a 2 px mint line with star-joints, at 85 %. */
export function paintBone(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, scale: number, dots: 'start' | 'both' | 'none' = 'start'): void {
  const s = GHOST_STYLE;
  ctx.save();
  ctx.globalAlpha = s.boneAlpha;
  ctx.lineCap = 'round';
  ctx.strokeStyle = 'rgba(8,9,30,0.35)';
  ctx.lineWidth = (s.boneWidth + 1.4) * scale;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
  ctx.strokeStyle = MINT;
  ctx.lineWidth = s.boneWidth * scale;
  ctx.stroke();
  if (dots !== 'none') starJoint(ctx, x1, y1, s.jointRadius * scale * 1.15);
  if (dots === 'both') starJoint(ctx, x2, y2, s.jointRadius * scale);
  ctx.restore();
}

/** The pencil glyph, centred at (cx, cy), pointing down-left, `s` = glyph size. */
function pencil(ctx: CanvasRenderingContext2D, cx: number, cy: number, s: number, color: string): void {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(Math.PI / 4);
  const w = s * 0.32;
  const l = s;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(-w / 2, -l / 2);
  ctx.lineTo(w / 2, -l / 2);
  ctx.lineTo(w / 2, l / 2 - w * 0.95);
  ctx.lineTo(0, l / 2);
  ctx.lineTo(-w / 2, l / 2 - w * 0.95);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = PAPER;
  ctx.fillRect(-w / 2 + s * 0.04, -l / 2 + l * 0.2, w - s * 0.08, s * 0.07);
  ctx.restore();
}

/** The pencil "draw me" badge: a paper circle with an ink pencil. */
export function paintBadge(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy + r * 0.12, r * 1.08, 0, TAU);
  ctx.fillStyle = 'rgba(8,9,30,0.35)';
  ctx.fill();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, TAU);
  ctx.fillStyle = PAPER;
  ctx.fill();
  ctx.lineWidth = Math.max(1, r * 0.12);
  ctx.strokeStyle = PAPER_LINE;
  ctx.stroke();
  pencil(ctx, cx, cy, r * 1.3, cssColor(INK));
  ctx.restore();
}

/** The badge alone (other instances of a stand-in show only this). */
export function paintBadgeTexture(scale = 2): HTMLCanvasElement {
  const r = 7 * scale;
  const { canvas, ctx } = newCanvas(r * 2 + 4 * scale, r * 2 + 4 * scale);
  paintBadge(ctx, canvas.width / 2, canvas.height / 2 - scale, r);
  return canvas;
}

/**
 * The name tag above the first stand-in of a key: a paper chip with the pencil badge, the NAME and
 * "· draw me" (in exported pages, the name only). Painted at `scale` (2 = crisp when the stage is big).
 */
export function paintTag(name: string, scale = 2, withAsk = true): HTMLCanvasElement {
  const size = 11 * scale;
  const label = name.toUpperCase().slice(0, 22);
  const ask = withAsk ? ' · draw me' : '';
  const probe = newCanvas(1, 1).ctx;
  probe.font = `700 ${size}px ${TAG_FONT}`;
  const nameW = probe.measureText(label).width;
  probe.font = `600 ${size}px ${TAG_FONT}`;
  const askW = ask ? probe.measureText(ask).width : 0;
  const h = 20 * scale;
  const padX = 5 * scale;
  const badgeR = 6.5 * scale;
  const w = Math.ceil(padX + badgeR * 2 + 4 * scale + nameW + askW + padX + 2 * scale);
  const m = 3 * scale;
  const { canvas, ctx } = newCanvas(w + m * 2, h + m * 2);
  ctx.translate(m, m);
  ctx.beginPath();
  ctx.roundRect(0, scale, w, h, 5 * scale);
  ctx.fillStyle = 'rgba(8,9,30,0.4)';
  ctx.fill();
  ctx.beginPath();
  ctx.roundRect(0, 0, w, h, 5 * scale);
  ctx.fillStyle = PAPER;
  ctx.fill();
  ctx.lineWidth = scale;
  ctx.strokeStyle = PAPER_LINE;
  ctx.stroke();
  paintBadge(ctx, padX + badgeR, h / 2, badgeR);
  ctx.textBaseline = 'middle';
  const tx = padX + badgeR * 2 + 4 * scale;
  ctx.font = `700 ${size}px ${TAG_FONT}`;
  ctx.fillStyle = cssColor(INK);
  ctx.fillText(label, tx, h / 2 + 0.5 * scale);
  if (ask) {
    ctx.font = `600 ${size}px ${TAG_FONT}`;
    ctx.fillStyle = '#6a5d7a';
    ctx.fillText(ask, tx + nameW, h / 2 + 0.5 * scale);
  }
  return canvas;
}

function labelInside(ctx: CanvasRenderingContext2D, text: string, cx: number, cy: number, maxW: number, scale: number): void {
  const size = Math.max(9, Math.min(15, maxW / scale / (text.length * 0.62 + 1)));
  if (size < 9 || maxW / scale < 34) return;
  ctx.save();
  ctx.font = `700 ${size * scale}px ${TAG_FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 3.5 * scale;
  ctx.strokeStyle = 'rgba(8,9,30,0.7)';
  ctx.strokeText(text, cx, cy);
  ctx.fillStyle = OUTLINE;
  ctx.fillText(text, cx, cy);
  ctx.restore();
}

/** The shape a non-character stand-in uses. */
export function itemShape(spec: ArtSpec): GhostShape {
  if (spec.shape === 'tile') return 'box';
  return spec.shape;
}

/** A projectile until drawn: a glowing energy dot in its colour (an effect, never finished-looking art). */
function paintEnergy(spec: ArtSpec, scale: number): HTMLCanvasElement {
  const w = spec.w * scale;
  const h = spec.h * scale;
  const { canvas, ctx } = newCanvas(w, h);
  const r = Math.min(w, h) / 2;
  ctx.save();
  ctx.translate(w / 2, h / 2);
  ctx.scale(w / 2 / r, h / 2 / r);
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.28, 'rgba(255,255,255,0.95)');
  g.addColorStop(0.45, rgba(spec.color, 0.95));
  g.addColorStop(0.72, rgba(spec.color, 0.45));
  g.addColorStop(1, rgba(spec.color, 0));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, TAU);
  ctx.fill();
  ctx.restore();
  return canvas;
}

/**
 * A one-piece stand-in for items, props, projectiles and decor. The canvas is exactly (w, h) * scale, so a
 * sprite made from it has the art's in-game size.
 */
export function paintThing(spec: ArtSpec, scale: number, phase = 0): HTMLCanvasElement {
  if (spec.kind === 'projectile') return paintEnergy(spec, scale);
  const { canvas, ctx } = newCanvas(spec.w * scale, spec.h * scale);
  const w = spec.w * scale;
  const h = spec.h * scale;
  const shape = itemShape(spec);
  const minSide = Math.min(spec.w, spec.h);
  const inset = Math.min(OUTLINE_REACH, minSide * 0.12) * scale;
  paintSilhouette(ctx, shape, w / 2, h / 2, w - inset * 2, h - inset * 2, spec.color, scale, hash(spec.key), phase);
  if (spec.kind !== 'character' && minSide >= 34) labelInside(ctx, spec.name.toUpperCase(), w / 2, h / 2 + h * 0.04, (w - inset * 4) * 0.8, scale);
  // Big props wear the pencil badge; small things (coins, gems) would be covered by it.
  if (minSide >= 44) paintBadge(ctx, w - inset - 6 * scale, inset + 6 * scale, 5.5 * scale);
  return canvas;
}

/** Terrain until drawn: a hatched band in its colour. It tiles both ways (the dashed top edge is separate). */
export function paintTile(spec: ArtSpec, scale: number): HTMLCanvasElement {
  const w = Math.max(8, spec.w) * scale;
  const h = Math.max(8, spec.h) * scale;
  const { canvas, ctx } = newCanvas(w, h);
  ctx.fillStyle = rgba(mix(spec.color, 0x08091e, 0.2), 0.9);
  ctx.fillRect(0, 0, w, h);
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, w, h);
  ctx.clip();
  // 45° hatching whose spacing divides the tile, so neighbouring tiles line up in both directions.
  const s = GHOST_STYLE;
  const step = h / Math.max(1, Math.round(h / (s.hatchGap * scale * 1.3)));
  ctx.strokeStyle = `rgba(255,255,255,${s.hatchAlpha * 0.7})`;
  ctx.lineWidth = s.hatchWidth * scale;
  ctx.beginPath();
  for (let x = -h - step; x < w + h + step; x += step) {
    ctx.moveTo(x, h);
    ctx.lineTo(x + h, 0);
  }
  ctx.stroke();
  ctx.restore();
  return canvas;
}

/** Height of a terrain stand-in's top edge strip (game px). */
export const EDGE_HEIGHT = 8;

/** The top edge of a terrain stand-in: a light band and the dashed cream line (tiles horizontally). */
export function paintTileEdge(spec: ArtSpec, scale: number): HTMLCanvasElement {
  const s = GHOST_STYLE;
  const w = Math.max(8, spec.w) * scale;
  const h = EDGE_HEIGHT * scale;
  const { canvas, ctx } = newCanvas(w, h);
  const top = spec.top ?? mix(spec.color, 0xffffff, 0.35);
  ctx.fillStyle = rgba(top, 0.6);
  ctx.fillRect(0, 0, w, 4 * scale);
  const y = 2.6 * scale;
  ctx.strokeStyle = HALO;
  ctx.lineWidth = s.halo * scale * 0.7;
  ctx.beginPath();
  ctx.moveTo(0, y);
  ctx.lineTo(w, y);
  ctx.stroke();
  const period = (s.dash + s.gap) * scale;
  const unit = w / Math.max(1, Math.round(w / period));
  ctx.setLineDash([unit * (s.dash / (s.dash + s.gap)), unit * (s.gap / (s.dash + s.gap))]);
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = s.outlineWidth * scale;
  ctx.stroke();
  return canvas;
}

/** A background until drawn: a soft vertical gradient of the game's own background colour, a faint 64 px grid and a corner tag. */
export function paintBackground(spec: ArtSpec, gameColor: number, withAsk = true): HTMLCanvasElement {
  const { canvas, ctx } = newCanvas(spec.w, spec.h);
  const g = ctx.createLinearGradient(0, 0, 0, spec.h);
  g.addColorStop(0, cssColor(mix(gameColor, 0x000000, 0.2)));
  g.addColorStop(1, cssColor(mix(gameColor, 0xffffff, 0.14)));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, spec.w, spec.h);
  ctx.strokeStyle = 'rgba(244,236,220,0.07)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = 0; x <= spec.w; x += 64) {
    ctx.moveTo(x + 0.5, 0);
    ctx.lineTo(x + 0.5, spec.h);
  }
  for (let y = 0; y <= spec.h; y += 64) {
    ctx.moveTo(0, y + 0.5);
    ctx.lineTo(spec.w, y + 0.5);
  }
  ctx.stroke();
  // Centred near the top: backgrounds are often placed off-centre, and the corners hold the HUD.
  const chip = paintTagText(withAsk ? `${spec.name} · draw it?` : spec.name);
  ctx.globalAlpha = 0.9;
  ctx.drawImage(chip, Math.round((spec.w - chip.width) / 2), 84);
  return canvas;
}

/** A small paper chip with a pencil badge and free text (the background's corner tag). */
function paintTagText(text: string): HTMLCanvasElement {
  const size = 11;
  const probe = newCanvas(1, 1).ctx;
  probe.font = `700 ${size}px ${TAG_FONT}`;
  const tw = probe.measureText(text).width;
  const h = 20;
  const w = Math.ceil(5 + 13 + 4 + tw + 7);
  const { canvas, ctx } = newCanvas(w + 6, h + 6);
  ctx.translate(3, 3);
  ctx.beginPath();
  ctx.roundRect(0, 0, w, h, 5);
  ctx.fillStyle = PAPER;
  ctx.fill();
  ctx.strokeStyle = PAPER_LINE;
  ctx.stroke();
  paintBadge(ctx, 11.5, h / 2, 6.5);
  ctx.font = `700 ${size}px ${TAG_FONT}`;
  ctx.textBaseline = 'middle';
  ctx.fillStyle = cssColor(INK);
  ctx.fillText(text, 22, h / 2 + 0.5);
  return canvas;
}
