/**
 * The view transform: document px -> CSS px of the view element (zoom, rotation, pan), plus the gesture
 * math for two-finger pan/pinch/rotate and taps. Pure, so it is unit-tested.
 */
import type { Point } from './geom';

export interface ViewState {
  zoom: number;
  /** Radians. */
  rot: number;
  /** CSS px offset of the document origin within the view element. */
  panX: number;
  panY: number;
}

export const ZOOM_MIN = 0.1;
export const ZOOM_MAX = 32;
/** Rotation snaps to upright within this angle. */
export const ROT_SNAP = (6 * Math.PI) / 180;

export function clampZoom(z: number): number {
  return Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z));
}

/** Document px -> view CSS px. */
export function docToView(v: ViewState, x: number, y: number): Point {
  const c = Math.cos(v.rot);
  const s = Math.sin(v.rot);
  return { x: (x * c - y * s) * v.zoom + v.panX, y: (x * s + y * c) * v.zoom + v.panY };
}

/** View CSS px -> document px. */
export function viewToDoc(v: ViewState, x: number, y: number): Point {
  const dx = x - v.panX;
  const dy = y - v.panY;
  const c = Math.cos(-v.rot);
  const s = Math.sin(-v.rot);
  return { x: (dx * c - dy * s) / v.zoom, y: (dx * s + dy * c) / v.zoom };
}

/** Canvas setTransform for device px (dpr). */
export function viewMatrix(v: ViewState, dpr: number): [number, number, number, number, number, number] {
  const k = dpr * v.zoom;
  const c = Math.cos(v.rot) * k;
  const s = Math.sin(v.rot) * k;
  return [c, s, -s, c, v.panX * dpr, v.panY * dpr];
}

/** Fits the board in a cssW x cssH view with a margin, upright and centred. */
export function fitView(W: number, H: number, cssW: number, cssH: number, margin = 24): ViewState {
  const zoom = clampZoom(Math.min((cssW - margin * 2) / W, (cssH - margin * 2) / H));
  return { zoom, rot: 0, panX: (cssW - W * zoom) / 2, panY: (cssH - H * zoom) / 2 };
}

/** Zooms by `factor` keeping the document point under (vx, vy) fixed. */
export function zoomAt(v: ViewState, factor: number, vx: number, vy: number): ViewState {
  const d = viewToDoc(v, vx, vy);
  const next = { ...v, zoom: clampZoom(v.zoom * factor) };
  const p = docToView(next, d.x, d.y);
  return { ...next, panX: next.panX + vx - p.x, panY: next.panY + vy - p.y };
}

/** Rotates by `angle` around the view point (vx, vy). */
export function rotateAt(v: ViewState, angle: number, vx: number, vy: number): ViewState {
  const d = viewToDoc(v, vx, vy);
  const next = { ...v, rot: v.rot + angle };
  const p = docToView(next, d.x, d.y);
  return { ...next, panX: next.panX + vx - p.x, panY: next.panY + vy - p.y };
}

/** Snaps a rotation to the nearest quarter turn when within ROT_SNAP; normalises to (-pi, pi]. */
export function snapRotation(rot: number): number {
  const q = Math.round(rot / (Math.PI / 2)) * (Math.PI / 2);
  let r = Math.abs(rot - q) < ROT_SNAP ? q : rot;
  r = Math.atan2(Math.sin(r), Math.cos(r));
  return Math.abs(r) < 1e-9 ? 0 : r;
}

/**
 * Two-finger gesture: the view that keeps the document points under the starting fingers under the
 * current fingers (pan + pinch + rotate), with rotation snapped upright.
 */
export function twoFingerView(start: ViewState, a0: Point, b0: Point, a1: Point, b1: Point, allowRotate = true): ViewState {
  const v0x = b0.x - a0.x;
  const v0y = b0.y - a0.y;
  const v1x = b1.x - a1.x;
  const v1y = b1.y - a1.y;
  const s = Math.hypot(v1x, v1y) / Math.max(1, Math.hypot(v0x, v0y));
  const dr = allowRotate ? Math.atan2(v1y, v1x) - Math.atan2(v0y, v0x) : 0;
  const m0 = { x: (a0.x + b0.x) / 2, y: (a0.y + b0.y) / 2 };
  const m1 = { x: (a1.x + b1.x) / 2, y: (a1.y + b1.y) / 2 };
  const d = viewToDoc(start, m0.x, m0.y);
  const zoom = clampZoom(start.zoom * s);
  const rot = snapRotation(start.rot + dr);
  const c = Math.cos(rot);
  const sn = Math.sin(rot);
  return { zoom, rot, panX: m1.x - (d.x * c - d.y * sn) * zoom, panY: m1.y - (d.x * sn + d.y * c) * zoom };
}

/**
 * The CSS transform that makes a canvas rendered with view `from` look like view `to` (for gestures: the
 * compositor moves the pixels, and the canvas re-renders crisply when the gesture ends).
 */
export function cssTransformBetween(from: ViewState, to: ViewState): string {
  // M_to * M_from^-1, both doc -> view.
  const k = to.zoom / from.zoom;
  const r = to.rot - from.rot;
  const c = Math.cos(r) * k;
  const s = Math.sin(r) * k;
  // Solve for the translation: p_to = R*k*(p_from - pan_from) + pan_to, rotating about the view origin.
  const e = to.panX - (c * from.panX - s * from.panY);
  const f = to.panY - (s * from.panX + c * from.panY);
  return `matrix(${c}, ${s}, ${-s}, ${c}, ${e}, ${f})`;
}

export interface TouchSummary {
  /** Most fingers down at once. */
  maxFingers: number;
  /** ms from the first finger down to the last finger up. */
  duration: number;
  /** Largest distance any finger moved, CSS px. */
  moved: number;
}

/** Two-finger tap = undo, three-finger tap = redo (short, still, and no drawing happened). */
export function classifyTap(t: TouchSummary): 'undo' | 'redo' | null {
  if (t.duration > 350 || t.moved > 12) return null;
  if (t.maxFingers === 2) return 'undo';
  if (t.maxFingers === 3) return 'redo';
  return null;
}
