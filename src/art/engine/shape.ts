/**
 * "Hold to perfect": when the pen rests at the end of a stroke, recognise a line, a circle/ellipse or a
 * triangle/rectangle/polygon and return the perfected outline as dense points. Also builds the outlines
 * of explicit shapes (stroke scripts and shape tools).
 */
import { type Point, segDist } from './geom';
import { flatten as flattenSpline } from './spline';

export type PerfectKind = 'line' | 'circle' | 'ellipse' | 'triangle' | 'rectangle' | 'polygon';

export interface PerfectShape {
  kind: PerfectKind;
  pts: Point[];
}

function resample(pts: Point[], step: number): Point[] {
  const out: Point[] = [{ x: pts[0].x, y: pts[0].y }];
  let carry = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const d = Math.hypot(b.x - a.x, b.y - a.y);
    let t = step - carry;
    while (t <= d) {
      out.push({ x: a.x + ((b.x - a.x) * t) / d, y: a.y + ((b.y - a.y) * t) / d });
      t += step;
    }
    carry = d - (t - step);
  }
  return out;
}

function rdp(pts: Point[], eps: number): Point[] {
  if (pts.length < 3) return pts.slice();
  let best = -1;
  let bestD = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = segDist(pts[i], pts[0], pts[pts.length - 1]);
    if (d > bestD) {
      bestD = d;
      best = i;
    }
  }
  if (bestD <= eps) return [pts[0], pts[pts.length - 1]];
  const l = rdp(pts.slice(0, best + 1), eps);
  const r = rdp(pts.slice(best), eps);
  return l.slice(0, -1).concat(r);
}

/** Fewer points along a path, none of them moved more than `eps` px (Ramer-Douglas-Peucker). */
export function simplifyPath(pts: Point[], eps: number): Point[] {
  return pts.length < 3 ? pts.slice() : rdp(pts, eps);
}

/** Points every ~`step` px along the polyline (the last point included). */
export function densify(poly: Point[], step: number): Point[] {
  const out: Point[] = [];
  for (let i = 0; i < poly.length - 1; i++) {
    const a = poly[i];
    const b = poly[i + 1];
    const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / step));
    for (let k = 0; k < n; k++) out.push({ x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n });
  }
  const last = poly[poly.length - 1];
  out.push({ x: last.x, y: last.y });
  return out;
}

export function recognize(input: Point[]): PerfectShape | null {
  if (input.length < 4) return null;
  let len = 0;
  for (let i = 1; i < input.length; i++) len += Math.hypot(input[i].x - input[i - 1].x, input[i].y - input[i - 1].y);
  if (len < 24) return null;
  const pts = resample(input, Math.max(1, len / 200));
  const a = pts[0];
  const b = pts[pts.length - 1];
  const chord = Math.hypot(b.x - a.x, b.y - a.y);

  // Line: everything close to the chord.
  let dev = 0;
  for (const p of pts) dev = Math.max(dev, segDist(p, a, b));
  if (chord > len * 0.5 && dev < Math.max(3, chord * 0.06)) return { kind: 'line', pts: densify([a, b], 3) };

  const closed = chord < len * 0.18;
  if (!closed) return null;

  // Polygon: few corners with straight sides.
  const poly = rdp(pts, Math.max(3, len * 0.035));
  let corners = poly.slice(0, -1); // the last point is (nearly) the first one
  // Merge a start point that sits on a straight side.
  if (corners.length >= 4) {
    const n = corners.length;
    if (segDist(corners[0], corners[n - 1], corners[1]) < len * 0.03) corners = corners.slice(1);
  }
  if (corners.length >= 3 && corners.length <= 5) {
    let straight = true;
    for (let i = 0; i < corners.length && straight; i++) {
      const c0 = corners[i];
      const c1 = corners[(i + 1) % corners.length];
      if (Math.hypot(c1.x - c0.x, c1.y - c0.y) < len * 0.06) straight = false;
    }
    if (straight) {
      let pdev = 0;
      for (const p of pts) {
        let d = Infinity;
        for (let i = 0; i < corners.length; i++) d = Math.min(d, segDist(p, corners[i], corners[(i + 1) % corners.length]));
        pdev = Math.max(pdev, d);
      }
      if (pdev < len * 0.035) {
        let ring = corners;
        const kind: PerfectKind = corners.length === 3 ? 'triangle' : corners.length === 4 ? 'rectangle' : 'polygon';
        if (kind === 'rectangle') ring = squareUp(corners);
        return { kind, pts: densify([...ring, ring[0], ring[1]], 3).slice(0, -1) };
      }
    }
  }

  // Ellipse by principal axes; circle if nearly round.
  let cx = 0;
  let cy = 0;
  for (const p of pts) {
    cx += p.x;
    cy += p.y;
  }
  cx /= pts.length;
  cy /= pts.length;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (const p of pts) {
    sxx += (p.x - cx) ** 2;
    syy += (p.y - cy) ** 2;
    sxy += (p.x - cx) * (p.y - cy);
  }
  sxx /= pts.length;
  syy /= pts.length;
  sxy /= pts.length;
  const tr = sxx + syy;
  const det = sxx * syy - sxy * sxy;
  const l1 = tr / 2 + Math.sqrt(Math.max(0, (tr * tr) / 4 - det));
  const l2 = tr / 2 - Math.sqrt(Math.max(0, (tr * tr) / 4 - det));
  const ang = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  let ra = Math.sqrt(2 * l1);
  let rb = Math.sqrt(2 * Math.max(l2, 1e-6));
  let err = 0;
  const ca = Math.cos(ang);
  const sa = Math.sin(ang);
  for (const p of pts) {
    const x = (p.x - cx) * ca + (p.y - cy) * sa;
    const y = -(p.x - cx) * sa + (p.y - cy) * ca;
    err += (Math.sqrt((x / ra) ** 2 + (y / rb) ** 2) - 1) ** 2;
  }
  err = Math.sqrt(err / pts.length);
  if (err > 0.13) return null;
  let kind: PerfectKind = 'ellipse';
  if (rb / ra > 0.88) {
    ra = rb = (ra + rb) / 2;
    kind = 'circle';
  }
  // Start where the stroke started, go the way it went, overlap a little so the join is seamless.
  let area = 0;
  for (let i = 1; i < pts.length; i++) area += pts[i - 1].x * pts[i].y - pts[i].x * pts[i - 1].y;
  const dir = area >= 0 ? 1 : -1;
  const x0 = (a.x - cx) * ca + (a.y - cy) * sa;
  const y0 = -(a.x - cx) * sa + (a.y - cy) * ca;
  const t0 = Math.atan2(y0 / rb, x0 / ra);
  const n = Math.max(48, Math.ceil((Math.PI * 2 * Math.max(ra, rb)) / 3));
  const out: Point[] = [];
  for (let k = 0; k <= n * 1.03; k++) {
    const t = t0 + (dir * 2 * Math.PI * k) / n;
    const x = ra * Math.cos(t);
    const y = rb * Math.sin(t);
    out.push({ x: cx + x * ca - y * sa, y: cy + x * sa + y * ca });
  }
  return { kind, pts: out };
}

/** Makes a rough quadrilateral a true rectangle aligned to its average edge direction. */
function squareUp(c: Point[]): Point[] {
  let ang = 0;
  let wsum = 0;
  for (let i = 0; i < 4; i++) {
    const a = c[i];
    const b = c[(i + 1) % 4];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    let t = Math.atan2(b.y - a.y, b.x - a.x);
    t = ((t % (Math.PI / 2)) + Math.PI / 2) % (Math.PI / 2); // fold to [0, 90deg)
    if (t > Math.PI / 4) t -= Math.PI / 2;
    ang += t * len;
    wsum += len;
  }
  ang /= wsum;
  if (Math.abs(ang) < (4 * Math.PI) / 180) ang = 0; // snap to axis-aligned
  const ca = Math.cos(ang);
  const sa = Math.sin(ang);
  const local = c.map((p) => ({ x: p.x * ca + p.y * sa, y: -p.x * sa + p.y * ca }));
  const xs = local.map((p) => p.x).sort((a, b) => a - b);
  const ys = local.map((p) => p.y).sort((a, b) => a - b);
  const x0 = (xs[0] + xs[1]) / 2;
  const x1 = (xs[2] + xs[3]) / 2;
  const y0 = (ys[0] + ys[1]) / 2;
  const y1 = (ys[2] + ys[3]) / 2;
  const box = [
    { x: x0, y: y0 },
    { x: x1, y: y0 },
    { x: x1, y: y1 },
    { x: x0, y: y1 },
  ];
  // Keep the drawing order starting from the corner nearest the first drawn corner.
  let start = 0;
  let best = Infinity;
  for (let i = 0; i < 4; i++) {
    const d = Math.hypot(box[i].x - local[0].x, box[i].y - local[0].y);
    if (d < best) {
      best = d;
      start = i;
    }
  }
  const cw = (local[1].x - local[0].x) * (local[2].y - local[0].y) - (local[1].y - local[0].y) * (local[2].x - local[0].x) > 0;
  const order = [0, 1, 2, 3].map((k) => box[(start + (cw ? k : 4 - k)) % 4]);
  return order.map((p) => ({ x: p.x * ca - p.y * sa, y: p.x * sa + p.y * ca }));
}

export type ShapeKind = 'line' | 'ellipse' | 'rect' | 'triangle' | 'polygon' | 'curve';

export interface ShapeOutline {
  /** Dense outline points (closed shapes end where they start). */
  outline: Point[];
  /** The interior polygon for filled shapes; null for lines. */
  polygon: Point[] | null;
}

/** A smooth curve through the points (centripetal Catmull-Rom), as dense points. */
export function curveThrough(pts: Point[], step = 2): Point[] {
  if (pts.length < 3) return densify(pts, step);
  const ctrl = pts.map((p) => ({ x: p.x, y: p.y, p: 1 }));
  const out: Array<{ x: number; y: number; p: number; s: number }> = [{ x: ctrl[0].x, y: ctrl[0].y, p: 1, s: 0 }];
  flattenSpline(ctrl, ctrl.length, 0, ctrl.length - 1, 0, 0.25, step, out, []);
  return out.map((v) => ({ x: v.x, y: v.y }));
}

/** Whether a curve's ends meet (it closes into a shape that can be filled). */
export function curveCloses(pts: Point[]): boolean {
  if (pts.length < 3) return false;
  const a = pts[0];
  const b = pts[pts.length - 1];
  let len = 0;
  for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  return Math.hypot(b.x - a.x, b.y - a.y) <= Math.max(6, len * 0.06);
}

/**
 * Outline of an explicit shape. line: 2+ points (a polyline); rect: two opposite corners; ellipse: two
 * corners of its bounding box; triangle: three corners; polygon: its corners (closed); curve: a smooth curve
 * through 2+ points (filled when its ends meet). Returns null when the points do not fit.
 */
export function shapeOutline(kind: ShapeKind, pts: Point[], step = 2): ShapeOutline | null {
  if (kind === 'line') {
    if (pts.length < 2) return null;
    return { outline: densify(pts, step), polygon: null };
  }
  if (kind === 'curve') {
    if (pts.length < 2) return null;
    const closed = curveCloses(pts);
    const outline = curveThrough(closed ? [...pts.slice(0, -1), pts[0]] : pts, step);
    return { outline, polygon: closed ? outline : null };
  }
  if (kind === 'polygon') {
    if (pts.length < 3) return null;
    return { outline: densify([...pts, pts[0]], step), polygon: pts };
  }
  if (kind === 'triangle') {
    if (pts.length < 3) return null;
    const ring = [pts[0], pts[1], pts[2]];
    return { outline: densify([...ring, ring[0]], step), polygon: ring };
  }
  if (pts.length < 2) return null;
  const x0 = Math.min(pts[0].x, pts[1].x);
  const x1 = Math.max(pts[0].x, pts[1].x);
  const y0 = Math.min(pts[0].y, pts[1].y);
  const y1 = Math.max(pts[0].y, pts[1].y);
  if (kind === 'rect') {
    const ring = [
      { x: x0, y: y0 },
      { x: x1, y: y0 },
      { x: x1, y: y1 },
      { x: x0, y: y1 },
    ];
    return { outline: densify([...ring, ring[0]], step), polygon: ring };
  }
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const rx = (x1 - x0) / 2;
  const ry = (y1 - y0) / 2;
  const n = Math.max(24, Math.ceil((2 * Math.PI * Math.max(rx, ry)) / step));
  const ring: Point[] = [];
  for (let k = 0; k < n; k++) {
    const t = (2 * Math.PI * k) / n;
    ring.push({ x: cx + rx * Math.cos(t), y: cy + ry * Math.sin(t) });
  }
  return { outline: [...ring, ring[0]], polygon: ring };
}
