/**
 * The guides on the paper (§2.10): never exported, never drawn for the student, switched with Guides.
 * - Below the drawing: the scale ghost (the hero, grey, "Pip, for size"; a door for the hero itself), the
 *   ground line ("GROUND", or "floats here"), which way it faces, and the body ghost: faint shapes of the
 *   parts still to draw (on the bones) or the dashed star-pose outline (Freehand).
 * - Above the drawing: the bones to draw on, thin, in the bones' green; the chosen part's bones in
 *   Scratch's chosen purple with its flat halo, and a callout ("Draw an arm on this bone").
 * Flat and clean on the white sheet: no glows, no stars. Drawn once into board-sized canvases and handed
 * to the surface as its guide (it composites them).
 */
import { ghostShapes, templateFor, type CharacterKind, type RigData } from '../cores/rig';
import { FONTS, PAPER } from '../ui/tokens';
import type { BoardSpec } from './boards';
import { rigFacing } from './parts';
import type { DeskRequest } from './request';

/**
 * The guides' colours on the white sheet. The Desk reads them from its stylesheet's tokens (`--guide-*` on
 * the sheet, so High contrast gets black marks).
 */
export interface GuideColors {
  /** Words and arrows. */
  ink: string;
  /** The ground line, the door, the edges of repeating tiles. */
  mark: string;
  /** The bones to draw on. */
  bone: string;
  /** The chosen part's bones, and the halo around them. */
  chosen: string;
  halo: string;
  /** The body still to draw, and the star-pose outline. */
  ghost: string;
  /** The callout's fill and its words. */
  callout: string;
  onCallout: string;
  /** The sheet itself (the joints' faces). */
  sheet: string;
}

/** Plain dark marks on white, for when the stylesheet's tokens can't be read. */
export const GUIDE_COLORS: GuideColors = {
  ink: PAPER.ink,
  mark: PAPER.paperLine,
  bone: PAPER.ink,
  chosen: PAPER.pencilInk,
  halo: 'transparent',
  ghost: PAPER.pencilInk,
  callout: PAPER.pencilInk,
  onCallout: PAPER.paper,
  sheet: PAPER.paper,
};

/** The guides' colours from the sheet's `--guide-*` tokens (any missing one keeps its Original colour). */
export function guideColorsOf(el: Element | null): GuideColors {
  if (!el || typeof getComputedStyle === 'undefined') return GUIDE_COLORS;
  const cs = getComputedStyle(el);
  const read = (name: string, fallback: string): string => cs.getPropertyValue(name).trim() || fallback;
  return {
    ink: read('--guide-ink', GUIDE_COLORS.ink),
    mark: read('--guide-mark', GUIDE_COLORS.mark),
    bone: read('--guide-bone', GUIDE_COLORS.bone),
    chosen: read('--guide-chosen', GUIDE_COLORS.chosen),
    halo: read('--guide-halo', GUIDE_COLORS.halo),
    ghost: read('--guide-ghost', GUIDE_COLORS.ghost),
    callout: read('--guide-callout', GUIDE_COLORS.callout),
    onCallout: read('--guide-on-callout', GUIDE_COLORS.onCallout),
    sheet: read('--guide-sheet', GUIDE_COLORS.sheet),
  };
}

const FONT = FONTS.ui;

export interface GuideLabels {
  ground: string;
  floats: string;
  faces: string;
  facesYou: string;
  forSize: string;
  door: string;
  repeats: string;
  /** "Draw an arm on this bone" (on the bones), or null. */
  callout: string | null;
  /** "Arms a little out, so Pip's arms can swing." (the star-pose guide), or null. */
  starNote: string | null;
}

export interface GuideInput {
  board: BoardSpec;
  request: DeskRequest;
  mode: 'bones' | 'free';
  /** Freehand character with Guides on: the dashed star-pose figure. */
  starPose: boolean;
  /** Bone names of the part being drawn (they glow); empty in Freehand. */
  currentBones: readonly string[];
  /** Bone names of parts that already have ink (their ghost shape goes away). */
  drawnBones: ReadonlySet<string>;
  /** The hero's drawing (a grey scale ghost), when it is drawn. */
  heroImage: ImageBitmap | null;
  labels: GuideLabels;
  /** Board px per CSS px when the whole sheet fits the view (so labels read at about 13 px). */
  unit: number;
  /** The colours on the sheet (default: the Original colours). */
  colors?: GuideColors;
}

export interface GuideImages {
  below: OffscreenCanvas;
  above: OffscreenCanvas | null;
}

/** The template skeleton standing on the board: in the request's box, feet on the ground line. */
export function templateOnBoard(board: BoardSpec, r: Pick<DeskRequest, 'rig' | 'w' | 'h' | 'facing'>): RigData | null {
  if (r.rig === 'none') return null;
  const kind = r.rig as CharacterKind;
  const figH = Math.min(board.h * 0.86, r.h * board.perGamePx);
  const figW = Math.min(board.w * 0.94, r.w * board.perGamePx);
  const t = templateFor(kind, figW, figH, rigFacing(r.facing));
  const ground = board.groundY ?? board.h * 0.88;
  const dx = board.w / 2 - figW / 2;
  const dy = ground - figH;
  return {
    ...t,
    anchor: [t.anchor[0] + dx, t.anchor[1] + dy],
    bones: t.bones.map((b) => ({ ...b, x: b.x + dx, y: b.y + dy, x2: b.x2 + dx, y2: b.y2 + dy })),
  };
}

type Ctx = OffscreenCanvasRenderingContext2D;

function label(ctx: Ctx, text: string, x: number, y: number, size: number, color: string, align: CanvasTextAlign = 'left', caps = false): number {
  ctx.save();
  ctx.fillStyle = color;
  ctx.font = `${caps ? 700 : 600} ${size}px ${FONT}`;
  ctx.textAlign = align;
  ctx.textBaseline = 'top';
  const s = caps ? text.toUpperCase() : text;
  if (caps && 'letterSpacing' in ctx) (ctx as Ctx & { letterSpacing: string }).letterSpacing = `${(size * 0.08).toFixed(1)}px`;
  ctx.fillText(s, x, y);
  const w = ctx.measureText(s).width;
  ctx.restore();
  return w;
}

function capsulePath(ctx: Ctx, x1: number, y1: number, x2: number, y2: number, r: number): void {
  const a = Math.atan2(y2 - y1, x2 - x1);
  ctx.beginPath();
  ctx.arc(x1, y1, r, a + Math.PI / 2, a - Math.PI / 2);
  ctx.arc(x2, y2, r, a - Math.PI / 2, a + Math.PI / 2);
  ctx.closePath();
}

/** The body ghost: faint shapes around the template's bones (all of them, or those not drawn yet). */
function drawGhost(ctx: Ctx, rig: RigData, skip: ReadonlySet<string>, style: 'fill' | 'dashed', u: number, c: GuideColors): void {
  const shapes = ghostShapes(rig).filter((s) => !skip.has(s.bone));
  ctx.save();
  if (style === 'fill') {
    ctx.fillStyle = c.ghost;
    ctx.globalAlpha = 0.1;
    for (const s of shapes) {
      if (s.shape === 'circle') {
        ctx.beginPath();
        ctx.arc((s.x1 + s.x2) / 2, (s.y1 + s.y2) / 2, s.r, 0, Math.PI * 2);
      } else capsulePath(ctx, s.x1, s.y1, s.x2, s.y2, s.r);
      ctx.fill();
    }
  } else {
    // One outline around the union of the shapes: fill them into a mask, then trace its edge.
    const mask = new OffscreenCanvas(ctx.canvas.width, ctx.canvas.height);
    const m = mask.getContext('2d');
    if (!m) return;
    m.fillStyle = '#000';
    for (const s of shapes) {
      if (s.shape === 'circle') {
        m.beginPath();
        m.arc((s.x1 + s.x2) / 2, (s.y1 + s.y2) / 2, s.r, 0, Math.PI * 2);
      } else capsulePath(m as unknown as Ctx, s.x1, s.y1, s.x2, s.y2, s.r);
      m.fill();
    }
    // A faint fill, then a dashed rim: the mask's edge cut into dashes.
    ctx.globalAlpha = 0.05;
    ctx.drawImage(tint(mask, c.ghost), 0, 0);
    ctx.globalAlpha = 0.8;
    ctx.drawImage(dashedEdge(mask, c.ghost, 2 * u, 7 * u), 0, 0);
  }
  ctx.restore();
}

/** A copy of an image's shape in one colour. */
function tint(src: OffscreenCanvas | ImageBitmap, color: string): OffscreenCanvas {
  const c = new OffscreenCanvas(src.width, src.height);
  const x = c.getContext('2d');
  if (!x) return c;
  x.drawImage(src, 0, 0);
  x.globalCompositeOperation = 'source-in';
  x.fillStyle = color;
  x.fillRect(0, 0, c.width, c.height);
  return c;
}

/** A dashed outline of a mask's edge: the edge (mask minus its shrunk self), cut by stripes. */
function dashedEdge(mask: OffscreenCanvas, color: string, width: number, dash: number): OffscreenCanvas {
  const W = mask.width;
  const H = mask.height;
  const edge = new OffscreenCanvas(W, H);
  const e = edge.getContext('2d');
  if (!e) return edge;
  const w = Math.max(1, width);
  // Shrink: keep the mask only where its shifted copies overlap, then subtract that from the mask: a ring.
  const inner = new OffscreenCanvas(W, H);
  const n = inner.getContext('2d');
  if (!n) return edge;
  n.drawImage(mask, 0, 0);
  n.globalCompositeOperation = 'destination-in';
  for (const [dx, dy] of [
    [w, 0],
    [-w, 0],
    [0, w],
    [0, -w],
  ])
    n.drawImage(mask, dx, dy);
  e.globalCompositeOperation = 'source-over';
  e.clearRect(0, 0, W, H);
  e.drawImage(mask, 0, 0);
  e.globalCompositeOperation = 'destination-out';
  e.drawImage(inner, 0, 0);
  // Dashes: cut the ring with a diagonal stripe pattern.
  e.globalCompositeOperation = 'destination-out';
  e.fillStyle = '#000';
  const step = dash * 2;
  e.save();
  e.rotate(Math.PI / 4);
  const R = Math.hypot(W, H);
  for (let x = -R; x < R; x += step) e.fillRect(x, -R, dash * 0.8, 2 * R);
  e.restore();
  e.globalCompositeOperation = 'source-in';
  e.fillStyle = color;
  e.fillRect(0, 0, W, H);
  return edge;
}

/** Draws the scale ghost: the hero's drawing (grey) or its template figure, standing on the ground. */
function drawScaleGhost(ctx: Ctx, i: GuideInput, u: number, c: GuideColors): void {
  const { board, request: r } = i;
  const ground = board.groundY;
  if (ground === null) return;
  if (!r.hero) {
    if (r.kind !== 'character' || r.role !== 'hero') return;
    // The hero itself: a door for size (about 1.25 times as tall as the hero).
    const dh = Math.min(board.h * 0.84, r.h * board.perGamePx * 1.25);
    const dw = dh * 0.4;
    const x = board.w * 0.03;
    ctx.save();
    ctx.strokeStyle = c.mark;
    ctx.fillStyle = c.mark;
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = 2 * u;
    ctx.setLineDash([8 * u, 6 * u]);
    ctx.strokeRect(x, ground - dh, dw, dh);
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.arc(x + dw * 0.8, ground - dh * 0.48, 4 * u, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    label(ctx, i.labels.door, x, ground - dh - 22 * u, 13 * u, c.ink);
    return;
  }
  const hh = r.hero.h * board.perGamePx;
  if (hh > board.h * 0.86 || hh < 24 * u) return;
  const x0 = board.w * 0.05;
  let w = r.hero.w * board.perGamePx;
  ctx.save();
  ctx.globalAlpha = 0.3;
  if (i.heroImage) {
    const k = hh / i.heroImage.height;
    w = i.heroImage.width * k;
    ctx.filter = 'grayscale(1)';
    ctx.drawImage(i.heroImage, x0, ground - hh, w, hh);
    ctx.filter = 'none';
  } else {
    const t = templateFor((r.hero.rig === 'none' ? 'biped' : r.hero.rig) as CharacterKind, w, hh, 0);
    ctx.translate(x0, ground - hh);
    ctx.fillStyle = c.mark;
    for (const s of ghostShapes(t)) {
      if (s.shape === 'circle') {
        ctx.beginPath();
        ctx.arc((s.x1 + s.x2) / 2, (s.y1 + s.y2) / 2, s.r, 0, Math.PI * 2);
      } else capsulePath(ctx, s.x1, s.y1, s.x2, s.y2, s.r);
      ctx.fill();
    }
  }
  ctx.restore();
  label(ctx, i.labels.forSize, x0 + w / 2, ground - hh - 24 * u, 13 * u, c.ink, 'center');
}

function drawGround(ctx: Ctx, i: GuideInput, u: number, c: GuideColors): void {
  const g = i.board.groundY;
  if (g === null) return;
  const W = i.board.w;
  ctx.save();
  ctx.strokeStyle = c.mark;
  ctx.lineWidth = 2 * u;
  ctx.setLineDash([10 * u, 7 * u]);
  ctx.beginPath();
  ctx.moveTo(W * 0.04, g);
  ctx.lineTo(W * 0.96, g);
  ctx.stroke();
  ctx.restore();
  const text = i.request.rig === 'flyer' || i.request.kind === 'projectile' ? i.labels.floats : i.labels.ground;
  label(ctx, text, W * 0.04, g + 8 * u, 12 * u, c.ink, 'left', true);
}

function drawFacing(ctx: Ctx, i: GuideInput, u: number, c: GuideColors): void {
  const r = i.request;
  if (r.kind !== 'character' || r.rig === 'none') return;
  const W = i.board.w;
  const y = 22 * u;
  const size = 13 * u;
  const text = r.facing === 'viewer' ? i.labels.facesYou : i.labels.faces;
  ctx.save();
  ctx.font = `600 ${size}px ${FONT}`;
  const tw = ctx.measureText(text).width;
  ctx.restore();
  const arrowW = 30 * u;
  const right = W - 24 * u;
  const textX = r.facing === 'right' ? right - arrowW - 8 * u - tw : right - tw;
  label(ctx, text, textX, y, size, c.ink);
  if (r.facing === 'viewer') return;
  const ax0 = r.facing === 'left' ? textX - 8 * u - arrowW : right - arrowW;
  const ax1 = ax0 + arrowW;
  const ay = y + size * 0.62;
  ctx.save();
  ctx.strokeStyle = c.ink;
  ctx.lineWidth = 2 * u;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(ax0, ay);
  ctx.lineTo(ax1, ay);
  const tip = r.facing === 'left' ? ax0 : ax1;
  const back = r.facing === 'left' ? 1 : -1;
  ctx.moveTo(tip + back * 7 * u, ay - 6 * u);
  ctx.lineTo(tip, ay);
  ctx.lineTo(tip + back * 7 * u, ay + 6 * u);
  ctx.stroke();
  ctx.restore();
}

function drawRepeats(ctx: Ctx, i: GuideInput, u: number, c: GuideColors): void {
  if (i.board.kind !== 'platform' && i.board.kind !== 'terrain') return;
  const { w, h } = i.board;
  ctx.save();
  ctx.strokeStyle = c.mark;
  ctx.globalAlpha = 0.7;
  ctx.lineWidth = 2 * u;
  ctx.setLineDash([6 * u, 6 * u]);
  for (const x of [2 * u, w - 2 * u]) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
  }
  ctx.restore();
  label(ctx, i.labels.repeats, w - 10 * u, 8 * u, 12 * u, c.ink, 'right');
}

/** A joint: a small round handle on the sheet (the Bones view's joints, smaller). */
function joint(ctx: Ctx, x: number, y: number, r: number, edge: string, face: string, width: number): void {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = face;
  ctx.fill();
  ctx.lineWidth = width;
  ctx.strokeStyle = edge;
  ctx.stroke();
}

/** The bones to draw on: every bone thin in the bones' green, the chosen part's bones purple with a flat halo. */
function drawBonesAbove(ctx: Ctx, rig: RigData, current: ReadonlySet<string>, u: number, c: GuideColors): { x: number; y: number } | null {
  let tip: { x: number; y: number } | null = null;
  const bones = rig.bones;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  // The chosen bones' halo first, then every bone: the dim ones, then the chosen ones on top.
  ctx.strokeStyle = c.halo;
  ctx.lineWidth = 13 * u;
  for (const b of bones) {
    if (!current.has(b.name)) continue;
    ctx.beginPath();
    ctx.moveTo(b.x, b.y);
    ctx.lineTo(b.x2, b.y2);
    ctx.stroke();
  }
  for (const pass of ['dim', 'chosen'] as const) {
    for (const b of bones) {
      const on = current.has(b.name);
      if ((pass === 'chosen') !== on) continue;
      ctx.globalAlpha = on ? 1 : 0.6;
      ctx.strokeStyle = on ? c.chosen : c.bone;
      ctx.lineWidth = (on ? 5 : 2.4) * u;
      ctx.beginPath();
      ctx.moveTo(b.x, b.y);
      ctx.lineTo(b.x2, b.y2);
      ctx.stroke();
      if (on) tip = { x: b.x2, y: b.y2 };
    }
  }
  ctx.globalAlpha = 1;
  const hasChild = new Set(bones.map((b) => b.parent));
  // Dim joints first, so the chosen part's joints sit on top.
  for (const pass of ['dim', 'chosen'] as const)
    bones.forEach((b, k) => {
      const on = current.has(b.name);
      if ((pass === 'chosen') !== on) return;
      const pts: Array<[number, number]> = [[b.x, b.y]];
      if (!hasChild.has(k)) pts.push([b.x2, b.y2]);
      for (const [x, y] of pts) joint(ctx, x, y, (on ? 6.5 : 4.5) * u, on ? c.chosen : c.bone, c.sheet, (on ? 2.5 : 1.8) * u);
    });
  ctx.restore();
  return tip;
}

/** Where the callout goes: beside the bone's tip, and always whole on the paper (words past its edge are cut). */
export function placeCallout(
  at: { x: number; y: number },
  box: { w: number; h: number },
  board: { w: number; h: number },
  u: number,
): { x: number; y: number; beside: boolean } {
  const { w, h } = box;
  const margin = 8 * u;
  // Right of the tip; slid in from the paper's right edge; else left of the tip.
  let x = at.x + 26 * u;
  if (x + w > board.w - margin) x = Math.max(at.x + margin, board.w - margin - w);
  if (x + w > board.w - margin) x = at.x - 26 * u - w;
  x = Math.min(Math.max(margin, x), board.w - margin - w);
  const beside = x >= at.x + 4 * u || x + w <= at.x - 4 * u;
  let y = Math.min(board.h - h - margin, Math.max(margin, at.y - h / 2));
  // A sheet too narrow for either side (a tall hero's board): above the tip, or below it, never over it.
  if (!beside) y = at.y - h - 18 * u >= margin ? at.y - h - 18 * u : Math.min(board.h - h - margin, at.y + 18 * u);
  return { x, y, beside };
}

/** "Draw an arm on this bone": a flat label with 8 px corners in the chosen purple, joined to the bone. */
function drawCallout(ctx: Ctx, text: string, at: { x: number; y: number }, board: BoardSpec, u: number, c: GuideColors): void {
  let size = 14 * u;
  ctx.save();
  ctx.font = `700 ${size}px ${FONT}`;
  let tw = ctx.measureText(text).width;
  const padX = 11 * u;
  const room = board.w - 16 * u - padX * 2;
  // Words a little smaller when the paper is narrower than the callout.
  if (tw > room) {
    size = Math.max(11 * u, (size * room) / tw);
    ctx.font = `700 ${size}px ${FONT}`;
    tw = ctx.measureText(text).width;
  }
  const h = size + 14 * u;
  const w = Math.min(tw, room) + padX * 2;
  const { x, y, beside } = placeCallout(at, { w, h }, board, u);
  ctx.strokeStyle = c.callout;
  ctx.lineWidth = 2 * u;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(at.x, at.y);
  if (beside) ctx.lineTo(x < at.x ? x + w : x, y + h / 2);
  else ctx.lineTo(Math.min(Math.max(at.x, x + h / 2), x + w - h / 2), y < at.y ? y + h : y);
  ctx.stroke();
  ctx.fillStyle = c.callout;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 8 * u);
  ctx.fill();
  ctx.fillStyle = c.onCallout;
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x + padX, y + h / 2 + u, w - padX * 2);
  ctx.restore();
}

function drawStarNote(ctx: Ctx, text: string, rig: RigData, board: BoardSpec, u: number, c: GuideColors): void {
  const ys = rig.bones.flatMap((b) => [b.y, b.y2]);
  const top = Math.min(...ys);
  const size = 13 * u;
  const maxW = Math.min(board.w * 0.36, 230 * u);
  ctx.save();
  ctx.font = `600 ${size}px ${FONT}`;
  // Wrap to a few lines at the paper's top-right.
  const words = text.split(' ');
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (ctx.measureText(next).width > maxW && cur) {
      lines.push(cur);
      cur = w;
    } else cur = next;
  }
  if (cur) lines.push(cur);
  ctx.fillStyle = c.ink;
  ctx.textBaseline = 'top';
  const x = board.w - 24 * u - maxW;
  const y = Math.max(60 * u, top - lines.length * size * 1.3 - 10 * u);
  lines.forEach((l, k) => ctx.fillText(l, x, y + k * size * 1.3));
  ctx.restore();
}

/** Renders the guides for the current Desk state. */
export function renderGuides(i: GuideInput, rig: RigData | null): GuideImages {
  const { w, h } = i.board;
  const u = i.unit;
  const c = i.colors ?? GUIDE_COLORS;
  const below = new OffscreenCanvas(w, h);
  const ctx = below.getContext('2d');
  if (!ctx) return { below, above: null };
  drawScaleGhost(ctx, i, u, c);
  drawGround(ctx, i, u, c);
  drawFacing(ctx, i, u, c);
  drawRepeats(ctx, i, u, c);
  let above: OffscreenCanvas | null = null;
  if (rig && i.mode === 'bones') {
    drawGhost(ctx, rig, i.drawnBones, 'fill', u, c);
    above = new OffscreenCanvas(w, h);
    const a = above.getContext('2d');
    if (a) {
      const tip = drawBonesAbove(a, rig, new Set(i.currentBones), u, c);
      if (tip && i.labels.callout) drawCallout(a, i.labels.callout, tip, i.board, u, c);
    }
  } else if (rig && i.starPose) {
    drawGhost(ctx, rig, new Set(), 'dashed', u, c);
    // Joint dots on the star pose.
    ctx.save();
    ctx.fillStyle = c.ghost;
    for (const b of rig.bones) {
      ctx.beginPath();
      ctx.arc(b.x, b.y, 4 * u, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
    // "Arms a little out": only figures with arms.
    if (i.labels.starNote && rig.kind === 'biped') drawStarNote(ctx, i.labels.starNote, rig, i.board, u, c);
  }
  return { below, above };
}
