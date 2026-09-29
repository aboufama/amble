/**
 * The Bones view's small maths: where the drawing sits in the sky, art px ↔ sky px, keyboard nudges,
 * and scaling the AI helper's joint hints from the outline it saw to the drawing.
 */
import type { JointHints, Point } from '../cores/rig';

/** The drawing's place in the sky: sky px = (ox, oy) + art px × k. */
export interface Fit {
  ox: number;
  oy: number;
  k: number;
  /** The drawing's size in art px. */
  w: number;
  h: number;
}

export interface FitMargins {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** Room around the drawing: stars at the edges, the ground line, the key hints and the legend. */
export const SKY_MARGINS: FitMargins = { top: 44, right: 72, bottom: 84, left: 72 };
/** Small drawings grow, but not into blur. */
export const MAX_ZOOM = 2.5;

/** Fits a drawing of `w` × `h` art px into a sky of `skyW` × `skyH` css px, centred in the free room. */
export function fitArt(skyW: number, skyH: number, w: number, h: number, m: FitMargins = SKY_MARGINS): Fit {
  const roomW = Math.max(40, skyW - m.left - m.right);
  const roomH = Math.max(40, skyH - m.top - m.bottom);
  const k = Math.min(roomW / Math.max(1, w), roomH / Math.max(1, h), MAX_ZOOM);
  const ox = m.left + (roomW - w * k) / 2;
  const oy = m.top + (roomH - h * k) / 2;
  return { ox, oy, k, w, h };
}

export function toSky(f: Fit, x: number, y: number): Point {
  return [f.ox + x * f.k, f.oy + y * f.k];
}

export function toArt(f: Fit, sx: number, sy: number): Point {
  return [(sx - f.ox) / f.k, (sy - f.oy) / f.k];
}

/** Where stars may go, in art px: the drawing plus a margin, and never outside the sky. */
export function starBounds(f: Fit, skyW: number, skyH: number, pad = 12): { x0: number; y0: number; x1: number; y1: number } {
  const [x0, y0] = toArt(f, pad, pad);
  const [x1, y1] = toArt(f, skyW - pad, skyH - pad);
  return { x0, y0, x1, y1 };
}

export function clampTo(p: Point, b: { x0: number; y0: number; x1: number; y1: number }): Point {
  return [Math.min(b.x1, Math.max(b.x0, p[0])), Math.min(b.y1, Math.max(b.y0, p[1]))];
}

export type ArrowKey = 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown';

export function isArrowKey(key: string): key is ArrowKey {
  return key === 'ArrowLeft' || key === 'ArrowRight' || key === 'ArrowUp' || key === 'ArrowDown';
}

/** One nudge is 1 art px, with Shift 10 (the star's label says so). */
export function nudgeStep(shift: boolean): number {
  return shift ? 10 : 1;
}

/**
 * A star after an arrow key: whole art px (so "at 64 by 179" stays true), one or ten steps, kept
 * inside `bounds` when given.
 */
export function nudge(at: Point, key: ArrowKey, shift: boolean, bounds?: { x0: number; y0: number; x1: number; y1: number }): Point {
  const step = nudgeStep(shift);
  const dx = key === 'ArrowLeft' ? -step : key === 'ArrowRight' ? step : 0;
  const dy = key === 'ArrowUp' ? -step : key === 'ArrowDown' ? step : 0;
  const p: Point = [Math.round(at[0]) + dx, Math.round(at[1]) + dy];
  if (!bounds) return p;
  const lo = [Math.ceil(bounds.x0), Math.ceil(bounds.y0)];
  const hi = [Math.floor(bounds.x1), Math.floor(bounds.y1)];
  return [Math.min(hi[0], Math.max(lo[0], p[0])), Math.min(hi[1], Math.max(lo[1], p[1]))];
}

/** A star's place in words: whole art px. */
export function roundPoint(x: number, y: number): [number, number] {
  return [Math.round(x), Math.round(y)];
}

/**
 * The AI helper's joint hints, from the outline it saw (`outW` × `outH` px) to the drawing (`w` × `h`
 * art px). Hints in the reply's 0..1000 space (any value past the outline) are read that way instead.
 */
export function scaleHints(hints: JointHints, outW: number, outH: number, w: number, h: number): JointHints {
  const points = Object.values(hints).filter((p): p is Point => !!p);
  const thousand = points.some(([x, y]) => x > outW * 1.05 + 1 || y > outH * 1.05 + 1);
  const sx = thousand ? w / 1000 : w / Math.max(1, outW);
  const sy = thousand ? h / 1000 : h / Math.max(1, outH);
  const out: JointHints = {};
  for (const [role, p] of Object.entries(hints) as [keyof JointHints, Point | undefined][]) {
    if (p && Number.isFinite(p[0]) && Number.isFinite(p[1])) out[role] = [p[0] * sx, p[1] * sy];
  }
  return out;
}

/** Whether bones fitted to a drawing of `was` px no longer fit one of `now` px (§7.9: more than 20 %). */
export function bonesAreStale(was: [number, number] | null, now: [number, number]): boolean {
  if (!was) return false;
  return Math.abs(now[0] - was[0]) > 0.2 * was[0] || Math.abs(now[1] - was[1]) > 0.2 * was[1];
}
