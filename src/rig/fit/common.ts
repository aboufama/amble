/**
 * Shared template-fitting tools: limbs from skeleton paths, ink- and colour-aware pins (kids outline
 * every part, so a limb is pinned where its own drawn fill begins), heads and necks, touching legs
 * split by colour or by the gap between them, and held objects.
 */
import { fillHoles } from '../imgproc';
import type { Analysis, End } from '../analyze';
import type { BoneRole, CharacterKind, Facing } from '../types';
import { arcPoint, pathDown, pathLength, px, type P2 } from './graph';

export interface FitBone {
  name: string;
  role: BoneRole;
  parent: string | null;
  /** Joint and tip in working px. */
  a: P2;
  b: P2;
  dynamic?: boolean;
  rigid?: boolean;
}

/** Machine-readable problems found while fitting (they lower confidence and may trigger a retry). */
export type FitIssue =
  | 'no-head' | 'no-legs' | 'one-leg' | 'legs-merged' | 'missing-arm' | 'no-arms' | 'few-legs' | 'missing-wing'
  | 'no-tail' | 'short-body' | 'hint-dropped' | 'thin-strokes';

export interface Fit {
  kind: CharacterKind;
  facing: Facing;
  /** Ground contact, working px. */
  anchor: P2;
  bones: FitBone[];
  used: Set<End>;
  /** Kid-readable notes for the Bones view ("Amble's guess"). */
  notes: string[];
  issues: FitIssue[];
  /** Something a finer working grid would likely place better (a pin in a leaky outline). */
  retry?: boolean;
}

export function newFit(kind: CharacterKind, facing: Facing = 0): Fit {
  return { kind, facing, anchor: [0, 0], bones: [], used: new Set(), notes: [], issues: [] };
}

export const colourDist = (a: Analysis, i: number, j: number): number => {
  const c = a.rgb;
  return Math.hypot(c[i * 3] - c[j * 3], c[i * 3 + 1] - c[j * 3 + 1], c[i * 3 + 2] - c[j * 3 + 2]);
};

const labelCache = new WeakMap<Analysis, { labels: Int32Array; sizes: number[] }>();

/**
 * Every drawn colour region (bounded by ink, holes and colour changes) labelled once per analysis:
 * the pieces a child coloured in. Label 0 = ink, holes and background.
 */
export function colourRegions(a: Analysis): { labels: Int32Array; sizes: number[] } {
  const hit = labelCache.get(a);
  if (hit) return hit;
  const { w, h, solid, ink, holes } = a;
  const labels = new Int32Array(w * h);
  const sizes = [0];
  for (let i = 0; i < w * h; i++) {
    if (labels[i] || !solid[i] || ink[i] || holes[i]) continue;
    const id = sizes.length;
    const q = [i];
    labels[i] = id;
    for (let qi = 0; qi < q.length; qi++) {
      const p = q[qi];
      for (const n of [p - 1, p + 1, p - w, p + w]) {
        if (labels[n] || !solid[n] || ink[n] || holes[n] || colourDist(a, p, n) > 40) continue;
        labels[n] = id;
        q.push(n);
      }
    }
    sizes.push(q.length);
  }
  const out = { labels, sizes };
  labelCache.set(a, out);
  return out;
}

const regionCache = new WeakMap<Analysis, Map<number, Uint8Array | null>>();

/** The colour region (4-connected, not crossing ink, steps of similar colour) containing pixel s0. */
function flood(a: Analysis, s0: number, lab: Int32Array): number[] {
  const { w, solid, ink, holes } = a;
  const q = [s0];
  lab[s0] = s0;
  for (let qi = 0; qi < q.length; qi++) {
    const p = q[qi];
    for (const n of [p - 1, p + 1, p - w, p + w]) {
      if (lab[n] >= 0 || !solid[n] || ink[n] || holes[n] || colourDist(a, p, n) > 40) continue;
      lab[n] = s0;
      q.push(n);
    }
  }
  return q;
}

/**
 * The parent's drawn fill where a limb's path starts: the colour region of the path's first fill pixel,
 * or (when that is a small island: a star on a shirt, a button) the largest region around the start,
 * with enclosed islands (spots, eyes, stars) filled in. null when the drawing has no inner lines or
 * colour changes there (then the silhouette rules are used instead).
 */
function parentRegion(a: Analysis, path: number[]): Uint8Array | null {
  const start = path[0];
  let cache = regionCache.get(a);
  if (!cache) regionCache.set(a, (cache = new Map()));
  const hit = cache.get(start);
  if (hit !== undefined) return hit;
  const { w, h, solid, ink, holes } = a;
  const lab = new Int32Array(w * h).fill(-1);
  const ok = (i: number) => solid[i] && !ink[i] && !holes[i];
  const r = Math.max(2, Math.round(0.5 * a.dt[start]));
  const sx = start % w, sy = Math.floor(start / w);
  const floods = new Map<number, number[]>();
  let best: number[] = [];
  for (let y = sy - r; y <= sy + r; y++) for (let x = sx - r; x <= sx + r; x++) {
    const s0 = y * w + x;
    if (x < 0 || y < 0 || x >= w || y >= h || !ok(s0) || lab[s0] >= 0) continue;
    const q = flood(a, s0, lab);
    floods.set(s0, q);
    if (q.length > best.length) best = q;
  }
  const first = path.slice(0, Math.max(3, Math.ceil(path.length * 0.3))).find(ok);
  if (first !== undefined) {
    const own = lab[first] >= 0 ? floods.get(lab[first]) : flood(a, first, lab);
    if (own && own.length >= 0.25 * best.length) best = own;
  }
  let out: Uint8Array | null = null;
  if (best.length > 8 && best.length < a.area * 0.85) {
    const m = new Uint8Array(w * h);
    for (const p of best) m[p] = 1;
    out = fillHoles(m, w, h);
  }
  cache.set(start, out);
  return out;
}

/**
 * Along a path from the attach junction outward: the index where the path leaves the parent's fill and
 * crosses the ink, i.e. the first pixel of the limb's own fill. -1 = no such boundary.
 */
export function inkExit(a: Analysis, path: number[]): number {
  if (path.length < 4) return -1;
  const R = parentRegion(a, path);
  if (!R) return -1;
  let i = 0;
  // the path may start on an outline (a mouth, a seam): step onto the parent's fill first
  while (i < path.length * 0.3 && !R[path[i]]) i++;
  if (!R[path[i]]) return -1;
  while (i < path.length && R[path[i]]) i++;
  for (;;) {
    while (i < path.length && a.ink[path[i]]) i++;
    if (i >= path.length - 2) return -1;
    if (!R[path[i]]) return i;
    // back in the parent: the path only grazed its outline
    while (i < path.length && R[path[i]]) i++;
  }
}

/** Where a limb leaves the body: its ink exit, else where the thickness drops to the limb's own. */
export function exitIndex(a: Analysis, path: number[], limbThick: number): number {
  const ink = inkExit(a, path);
  if (ink >= 0) return ink;
  const lim = Math.max(1.2, limbThick * 1.35);
  for (let i = 0; i < path.length; i++) if (a.dt[path[i]] <= lim) return i;
  return Math.floor(path.length / 2);
}

/**
 * Where to pin a limb whose own fill starts at `from`: the back end of the limb's drawn shape along its
 * direction (an arm drawn over the shirt pivots at the centre of its drawn top, like a paper-doll pin).
 * null if the fill leaks (no closed outline).
 */
export function pinOfFill(a: Analysis, from: number, tipX: number, tipY: number, thick: number, far = false): P2 | null {
  const { w, solid, ink, holes } = a;
  const seen = new Set<number>([from]);
  const q = [from];
  for (let qi = 0; qi < q.length; qi++) {
    const p = q[qi];
    for (const n of [p - 1, p + 1, p - w, p + w]) {
      if (seen.has(n) || !solid[n] || ink[n] || holes[n] || colourDist(a, p, n) > 40) continue;
      seen.add(n);
      q.push(n);
      if (q.length > a.area * 0.35) return null;
    }
  }
  const fx = from % w, fy = Math.floor(from / w);
  let ux = tipX - fx, uy = tipY - fy;
  const ul = Math.hypot(ux, uy) || 1;
  ux /= ul;
  uy /= ul;
  let tmin = 0;
  for (const p of q) tmin = Math.min(tmin, (p % w - fx) * ux + (Math.floor(p / w) - fy) * uy);
  if (tmin > -1) return null;
  const band = tmin + Math.max(1.5, 0.9 * thick);
  let sx = 0, sy = 0, n = 0;
  for (const p of q) {
    const x = p % w, y = Math.floor(p / w);
    if ((x - fx) * ux + (y - fy) * uy <= band) {
      sx += x;
      sy += y;
      n++;
    }
  }
  if (!n) return null;
  const pin: P2 = [sx / n, sy / n];
  if (!far && Math.hypot(pin[0] - fx, pin[1] - fy) > 4 * thick + 6) return null;
  return pin;
}

/**
 * A thin thing held at the end of an arm (a wand, a sword): where the hand ends, or -1. The arm (and
 * the fist) are thick; the held thing is a long thin run after them, maybe with a blob at its end
 * (the wand's star).
 */
function heldObjectStart(a: Analysis, path: number[]): number {
  if (path.length < 8) return -1;
  const dts = path.map((p) => a.dt[p]);
  const firstHalf = dts.slice(0, Math.ceil(dts.length / 2)).sort((x, y) => x - y);
  const armThick = firstHalf[Math.floor(firstHalf.length / 2)];
  if (armThick < 2.2) return -1;
  const minRun = Math.max(4, 1.5 * armThick);
  for (let j = Math.floor(dts.length * 0.35); j < dts.length; j++) {
    if (dts[j] >= 0.5 * armThick) continue;
    let run = 0;
    while (j + run < dts.length && dts[j + run] < 0.55 * armThick) run++;
    if (run < minRun) {
      j += run;
      continue;
    }
    const k = j - 1;
    const total = pathLength(a, path), held = pathLength(a, path.slice(k));
    return k > 0 && held >= 0.2 * total ? k : -1;
  }
  return -1;
}

export interface LimbResult {
  start: P2;
  mid: P2;
  tip: P2;
  /** A held object split off the end of the limb (rigid), if any. */
  held?: { a: P2; b: P2 };
  /** The limb's drawn fill was found but no pin could be placed in it (leaky outline). */
  pinFallback?: boolean;
}

/**
 * Two-bone limb from its attach junction to its tip: pinned where the limb's own drawing starts, with
 * the elbow/knee at the arc-length middle. `mid`, when given (a hint), replaces the middle.
 */
export function limbGeometry(
  a: Analysis, parent: Int32Array, attach: number, e: End,
  opts: { held?: boolean; mid?: P2 | null; start?: P2 | null; farPin?: boolean } = {},
): LimbResult {
  let path = pathDown(parent, attach, e.p);
  if (!path.length) path = [e.p];
  // the limb's own thickness: the middle of the path (not its tip, which may be a held wand)
  const mids = path.slice(Math.floor(path.length * 0.25), Math.max(Math.floor(path.length * 0.25) + 1, Math.ceil(path.length * 0.75)))
    .map((p) => a.dt[p]).sort((x, y) => x - y);
  const thick = opts.held ? Math.min(e.thick * 3, mids[Math.floor(mids.length / 2)] ?? e.thick) : e.thick;
  const ex = Math.min(exitIndex(a, path, thick), path.length - 1);
  const entry = px(a, path[ex]);
  let tip: P2 = [e.tipX, e.tipY];
  let limbPath = path.slice(ex);
  let held: LimbResult['held'];
  if (opts.held) {
    const k = heldObjectStart(a, limbPath);
    if (k >= 0) {
      const hand = px(a, limbPath[k]);
      held = { a: hand, b: tip };
      limbPath = limbPath.slice(0, k + 1);
      tip = hand;
    }
  }
  const ie = inkExit(a, path);
  const pin = opts.start ?? (ie >= 0 ? pinOfFill(a, path[ie], tip[0], tip[1], thick, opts.farPin) : null);
  const start: P2 = pin ?? entry;
  const pinFallback = !opts.start && ie >= 0 && !pin;
  const lead = Math.hypot(entry[0] - start[0], entry[1] - start[1]);
  const endP = px(a, limbPath[limbPath.length - 1]);
  const ext = Math.hypot(tip[0] - endP[0], tip[1] - endP[1]);
  const skelLen = pathLength(a, limbPath);
  const half = (lead + skelLen + ext) / 2;
  let mid: P2;
  if (opts.mid) mid = opts.mid;
  else if (half <= lead) {
    const t = half / Math.max(1e-6, lead);
    mid = [start[0] + (entry[0] - start[0]) * t, start[1] + (entry[1] - start[1]) * t];
  } else if (half - lead <= skelLen && limbPath.length > 1) mid = arcPoint(a, limbPath, (half - lead) / skelLen);
  else {
    const t = ext > 0 ? (half - lead - skelLen) / ext : 0.5;
    mid = [endP[0] + (tip[0] - endP[0]) * t, endP[1] + (tip[1] - endP[1]) * t];
  }
  return { start, mid, tip, held, pinFallback };
}

export function pushLimb(fit: Fit, g: LimbResult, names: [string, string], roles: [BoneRole, BoneRole], parentName: string): void {
  if (g.pinFallback) fit.retry = true;
  fit.bones.push({ name: names[0], role: roles[0], parent: parentName, a: g.start, b: g.mid });
  fit.bones.push({ name: names[1], role: roles[1], parent: names[0], a: g.mid, b: g.tip });
  if (g.held) {
    fit.bones.push({ name: uniqueName(fit, 'held'), role: 'extra', parent: names[1], a: g.held.a, b: g.held.b, rigid: true });
  }
}

export function uniqueName(fit: Fit, base: string): string {
  const taken = new Set(fit.bones.map((b) => b.name));
  if (!taken.has(base)) return base;
  for (let k = 2; ; k++) if (!taken.has(`${base}${k}`)) return `${base}${k}`;
}

/** Straight two-bone limb between two points (legs found from colour regions or gaps). */
export function straightLimb(top: P2, bottom: P2): LimbResult {
  return { start: top, mid: [(top[0] + bottom[0]) / 2, (top[1] + bottom[1]) / 2], tip: bottom };
}

/** The neck on a path from the body up to the head end: the narrowest point below the head's widest. */
export function headJoint(a: Analysis, path: number[]): number {
  let hc = path.length - 1, best = -1;
  for (let i = Math.floor(path.length * 0.4); i < path.length; i++) if (a.dt[path[i]] > best) {
    best = a.dt[path[i]];
    hc = i;
  }
  let nk = -1, nd = Infinity;
  for (let i = 0; i < hc; i++) if (a.dt[path[i]] < nd) {
    nd = a.dt[path[i]];
    nk = i;
  }
  const span = hc;
  if (nk < 0 || nk <= span * 0.1 || nk >= span * 0.95 || nd > 0.85 * best) {
    // no clear neck: where the path leaves the head's inscribed circle
    const r = a.dt[path[hc]] * 0.95;
    const [cx, cy] = px(a, path[hc]);
    for (let i = hc; i > 0; i--) {
      const [x, y] = px(a, path[i]);
      if (Math.hypot(x - cx, y - cy) >= r) return i;
    }
    return 0;
  }
  return nk;
}

/** Walks from `from` along the unit direction (ux, uy) to the silhouette. */
export function castToEdge(a: Analysis, from: P2, ux: number, uy: number): P2 {
  let x = from[0], y = from[1];
  for (let k = 0; k < 1000; k++) {
    const nx = x + ux * 0.5, ny = y + uy * 0.5;
    const ix = Math.round(nx), iy = Math.round(ny);
    if (ix < 0 || iy < 0 || ix >= a.w || iy >= a.h || !a.solid[iy * a.w + ix]) break;
    x = nx;
    y = ny;
  }
  return [x, y];
}

interface Region {
  px: number[];
  minY: number;
  maxY: number;
  lum: number;
}

/**
 * Two legs drawn touching (near and far leg of an animal, trousers without a gap) look like one thick
 * leg to the silhouette. Colours and ink lines still separate them: flood the leg zone by colour, and if
 * two long regions sit side by side, return one leg per region (darker first: the far leg is usually
 * shaded). Holes (transparent gaps) are barriers too.
 */
export function splitByColour(a: Analysis, attach: number, e: End): { top: P2; bottom: P2 }[] | null {
  const { w, solid, ink, holes, rgb } = a;
  const beltY = Math.floor(attach / w) + 0.9 * a.dt[attach];
  const exitY = Math.ceil(Math.min(Math.max(beltY, Math.floor(attach / w) + 2), e.tipY - 4));
  const zone = new Uint8Array(solid.length);
  const win = 3 * e.thick + 4;
  const q = [e.p];
  zone[e.p] = 1;
  let zoneArea = 0, zoneMaxY = 0;
  for (let qi = 0; qi < q.length; qi++) {
    const p = q[qi];
    zoneArea++;
    zoneMaxY = Math.max(zoneMaxY, Math.floor(p / w));
    for (const n of [p - 1, p + 1, p - w, p + w]) {
      if (!solid[n] || zone[n] || Math.floor(n / w) < exitY || Math.abs((n % w) - e.tipX) > win) continue;
      zone[n] = 1;
      q.push(n);
    }
  }
  const reg = new Int32Array(solid.length).fill(-1);
  const regions: Region[] = [];
  for (const s of q) {
    if (ink[s] || holes[s] || reg[s] >= 0) continue;
    const id = regions.length;
    const r: Region = { px: [s], minY: Infinity, maxY: -1, lum: 0 };
    reg[s] = id;
    for (let k = 0; k < r.px.length; k++) {
      const p = r.px[k];
      const y = Math.floor(p / w);
      r.minY = Math.min(r.minY, y);
      r.maxY = Math.max(r.maxY, y);
      r.lum += rgb[p * 3] * 0.299 + rgb[p * 3 + 1] * 0.587 + rgb[p * 3 + 2] * 0.114;
      for (const n of [p - 1, p + 1, p - w, p + w]) {
        if (!zone[n] || ink[n] || holes[n] || reg[n] >= 0 || colourDist(a, p, n) > 40) continue;
        reg[n] = id;
        r.px.push(n);
      }
    }
    r.lum /= r.px.length;
    regions.push(r);
  }
  const span = Math.max(1, zoneMaxY - exitY);
  const big = regions
    .filter((r) => r.px.length >= 0.18 * zoneArea && r.maxY - r.minY >= 0.5 * span)
    .sort((m, n) => n.px.length - m.px.length)
    .slice(0, 2);
  if (big.length < 2) return null;
  const meanX = (pts: number[], pred: (y: number) => boolean) => {
    let s = 0, n = 0;
    for (const p of pts) if (pred(Math.floor(p / w))) {
      s += p % w;
      n++;
    }
    return n ? s / n : pts[0] % w;
  };
  for (const r of big) {
    const seen = new Uint8Array(solid.length);
    for (const p of r.px) seen[p] = 1;
    const qq = [...r.px];
    let leaked = false;
    for (let qi = 0; qi < qq.length && !leaked; qi++) {
      const p = qq[qi];
      for (const n of [p - 1, p + 1, p - w, p + w]) {
        if (seen[n] || !solid[n] || ink[n] || holes[n] || colourDist(a, p, n) > 40) continue;
        seen[n] = 1;
        qq.push(n);
        if (qq.length > r.px.length * 2.5) {
          leaked = true;
          break;
        }
      }
    }
    if (!leaked) {
      r.px = qq;
      for (const p of qq) r.minY = Math.min(r.minY, Math.floor(p / w));
    }
  }
  return big
    .sort((m, n) => m.lum - n.lum)
    .map((r) => {
      const tx = meanX(r.px, (y) => y <= r.minY + 2);
      const bxm = meanX(r.px, (y) => y >= r.maxY - 2);
      let by = r.maxY;
      while (solid[(by + 1) * w + Math.round(bxm)]) by++;
      const topY = Math.min(exitY, r.minY + 0.35 * (exitY - r.minY) + 1);
      return { top: [tx, topY] as P2, bottom: [bxm, by + 0.5] as P2 };
    });
}

/**
 * Legs merged because their feet touch: the gap between them was an enclosed hole that got filled.
 * The hole (transparent in the drawing) still marks the split: left of it is one leg, right the other.
 * Returns [left, right] legs, or null when there is no such gap.
 */
export function splitAtGap(a: Analysis, below: number): { top: P2; bottom: P2 }[] | null {
  const { w, h, holes, solid, bbox } = a;
  const H = bbox.y1 - bbox.y0 + 1, W = bbox.x1 - bbox.x0 + 1;
  // the tallest narrow hole in the lower part of the shape
  const seen = new Uint8Array(w * h);
  let best: { px: number[]; x0: number; x1: number; y0: number; y1: number } | null = null;
  for (let i = 0; i < w * h; i++) {
    if (!holes[i] || seen[i] || Math.floor(i / w) < below) continue;
    const q = [i];
    seen[i] = 1;
    let x0 = w, x1 = 0, y0 = h, y1 = 0;
    for (let k = 0; k < q.length; k++) {
      const p = q[k];
      const x = p % w, y = Math.floor(p / w);
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
      for (const n of [p - 1, p + 1, p - w, p + w]) if (holes[n] && !seen[n]) {
        seen[n] = 1;
        q.push(n);
      }
    }
    const tall = y1 - y0 + 1, wide = x1 - x0 + 1;
    if (tall < 0.08 * H || wide > 0.3 * W || tall < 1.5 * wide) continue;
    if (!best || tall > best.y1 - best.y0) best = { px: q, x0, x1, y0, y1 };
  }
  if (!best) return null;
  const gapX = new Float32Array(h).fill(NaN);
  const sums = new Float32Array(h), counts = new Float32Array(h);
  for (const p of best.px) {
    sums[Math.floor(p / w)] += p % w;
    counts[Math.floor(p / w)]++;
  }
  for (let y = best.y0; y <= best.y1; y++) if (counts[y]) gapX[y] = sums[y] / counts[y];
  let last = (best.x0 + best.x1) / 2;
  for (let y = best.y0; y < h; y++) {
    if (Number.isNaN(gapX[y])) gapX[y] = last;
    last = gapX[y];
  }
  const legs: { top: P2; bottom: P2 }[] = [];
  for (const side of [-1, 1]) {
    let bottomY = -1, sumX = 0, n = 0, topSum = 0, topN = 0;
    for (let y = best.y0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (!solid[i] || holes[i]) continue;
        if (Math.sign(x - gapX[y]) !== side || Math.abs(x - gapX[y]) > 0.35 * W) continue;
        if (y <= best.y0 + 1) {
          topSum += x;
          topN++;
        }
        if (y > bottomY) {
          bottomY = y;
          sumX = 0;
          n = 0;
        }
        if (y === bottomY) {
          sumX += x;
          n++;
        }
      }
    }
    if (!n || !topN) return null;
    legs.push({ top: [topSum / topN, best.y0], bottom: [sumX / n, bottomY + 0.5] });
  }
  return legs;
}

/** The mean colour luma of the working pixels around a point (the far leg is usually darker). */
export function lumaAt(a: Analysis, p: P2): number {
  const i = Math.round(p[1]) * a.w + Math.round(p[0]);
  return a.rgb[i * 3] * 0.299 + a.rgb[i * 3 + 1] * 0.587 + a.rgb[i * 3 + 2] * 0.114;
}
