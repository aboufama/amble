/**
 * The guides on the paper (§2.10): never exported, never drawn for the student, switched with Guides.
 * - Below the drawing: the scale ghost (the hero, grey, "Pip, for size"; a door for the hero itself), the
 *   ground line ("GROUND", or "floats here"), which way it faces, and the body ghost: faint shapes of the
 *   parts still to draw (on the bones) or the dashed star-pose outline (Freehand).
 * - Above the drawing: the bones to draw on, as a constellation; the chosen part's bones glow, with a
 *   callout ("Draw an arm on this bone").
 * Drawn once into board-sized canvases and handed to the surface as its guide (it composites them).
 */
import { ghostShapes, templateFor, type CharacterKind, type RigData } from '../cores/rig';
import type { BoardSpec } from './boards';
import { rigFacing } from './parts';
import type { DeskRequest } from './request';

/** Colours on paper (§3.1: pencil ink for guide labels, the paper line for edges). */
const PENCIL = '#3f5db0';
const PAPER_LINE = '#8c7b5a';
const GHOST = '#6f8fd8';
const BONE = '#7d93cc';
const GLOW = '#1fa57a';
const CALLOUT_BG = 'rgba(18, 48, 64, 0.92)';

const FONT = "'Atkinson Hyperlegible Next', system-ui, sans-serif";

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

function star(ctx: Ctx, x: number, y: number, r: number): void {
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4 - Math.PI / 2;
    const rr = i % 2 === 0 ? r : r * 0.42;
    ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  ctx.closePath();
}

/** The body ghost: faint shapes around the template's bones (all of them, or those not drawn yet). */
function drawGhost(ctx: Ctx, rig: RigData, skip: ReadonlySet<string>, style: 'fill' | 'dashed', u: number): void {
  const shapes = ghostShapes(rig).filter((s) => !skip.has(s.bone));
  ctx.save();
  if (style === 'fill') {
    ctx.fillStyle = 'rgba(111, 143, 216, 0.13)';
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
    // A soft sky fill, then a dashed-looking rim: the mask drawn as rings of dots along its edge.
    ctx.globalAlpha = 0.1;
    ctx.drawImage(tint(mask, GHOST), 0, 0);
    ctx.globalAlpha = 0.75;
    ctx.drawImage(dashedEdge(mask, GHOST, 2.2 * u, 7 * u), 0, 0);
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
function drawScaleGhost(ctx: Ctx, i: GuideInput, u: number): void {
  const { board, request: r } = i;
  const ground = board.groundY;
  if (ground === null) return;
  if (!r.hero) {
    if (r.kind !== 'character' || r.role !== 'hero') return;
    // The hero itself: a door for size (about 1.25 times as tall as the hero).
    const dh = Math.min(board.h * 0.84, r.h * board.perGamePx * 1.25);
    const dw = dh * 0.45;
    const x = board.w * 0.05;
    ctx.save();
    ctx.strokeStyle = 'rgba(107, 103, 128, 0.42)';
    ctx.lineWidth = 3 * u;
    ctx.setLineDash([9 * u, 7 * u]);
    ctx.strokeRect(x, ground - dh, dw, dh);
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.arc(x + dw * 0.8, ground - dh * 0.48, 4 * u, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(107, 103, 128, 0.42)';
    ctx.fill();
    ctx.restore();
    label(ctx, i.labels.door, x, ground - dh - 24 * u, 14 * u, PENCIL);
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
    ctx.fillStyle = '#6b6780';
    for (const s of ghostShapes(t)) {
      if (s.shape === 'circle') {
        ctx.beginPath();
        ctx.arc((s.x1 + s.x2) / 2, (s.y1 + s.y2) / 2, s.r, 0, Math.PI * 2);
      } else capsulePath(ctx, s.x1, s.y1, s.x2, s.y2, s.r);
      ctx.fill();
    }
  }
  ctx.restore();
  label(ctx, i.labels.forSize, x0 + w / 2, ground - hh - 26 * u, 14 * u, PENCIL, 'center');
}

function drawGround(ctx: Ctx, i: GuideInput, u: number): void {
  const g = i.board.groundY;
  if (g === null) return;
  const W = i.board.w;
  ctx.save();
  ctx.strokeStyle = 'rgba(140, 123, 90, 0.75)';
  ctx.lineWidth = 2.4 * u;
  ctx.setLineDash([10 * u, 8 * u]);
  ctx.beginPath();
  ctx.moveTo(W * 0.04, g);
  ctx.lineTo(W * 0.96, g);
  ctx.stroke();
  ctx.restore();
  const text = i.request.rig === 'flyer' || i.request.kind === 'projectile' ? i.labels.floats : i.labels.ground;
  label(ctx, text, W * 0.04, g + 8 * u, 12.5 * u, PAPER_LINE, 'left', true);
}

function drawFacing(ctx: Ctx, i: GuideInput, u: number): void {
  const r = i.request;
  if (r.kind !== 'character' || r.rig === 'none') return;
  const W = i.board.w;
  const y = 22 * u;
  const size = 13.5 * u;
  const text = r.facing === 'viewer' ? i.labels.facesYou : i.labels.faces;
  ctx.save();
  ctx.font = `600 ${size}px ${FONT}`;
  const tw = ctx.measureText(text).width;
  ctx.restore();
  const arrowW = 30 * u;
  const right = W - 24 * u;
  const textX = r.facing === 'right' ? right - arrowW - 8 * u - tw : right - tw;
  label(ctx, text, textX, y, size, PAPER_LINE);
  if (r.facing === 'viewer') return;
  const ax0 = r.facing === 'left' ? textX - 8 * u - arrowW : right - arrowW;
  const ax1 = ax0 + arrowW;
  const ay = y + size * 0.62;
  ctx.save();
  ctx.strokeStyle = PAPER_LINE;
  ctx.lineWidth = 2.4 * u;
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

function drawRepeats(ctx: Ctx, i: GuideInput, u: number): void {
  if (i.board.kind !== 'platform' && i.board.kind !== 'terrain') return;
  const { w, h } = i.board;
  ctx.save();
  ctx.strokeStyle = 'rgba(140, 123, 90, 0.55)';
  ctx.lineWidth = 2 * u;
  ctx.setLineDash([6 * u, 6 * u]);
  for (const x of [2 * u, w - 2 * u]) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
  }
  ctx.restore();
  label(ctx, i.labels.repeats, w - 10 * u, 8 * u, 12 * u, PAPER_LINE, 'right');
}

/** The constellation: every bone thin, the chosen part's bones glowing, stars at the joints. */
function drawBonesAbove(ctx: Ctx, rig: RigData, current: ReadonlySet<string>, u: number): { x: number; y: number } | null {
  let tip: { x: number; y: number } | null = null;
  const bones = rig.bones;
  ctx.save();
  ctx.lineCap = 'round';
  for (const pass of ['dim', 'glow'] as const) {
    for (const b of bones) {
      const on = current.has(b.name);
      if ((pass === 'glow') !== on) continue;
      if (on) {
        ctx.shadowColor = 'rgba(31, 165, 122, 0.55)';
        ctx.shadowBlur = 12 * u;
        ctx.strokeStyle = GLOW;
        ctx.lineWidth = 5.5 * u;
      } else {
        ctx.shadowBlur = 0;
        ctx.strokeStyle = 'rgba(125, 147, 204, 0.62)';
        ctx.lineWidth = 2.4 * u;
      }
      ctx.beginPath();
      ctx.moveTo(b.x, b.y);
      ctx.lineTo(b.x2, b.y2);
      ctx.stroke();
      if (on) tip = { x: b.x2, y: b.y2 };
    }
  }
  ctx.shadowBlur = 0;
  const hasChild = new Set(bones.map((b) => b.parent));
  bones.forEach((b, k) => {
    const on = current.has(b.name);
    const pts: Array<[number, number]> = [[b.x, b.y]];
    if (!hasChild.has(k)) pts.push([b.x2, b.y2]);
    for (const [x, y] of pts) {
      star(ctx, x, y, (on ? 10 : 7) * u);
      ctx.fillStyle = on ? '#ffffff' : 'rgba(255, 255, 255, 0.9)';
      ctx.fill();
      ctx.lineWidth = (on ? 2.6 : 1.8) * u;
      ctx.strokeStyle = on ? GLOW : BONE;
      ctx.stroke();
    }
  });
  ctx.restore();
  return tip;
}

function drawCallout(ctx: Ctx, text: string, at: { x: number; y: number }, board: BoardSpec, u: number): void {
  const size = 15 * u;
  ctx.save();
  ctx.font = `700 ${size}px ${FONT}`;
  const tw = ctx.measureText(text).width;
  const padX = 12 * u;
  const h = size + 14 * u;
  const w = tw + padX * 2;
  // Beside the bone's tip, kept on the paper.
  let x = at.x + 26 * u;
  if (x + w > board.w - 8 * u) x = at.x - 26 * u - w;
  const y = Math.min(board.h - h - 8 * u, Math.max(8 * u, at.y - h / 2));
  ctx.strokeStyle = CALLOUT_BG;
  ctx.lineWidth = 2 * u;
  ctx.beginPath();
  ctx.moveTo(at.x, at.y);
  ctx.lineTo(x < at.x ? x + w : x, y + h / 2);
  ctx.stroke();
  ctx.fillStyle = CALLOUT_BG;
  const r = h / 2;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.fill();
  ctx.fillStyle = '#86f3cb';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x + padX, y + h / 2 + u);
  ctx.restore();
}

function drawStarNote(ctx: Ctx, text: string, rig: RigData, board: BoardSpec, u: number): void {
  const ys = rig.bones.flatMap((b) => [b.y, b.y2]);
  const top = Math.min(...ys);
  const size = 13.5 * u;
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
  ctx.fillStyle = PENCIL;
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
  const below = new OffscreenCanvas(w, h);
  const ctx = below.getContext('2d');
  if (!ctx) return { below, above: null };
  drawScaleGhost(ctx, i, u);
  drawGround(ctx, i, u);
  drawFacing(ctx, i, u);
  drawRepeats(ctx, i, u);
  let above: OffscreenCanvas | null = null;
  if (rig && i.mode === 'bones') {
    drawGhost(ctx, rig, i.drawnBones, 'fill', u);
    above = new OffscreenCanvas(w, h);
    const a = above.getContext('2d');
    if (a) {
      const tip = drawBonesAbove(a, rig, new Set(i.currentBones), u);
      if (tip && i.labels.callout) drawCallout(a, i.labels.callout, tip, i.board, u);
    }
  } else if (rig && i.starPose) {
    drawGhost(ctx, rig, new Set(), 'dashed', u);
    // Joint dots on the star pose.
    ctx.save();
    ctx.fillStyle = GHOST;
    for (const b of rig.bones) {
      ctx.beginPath();
      ctx.arc(b.x, b.y, 4.5 * u, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
    if (i.labels.starNote) drawStarNote(ctx, i.labels.starNote, rig, i.board, u);
  }
  return { below, above };
}
