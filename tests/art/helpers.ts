import { capsule, makeTarget, type Target } from '../../src/art/engine/raster';

/** Draws an arc of a circle as capsules into t (angles in degrees, sweep may be negative). */
export function arc(t: Target, cx: number, cy: number, r: number, width: number, fromDeg: number, sweepDeg: number): void {
  const n = Math.max(8, Math.ceil((Math.abs(sweepDeg) / 360) * 2 * Math.PI * r / 2));
  let px = cx + r * Math.cos((fromDeg * Math.PI) / 180);
  let py = cy + r * Math.sin((fromDeg * Math.PI) / 180);
  for (let k = 1; k <= n; k++) {
    const a = ((fromDeg + (sweepDeg * k) / n) * Math.PI) / 180;
    const x = cx + r * Math.cos(a);
    const y = cy + r * Math.sin(a);
    capsule(t, px, py, width / 2, 1, x, y, width / 2, 1, 1, null);
    px = x;
    py = y;
  }
}

/** A ring with a gap of `gapPx` (arc length) centred at `gapAtDeg`. */
export function ringWithGap(t: Target, cx: number, cy: number, r: number, width: number, gapPx: number, gapAtDeg = -90): void {
  if (gapPx <= 0) {
    arc(t, cx, cy, r, width, 0, 360);
    return;
  }
  // The capsule caps eat into the gap by width/2 on each side.
  const gapDeg = (((gapPx + width) / r) * 180) / Math.PI;
  arc(t, cx, cy, r, width, gapAtDeg + gapDeg / 2, 360 - gapDeg);
}

export function line(t: Target, x0: number, y0: number, x1: number, y1: number, width: number): void {
  capsule(t, x0, y0, width / 2, 1, x1, y1, width / 2, 1, 1, null);
}

/** Line-art RGBA (dark ink, alpha from coverage) from a coverage target. */
export function inkRgba(t: Target): Uint8ClampedArray {
  const out = new Uint8ClampedArray(t.W * t.H * 4);
  for (let i = 0; i < t.W * t.H; i++) {
    out[i * 4] = 40;
    out[i * 4 + 1] = 30;
    out[i * 4 + 2] = 20;
    out[i * 4 + 3] = Math.round(Math.min(1, t.buf[i]) * 255);
  }
  return out;
}

export function board(W: number, H: number): Target {
  return makeTarget(W, H, false);
}

/** Coverage at (x, y) of a fill result (0..255), 0 outside its box. */
export function maskAt(res: { box: { x0: number; y0: number; x1: number; y1: number }; mask: Uint8Array }, x: number, y: number): number {
  const { box } = res;
  if (x < box.x0 || y < box.y0 || x >= box.x1 || y >= box.y1) return 0;
  return res.mask[(y - box.y0) * (box.x1 - box.x0) + (x - box.x0)];
}
