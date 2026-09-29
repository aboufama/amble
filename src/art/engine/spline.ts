/** Centripetal Catmull-Rom through the filtered control points, converted to cubic Beziers and flattened. */

export interface CtrlPt {
  x: number;
  y: number;
  /** Pressure 0..1 (real or simulated). */
  p: number;
}

/** A flattened vertex along the stroke. */
export interface Vtx {
  x: number;
  y: number;
  p: number;
  /** Arc length from the stroke start. */
  s: number;
}

/** Writes the Bezier [x0,y0,x1,y1,x2,y2,x3,y3] of the segment pts[i] -> pts[i+1] (P0/P3 reflected at the ends). */
export function segmentBezier(pts: CtrlPt[], n: number, i: number, out: Float64Array): void {
  const p1 = pts[i];
  const p2 = pts[i + 1];
  const p0x = i > 0 ? pts[i - 1].x : 2 * p1.x - p2.x;
  const p0y = i > 0 ? pts[i - 1].y : 2 * p1.y - p2.y;
  const p3x = i + 2 < n ? pts[i + 2].x : 2 * p2.x - p1.x;
  const p3y = i + 2 < n ? pts[i + 2].y : 2 * p2.y - p1.y;
  const d01 = Math.max(1e-4, Math.sqrt(Math.hypot(p1.x - p0x, p1.y - p0y)));
  const d12 = Math.max(1e-4, Math.sqrt(Math.hypot(p2.x - p1.x, p2.y - p1.y)));
  const d23 = Math.max(1e-4, Math.sqrt(Math.hypot(p3x - p2.x, p3y - p2.y)));
  // Hermite tangents of the centripetal parameterisation (Yuksel et al.), scaled to [0,1].
  const m1x = p2.x - p1.x + d12 * ((p1.x - p0x) / d01 - (p2.x - p0x) / (d01 + d12));
  const m1y = p2.y - p1.y + d12 * ((p1.y - p0y) / d01 - (p2.y - p0y) / (d01 + d12));
  const m2x = p2.x - p1.x + d12 * ((p3x - p2.x) / d23 - (p3x - p1.x) / (d12 + d23));
  const m2y = p2.y - p1.y + d12 * ((p3y - p2.y) / d23 - (p3y - p1.y) / (d12 + d23));
  out[0] = p1.x;
  out[1] = p1.y;
  out[2] = p1.x + m1x / 3;
  out[3] = p1.y + m1y / 3;
  out[4] = p2.x - m2x / 3;
  out[5] = p2.y - m2y / 3;
  out[6] = p2.x;
  out[7] = p2.y;
}

/** Number of line pieces so the flattened Bezier stays within `tol` px (Wang's formula), also capped by length. */
export function flattenSteps(b: Float64Array, tol: number, maxLen: number): number {
  const ax = b[0] - 2 * b[2] + b[4];
  const ay = b[1] - 2 * b[3] + b[5];
  const bx = b[2] - 2 * b[4] + b[6];
  const by = b[3] - 2 * b[5] + b[7];
  const m = Math.sqrt(Math.max(ax * ax + ay * ay, bx * bx + by * by));
  const nCurve = Math.ceil(Math.sqrt((0.75 * m) / tol));
  const chord = Math.hypot(b[6] - b[0], b[7] - b[1]) + 0.5 * (Math.hypot(b[2] - b[0], b[3] - b[1]) + Math.hypot(b[6] - b[4], b[7] - b[5]));
  const nLen = Math.ceil(chord / maxLen);
  return Math.max(1, Math.min(96, Math.max(nCurve, nLen)));
}

export function bezierAt(b: Float64Array, t: number, out: { x: number; y: number }): void {
  const u = 1 - t;
  const a = u * u * u;
  const c1 = 3 * u * u * t;
  const c2 = 3 * u * t * t;
  const d = t * t * t;
  out.x = a * b[0] + c1 * b[2] + c2 * b[4] + d * b[6];
  out.y = a * b[1] + c1 * b[3] + c2 * b[5] + d * b[7];
}

const bz = new Float64Array(8);
const tmp = { x: 0, y: 0 };

/**
 * Flattens segments [from, to) of `pts` (n valid points) starting at arc length s0, appending vertices
 * (excluding the segment start point, which the caller already has). Returns the arc length at the end.
 * `segEnds` receives, for each segment, the index in `out` of its last vertex.
 */
export function flatten(pts: CtrlPt[], n: number, from: number, to: number, s0: number, tol: number, maxLen: number, out: Vtx[], segEnds: number[]): number {
  let s = s0;
  for (let i = from; i < to; i++) {
    segmentBezier(pts, n, i, bz);
    const steps = flattenSteps(bz, tol, maxLen);
    let px = bz[0];
    let py = bz[1];
    const pa = pts[i].p;
    const pb = pts[i + 1].p;
    for (let k = 1; k <= steps; k++) {
      const t = k / steps;
      if (k === steps) {
        tmp.x = bz[6];
        tmp.y = bz[7];
      } else bezierAt(bz, t, tmp);
      s += Math.hypot(tmp.x - px, tmp.y - py);
      out.push({ x: tmp.x, y: tmp.y, p: pa + (pb - pa) * t, s });
      px = tmp.x;
      py = tmp.y;
    }
    segEnds.push(out.length - 1);
  }
  return s;
}
