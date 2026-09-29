/**
 * Shape analysis of a drawing, on a small working grid (longest side 150-240 px, so it takes a few ms):
 * alpha mask → bridge near pieces → fill holes (including almost-closed outlines) → exact distance
 * transform → ink and colour per working pixel → Zhang-Suen skeleton → scale-free spur pruning →
 * extremities. The template fitters and the binder share this result.
 */
import {
  close, components, downsampleMax, edt, fillHoles, makeThin, neighbourCount, open, RING_DX, RING_DY,
  stampLine, zhangSuen,
} from './imgproc';
import type { LayerPixels, Pixels, RigInput } from './types';

/** Layers that never help find bones (they are guides, construction lines or soft shadows). */
export const EXCLUDED_LAYERS = ['shading', 'sketch', 'guide', 'reference'];

export interface End {
  /** Skeleton endpoint pixel. */
  p: number;
  x: number;
  y: number;
  /** The tip, extended from the endpoint to the silhouette. */
  tipX: number;
  tipY: number;
  /** Branch length to its junction (or the whole skeleton). */
  len: number;
  /** -1 if none. */
  junction: number;
  /** Median distance-to-edge along the outer half of the branch (the limb radius). */
  thick: number;
  /** Max distance-to-edge along the outer half (heads are bulky). */
  bulk: number;
}

export interface Analysis {
  artW: number;
  artH: number;
  /** Working px per art px. */
  scale: number;
  pad: number;
  w: number;
  h: number;
  /** Alpha mask (after excluded layers). */
  raw: Uint8Array;
  /** Ink lines at working resolution: part boundaries follow them. */
  ink: Uint8Array;
  /** Ink at art resolution (1 = ink): from the `lines` layer when given, else dark and thin pixels. */
  inkArt: Uint8Array;
  /** True when `inkArt` came from a `lines` layer (exact). */
  inkFromLayer: boolean;
  /** Average colour per working pixel (opaque source pixels only). */
  rgb: Uint8ClampedArray;
  /** Distance to the outside or the nearest ink line (each drawn part's own thickness). */
  dtInk: Float32Array;
  /** Main shape: bridged, holes filled. */
  solid: Uint8Array;
  /** Pixels added by hole filling: transparent in the drawing (the gap between touching boots). */
  holes: Uint8Array;
  /** Pieces too far to bridge (floating hats, text): attached rigidly later. */
  loose: Uint8Array;
  /** Distance to the outside, inside `solid`. */
  dt: Float32Array;
  bbox: { x0: number; y0: number; x1: number; y1: number };
  cx: number;
  cy: number;
  area: number;
  /** Longest side of the shape's box, in working px. */
  maxDim: number;
  skel: Uint8Array;
  ends: End[];
  pruned: number;
  /** Typical limb radius (working px). */
  limbR: number;
  /** Median ink stroke width (working px), 0 without ink. */
  strokeW: number;
}

export const toArtX = (a: Analysis, x: number): number => (x - a.pad) / a.scale;
export const toArtY = (a: Analysis, y: number): number => (y - a.pad) / a.scale;
export const toWorkX = (a: Analysis, x: number): number => x * a.scale + a.pad;
export const toWorkY = (a: Analysis, y: number): number => y * a.scale + a.pad;

/** Alpha of a layer at art pixel (x, y), honouring its offset. */
export function layerAlpha(l: LayerPixels, x: number, y: number): number {
  const lx = x - (l.x ?? 0), ly = y - (l.y ?? 0);
  if (lx < 0 || ly < 0 || lx >= l.width || ly >= l.height) return 0;
  return l.data[(ly * l.width + lx) * 4 + 3];
}

const luma = (d: Uint8ClampedArray, o: number) => 0.299 * d[o] + 0.587 * d[o + 1] + 0.114 * d[o + 2];

/**
 * The alpha the rigger looks at: the flattened drawing minus pixels that only an excluded layer
 * (shading, sketch...) painted. A marker ground shadow must not become a limb.
 */
function analysisAlpha(img: Pixels, layers: Record<string, LayerPixels> | undefined): Uint8Array {
  const n = img.width * img.height;
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = img.data[i * 4 + 3];
  if (!layers) return out;
  for (const name of EXCLUDED_LAYERS) {
    const l = layers[name];
    if (!l) continue;
    for (let y = 0; y < img.height; y++) {
      for (let x = 0; x < img.width; x++) {
        const la = layerAlpha(l, x, y);
        if (la <= 16) continue;
        const i = y * img.width + x;
        // the flat pixel is (nearly) only this layer: nothing else was painted there
        if (out[i] - la <= 24) out[i] = 0;
      }
    }
  }
  return out;
}

function edgePixels(m: Uint8Array, w: number, h: number): number[] {
  const out: number[] = [];
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x;
    if (m[i] && (!m[i - 1] || !m[i + 1] || !m[i - w] || !m[i + w])) out.push(i);
  }
  return out;
}

/** Typical ink stroke width in working px: twice the upper-quartile half-width (0 without ink). */
function strokeWidth(ink: Uint8Array, w: number, h: number): number {
  const idt = edt(ink, w, h);
  const vals: number[] = [];
  for (let i = 0; i < w * h; i++) if (ink[i]) vals.push(idt[i]);
  if (vals.length <= 8) return 0;
  vals.sort((a, b) => a - b);
  return 2 * vals[Math.floor(vals.length * 0.75)];
}

export interface ShapeOptions {
  /** Longest side of the working grid (150 by default; 240 splits limbs drawn close together). */
  workSize?: number;
}

/** Mask, ink, colours, holes and distance fields at the working resolution. */
export function analyzeShape(input: RigInput, opts: ShapeOptions = {}): Omit<Analysis, 'skel' | 'ends' | 'pruned' | 'limbR'> {
  const img = input.image;
  const W = img.width, H = img.height;
  const workSize = opts.workSize ?? 150;
  const scale = Math.min(1, workSize / Math.max(W, H));
  const pad = 4;
  const alpha = analysisAlpha(img, input.layers);
  const mi = downsampleMax(alpha, W, H, scale, pad, 24);
  const { w, h } = mi;
  const raw = mi.m;
  let bx0 = w, by0 = h, bx1 = 0, by1 = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (raw[y * w + x]) {
    if (x < bx0) bx0 = x;
    if (x > bx1) bx1 = x;
    if (y < by0) by0 = y;
    if (y > by1) by1 = y;
  }
  const maxDim = Math.max(1, Math.max(bx1 - bx0, by1 - by0) + 1);
  const r = Math.max(1, Math.round(maxDim * 0.012));
  // 1) keep the biggest piece; bridge near pieces (an arm drawn not quite touching the body); the rest
  //    are loose accessories. No global closing: it would merge legs drawn close together.
  const { labels, sizes } = components(raw, w, h);
  let main = 1;
  for (let k = 1; k < sizes.length; k++) if (sizes[k] > sizes[main]) main = k;
  const solid0 = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) if (labels[i] === main) solid0[i] = 1;
  const loose = new Uint8Array(w * h);
  const total = sizes.reduce((a, b) => a + b, 0);
  const mainEdge = sizes.length > 2 ? edgePixels(solid0, w, h) : [];
  for (let k = 1; k < sizes.length; k++) {
    if (k === main || sizes[k] === 0) continue;
    const mine: number[] = [];
    for (let i = 0; i < w * h; i++) if (labels[i] === k) mine.push(i);
    const big = sizes[k] >= total * 0.015;
    if (!big) {
      for (const i of mine) loose[i] = 1;
      continue;
    }
    const piece = new Uint8Array(w * h);
    for (const i of mine) piece[i] = 1;
    let best = Infinity, bi = -1, bj = -1;
    for (const a of edgePixels(piece, w, h)) {
      const ax = a % w, ay = (a - ax) / w;
      for (const b of mainEdge) {
        const bx = b % w, by = (b - bx) / w;
        const d = (ax - bx) * (ax - bx) + (ay - by) * (ay - by);
        if (d < best) {
          best = d;
          bi = a;
          bj = b;
        }
      }
    }
    if (bi >= 0 && Math.sqrt(best) <= maxDim * 0.1) {
      for (const i of mine) solid0[i] = 1;
      stampLine(solid0, w, h, bi % w, Math.floor(bi / w), bj % w, Math.floor(bj / w), Math.max(1, r));
    } else {
      for (const i of mine) loose[i] = 1;
    }
  }
  // 2) colour and ink per working pixel
  const lines = input.layers?.lines;
  const inkArt = new Uint8Array(W * H);
  const dark = new Uint8Array(W * H);
  const d = img.data;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    if (lines) {
      if (layerAlpha(lines, x, y) > 96) inkArt[i] = 1;
    } else if (d[i * 4 + 3] >= 128 && luma(d, i * 4) < 72) dark[i] = 1;
  }
  const rgb = new Uint8ClampedArray(w * h * 3);
  const inkW = new Uint8Array(w * h);
  const darkW = new Uint8Array(w * h);
  const inv = 1 / scale;
  const iw = w - 2 * pad, ih = h - 2 * pad;
  for (let y = 0; y < ih; y++) {
    const sy0 = Math.min(H - 1, Math.floor(y * inv)), sy1 = Math.min(H, Math.max(sy0 + 1, Math.floor((y + 1) * inv)));
    for (let x = 0; x < iw; x++) {
      const sx0 = Math.min(W - 1, Math.floor(x * inv)), sx1 = Math.min(W, Math.max(sx0 + 1, Math.floor((x + 1) * inv)));
      let n = 0, nk = 0, nd = 0, rr = 0, gg = 0, bb = 0;
      for (let yy = sy0; yy < sy1; yy++) for (let xx = sx0; xx < sx1; xx++) {
        const i = yy * W + xx, o = i * 4;
        if (d[o + 3] < 128) {
          if (inkArt[i]) nk++;
          continue;
        }
        n++;
        rr += d[o];
        gg += d[o + 1];
        bb += d[o + 2];
        if (inkArt[i]) nk++;
        if (dark[i]) nd++;
      }
      const wi = (y + pad) * w + x + pad;
      if (n) {
        rgb[wi * 3] = rr / n;
        rgb[wi * 3 + 1] = gg / n;
        rgb[wi * 3 + 2] = bb / n;
      }
      const cnt = Math.max(1, n);
      if (nk >= 0.25 * cnt) inkW[wi] = 1;
      if (nd >= 0.25 * cnt && n) darkW[wi] = 1;
    }
  }
  let ink = inkW;
  if (!lines) {
    // Without a lines layer, ink is dark AND thin: a dark region wider than a few strokes is a fill
    // (navy trousers, a black cat), not an outline.
    const R = Math.max(1.5, 0.02 * maxDim);
    const thick = open(darkW, w, h, R);
    ink = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) ink[i] = darkW[i] && !thick[i] ? 1 : 0;
    for (let y = 0; y < H; y++) {
      const wy = Math.min(h - 1, Math.floor(y * scale) + pad);
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        if (dark[i] && !thick[wy * w + Math.min(w - 1, Math.floor(x * scale) + pad)]) inkArt[i] = 1;
      }
    }
  }
  const strokeW = strokeWidth(ink, w, h);
  // 3) holes. The inside of an outline (a circle head drawn as a ring, a hollow body) is filled so it
  //    becomes solid. A gap enclosed by thick coloured parts (a raised hand touching the hair, boots that
  //    touch, hands on hips) stays open: filling it would glue those parts together.
  const dt0 = edt(solid0, w, h);
  const strokeHalf = Math.max(1, strokeW / 2);
  const rimR = Math.ceil(strokeHalf + 2);
  const rimIsThin = (hole: number[], inHole: (i: number) => boolean) => {
    let n = 0, thick = 0;
    for (const p of hole) for (const nb of [p - 1, p + 1, p - w, p + w]) {
      if (!solid0[nb] || inHole(nb)) continue;
      n++;
      const bx = nb % w, by = (nb - bx) / w;
      let m = 0;
      for (let yy = Math.max(0, by - rimR); yy <= Math.min(h - 1, by + rimR); yy++) {
        for (let xx = Math.max(0, bx - rimR); xx <= Math.min(w - 1, bx + rimR); xx++) m = Math.max(m, dt0[yy * w + xx]);
      }
      if (m > strokeHalf + 1.5) thick++;
    }
    return n === 0 || thick < 0.5 * n;
  };
  const solid = solid0.slice();
  {
    const enclosed = fillHoles(solid0, w, h);
    const cand = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) if (enclosed[i] && !solid0[i]) cand[i] = 1;
    const hl = components(cand, w, h);
    const members: number[][] = hl.sizes.map(() => []);
    for (let i = 0; i < w * h; i++) if (hl.labels[i]) members[hl.labels[i]].push(i);
    for (let k = 1; k < hl.sizes.length; k++) {
      if (members[k].length > 3 && !rimIsThin(members[k], (i) => hl.labels[i] === k)) continue;
      for (const i of members[k]) solid[i] = 1;
    }
  }
  // 4) almost-closed outlines (a circle head with a small gap): a hole that a closing would create is
  //    filled only if it is fat (inscribed radius >= 3px) behind a small "door" and its rim is an outline.
  //    Thin gaps (between two legs, an arm along the body) stay open.
  {
    const rc = Math.max(1, Math.round(maxDim * 0.015));
    const closed = close(solid, w, h, rc);
    const filledC = fillHoles(closed, w, h);
    const cand = new Uint8Array(w * h);
    let any = false;
    for (let i = 0; i < w * h; i++) if (filledC[i] && !closed[i]) {
      cand[i] = 1;
      any = true;
    }
    if (any) {
      const hl = components(cand, w, h);
      const hdt = edt(cand, w, h);
      const door = new Uint8Array(w * h);
      for (let i = 0; i < w * h; i++) door[i] = closed[i] && !solid[i] ? 1 : 0;
      const members: number[][] = hl.sizes.map(() => []);
      for (let i = 0; i < w * h; i++) if (hl.labels[i]) members[hl.labels[i]].push(i);
      for (let k = 1; k < hl.sizes.length; k++) {
        let fat = 0, doorN = 0;
        for (const i of members[k]) {
          fat = Math.max(fat, hdt[i]);
          if (door[i - 1] || door[i + 1] || door[i - w] || door[i + w]) doorN++;
        }
        if (fat < 3 || hl.sizes[k] < 4 * Math.max(1, doorN)) continue;
        if (!rimIsThin(members[k], (i) => hl.labels[i] === k || door[i] === 1)) continue;
        let q = [...members[k]];
        for (const i of q) solid[i] = 1;
        for (let depth = 0; depth <= 2 * rc && q.length; depth++) {
          const next: number[] = [];
          for (const p of q) for (const nb of [p - 1, p + 1, p - w, p + w]) if (door[nb] && !solid[nb]) {
            solid[nb] = 1;
            next.push(nb);
          }
          q = next;
        }
      }
    }
  }
  const holes = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) holes[i] = solid[i] && !raw[i] ? 1 : 0;
  const dt = edt(solid, w, h);
  const noInk = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) noInk[i] = solid[i] && !ink[i] ? 1 : 0;
  const dtInk = edt(noInk, w, h);
  let x0 = w, y0 = h, x1 = 0, y1 = 0, sx = 0, sy = 0, area = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!solid[y * w + x]) continue;
    area++;
    sx += x;
    sy += y;
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  if (!area) {
    x0 = y0 = x1 = y1 = pad;
  }
  return {
    artW: W, artH: H, scale, pad, w, h, raw, ink, inkArt, inkFromLayer: !!lines, rgb, dtInk, solid, holes, loose, dt,
    bbox: { x0, y0, x1, y1 }, cx: area ? sx / area : w / 2, cy: area ? sy / area : h / 2, area,
    maxDim: Math.max(1, Math.max(x1 - x0, y1 - y0) + 1), strokeW,
  };
}

interface Branch {
  /** Endpoint ... (junction excluded). */
  path: number[];
  junction: number;
  len: number;
}

export function stepLen(a: number, b: number, w: number): number {
  const ax = a % w, bx = b % w;
  return ax !== bx && Math.abs(a - b) !== 1 ? Math.SQRT2 : 1;
}

/** Walks from every endpoint to the first junction. */
function branches(skel: Uint8Array, w: number, h: number): Branch[] {
  const out: Branch[] = [];
  const seen = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    if (!skel[i] || neighbourCount(skel, w, i) !== 1) continue;
    const path = [i];
    seen[i] = 1;
    let cur = i, len = 0, junction = -1;
    for (;;) {
      let next = -1;
      for (let k = 0; k < 8; k++) {
        const q = cur + RING_DY[k] * w + RING_DX[k];
        if (skel[q] && !seen[q]) {
          next = q;
          break;
        }
      }
      if (next < 0) break;
      len += stepLen(cur, next, w);
      if (neighbourCount(skel, w, next) >= 3) {
        junction = next;
        break;
      }
      path.push(next);
      seen[next] = 1;
      cur = next;
    }
    for (const p of path) seen[p] = 0;
    out.push({ path, junction, len });
  }
  return out;
}

/** The first skeleton loop (at least 8 px long), or null. */
function findLoop(skel: Uint8Array, w: number, h: number): number[] | null {
  const parent = new Int32Array(w * h).fill(-2);
  const depth = new Int32Array(w * h);
  for (let s0 = 0; s0 < w * h; s0++) {
    if (!skel[s0] || parent[s0] !== -2) continue;
    parent[s0] = -1;
    const q = [s0];
    for (let qi = 0; qi < q.length; qi++) {
      const p = q[qi];
      for (let k = 0; k < 8; k++) {
        const n = p + RING_DY[k] * w + RING_DX[k];
        if (n < 0 || n >= w * h || !skel[n]) continue;
        if (parent[n] === -2) {
          parent[n] = p;
          depth[n] = depth[p] + 1;
          q.push(n);
        } else if (n !== parent[p] && p !== parent[n] && p < n) {
          // a non-tree edge closes a loop: walk both ends up to their common ancestor
          let a = p, b = n;
          const left: number[] = [], right: number[] = [];
          while (a !== b && a >= 0 && b >= 0) {
            if (depth[a] >= depth[b]) {
              left.push(a);
              a = parent[a];
            } else {
              right.push(b);
              b = parent[b];
            }
          }
          if (a >= 0 && a === b && left.length + right.length >= 8) return [...left, a, ...right];
        }
      }
    }
  }
  return null;
}

/**
 * Zhang-Suen erases 2x2 blocks, so 1-2 px strokes are thickened by a pixel first. Only thin strokes
 * are thickened: dilating everything would glue parts separated by a narrow slit (legs drawn close).
 */
function skeletonOf(solid: Uint8Array, dt: Float32Array, w: number, h: number, noBridge?: Uint8Array): Uint8Array {
  const localMax = new Float32Array(w * h);
  const tmp = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let m = 0;
    for (let k = Math.max(0, x - 2); k <= Math.min(w - 1, x + 2); k++) m = Math.max(m, dt[y * w + k]);
    tmp[y * w + x] = m;
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let m = 0;
    for (let k = Math.max(0, y - 2); k <= Math.min(h - 1, y + 2); k++) m = Math.max(m, tmp[k * w + x]);
    localMax[y * w + x] = m;
  }
  const thick = solid.slice();
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x;
    if (!solid[i] || localMax[i] > 1.5) continue;
    for (let k = 0; k < 8; k++) {
      const n = i + RING_DY[k] * w + RING_DX[k];
      if (!noBridge || !noBridge[n]) thick[n] = 1;
    }
  }
  const skel = zhangSuen(thick, w, h);
  for (let i = 0; i < w * h; i++) if (!solid[i]) skel[i] = 0;
  makeThin(skel, w, h);
  return skel;
}

/**
 * A gap left open (boots that touch, a hand on the hair) makes the skeleton loop around it. Where the
 * loop's thinnest point is a narrow neck (the touch), the shape itself is cut there, so each part gets
 * its own skeleton; otherwise only the skeleton is cut. Either way the skeleton becomes a tree.
 */
function untangle(s: Omit<Analysis, 'skel' | 'ends' | 'pruned' | 'limbR'>): Uint8Array {
  const { w, h } = s;
  let skel = skeletonOf(s.solid, s.dt, w, h);
  let carved = 0;
  const noBridge = new Uint8Array(w * h);
  for (let iter = 0; iter < 64; iter++) {
    const loop = findLoop(skel, w, h);
    if (!loop) break;
    let cut = -1, best = Infinity;
    for (const p of loop) if (neighbourCount(skel, w, p) === 2 && s.dt[p] < best) {
      best = s.dt[p];
      cut = p;
    }
    if (cut < 0) cut = loop[0];
    const dts = loop.map((p) => s.dt[p]).sort((a, b) => a - b);
    const neck = s.dt[cut] <= Math.max(1.6, 0.35 * dts[Math.floor(dts.length / 2)]);
    if (!neck) {
      skel[cut] = 0;
      continue;
    }
    // cut the touch itself (just wider than it is thin), and never let the skeleton bridge it again
    const r = s.dt[cut] + 0.7, R = r + 2, cx = cut % w, cy = Math.floor(cut / w);
    for (let y = Math.floor(cy - R); y <= Math.ceil(cy + R); y++) for (let x = Math.floor(cx - R); x <= Math.ceil(cx + R); x++) {
      if (x < 0 || y < 0 || x >= w || y >= h) continue;
      const d2 = (x - cx) ** 2 + (y - cy) ** 2;
      if (d2 > R * R) continue;
      noBridge[y * w + x] = 1;
      if (d2 > r * r) continue;
      s.solid[y * w + x] = 0;
      s.holes[y * w + x] = 0;
    }
    carved++;
    s.dt = edt(s.solid, w, h);
    skel = skeletonOf(s.solid, s.dt, w, h, noBridge);
  }
  if (carved) {
    const noInk = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) noInk[i] = s.solid[i] && !s.ink[i] ? 1 : 0;
    s.dtInk = edt(noInk, w, h);
  }
  return skel;
}

/** Full analysis: shape plus skeleton and extremities. */
export function analyze(input: RigInput, opts: ShapeOptions = {}): Analysis {
  const s = analyzeShape(input, opts);
  const skel = untangle(s);
  const { w, h, dt } = s;
  // prune spurs: a branch that sticks out less than half the radius at its junction is a bump
  const minProt = Math.max(2, s.maxDim * 0.045);
  let pruned = 0;
  for (let iter = 0; iter < 200; iter++) {
    const bs = branches(skel, w, h);
    let worst: Branch | null = null;
    let worstProt = Infinity;
    for (const b of bs) {
      if (b.junction < 0) continue;
      const prot = b.len - dt[b.junction];
      if (prot < Math.max(minProt, 0.5 * dt[b.junction]) && prot < worstProt) {
        worst = b;
        worstProt = prot;
      }
    }
    if (!worst) break;
    for (const p of worst.path) skel[p] = 0;
    makeThin(skel, w, h);
    pruned++;
  }
  const ends: End[] = branches(skel, w, h).map((b) => {
    const p = b.path[0];
    const x = p % w, y = (p - x) / w;
    const back = b.path[Math.min(b.path.length - 1, 6)];
    let dx = x - (back % w), dy = y - Math.floor(back / w);
    const dl = Math.hypot(dx, dy) || 1;
    dx /= dl;
    dy /= dl;
    let tx = x, ty = y;
    for (let k = 0; k < 400; k++) {
      const nx = tx + dx * 0.5, ny = ty + dy * 0.5;
      const ix = Math.round(nx), iy = Math.round(ny);
      if (ix < 0 || iy < 0 || ix >= w || iy >= h || !s.solid[iy * w + ix]) break;
      tx = nx;
      ty = ny;
    }
    const outer = b.path.slice(0, Math.max(1, Math.ceil(b.path.length / 2)));
    const ds = outer.map((q) => dt[q]).sort((a, c) => a - c);
    return { p, x, y, tipX: tx, tipY: ty, len: b.len, junction: b.junction, thick: ds[Math.floor(ds.length / 2)], bulk: ds[ds.length - 1] };
  });
  const skDt: number[] = [];
  for (let i = 0; i < w * h; i++) if (skel[i]) skDt.push(dt[i]);
  skDt.sort((a, b) => a - b);
  const limbR = skDt.length ? skDt[Math.floor(skDt.length * 0.3)] : 2;
  return { ...s, skel, ends, pruned, limbR };
}
