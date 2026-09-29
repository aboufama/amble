/**
 * Flood fill that closes small gaps in sketchy line art ("fill under the lines").
 *
 * analyze(walls):  chamfer distance to the nearest wall + the ESCAPE LEVEL of every pixel: the widest
 *                  clearance along its best path to the canvas edge (a max-min priority flood from the
 *                  border, O(N) with a bucket queue). A region is sealed by gap-closing radius G iff
 *                  escape(seed) <= G: no disc wider than the escape level can get out.
 * fillRegion(seed): pick the smallest G that seals the seed from the border; then, if closing a larger gap
 *                  splits the tapped region from a sizeable neighbour at a real gap (two inner regions
 *                  touching through an opening with a line end at it, like a face inside a helmet), cut
 *                  the neighbour off along the gap's midline (fill-split.ts); a narrow neck of one closed
 *                  shape never splits it. Flood the pixels farther than G from walls, let the seed's core
 *                  and its neighbouring cores grow back up to G px competitively (a sealed gap splits at its
 *                  midline instead of bulging), expand under the lines, and soften the edge.
 * All pure TypeScript on typed arrays: it runs in the fill worker, on the main thread, or in Node.
 */
import type { Rect } from './geom';
import { type Flood, splitAtGaps } from './fill-split';

/** Distances are stored in thirds of a pixel (chamfer 3-4). */
const UNIT = 3;
const UNSET = 65535;

export interface FillParams {
  /** Candidate gap-closing radii in px, ascending (0 = exact). */
  gaps: number[];
  /** Radius used when nothing seals the tap (the background): seals as hard as possible. */
  fallbackGap: number;
  /** How far the fill reaches under the lines, px. */
  expand: number;
  /** Soften the fill's edge (off for pixel art). */
  soften: boolean;
  /** Look for a smaller enclosing region behind a gap (off for pixel art). */
  innerCheck: boolean;
}

export interface Analysis {
  W: number;
  H: number;
  wall: Uint8Array;
  dist: Uint16Array;
  esc: Uint16Array;
  /** Largest gap (px) the escape levels are exact for. */
  maxGap: number;
  ms: number;
}

export interface FillResult {
  /** The gap-closing radius used, px. */
  gap: number;
  /** Nothing sealed the tap: it filled the open background. */
  background: boolean;
  /** A larger gap was closed to split the tapped region from a neighbour. */
  split: boolean;
  area: number;
  /** Integer box of the mask (x1/y1 exclusive). */
  box: Rect;
  /** Coverage 0..255, (box.x1 - box.x0) wide. */
  mask: Uint8Array;
  /** Pixels in the mask that are walls (the part tucked under the lines), 1 per pixel, same layout. */
  under: Uint8Array;
  /**
   * Open pixels of the region along its walls, within the reach of a neighbouring fill's spill (its
   * expansion under a shared line, its soft edge, its grow-back through a gap), same layout. A fill poured
   * behind existing paint still paints over these, so an earlier fill's spill never stays on top.
   */
  over: Uint8Array;
  seedMoved: number;
  ms: number;
}

/** Board-scaled gap radii for a board of this size (the defaults are tuned on 1024 px). */
export function gapsFor(mode: 'auto' | 'small' | 'off', W: number, H: number): { gaps: number[]; fallbackGap: number } {
  if (mode === 'off') return { gaps: [0], fallbackGap: 0 };
  const s = Math.min(2, Math.max(0.5, Math.max(W, H) / 1024));
  const base = mode === 'small' ? [0, 2, 4] : [0, 2, 4, 7, 11];
  const gaps = [...new Set(base.map((g) => Math.round(g * s)))];
  return { gaps, fallbackGap: gaps[gaps.length - 1] };
}

/** The editor probe's unscaled radii (stroke scripts replay with these, as previewed). */
export const PROBE_GAPS = { gaps: [0, 2, 4, 7, 11], fallbackGap: 11 };

export function defaultFillParams(mode: 'auto' | 'small' | 'off', W: number, H: number, pixelArt: boolean): FillParams {
  if (pixelArt) return { gaps: [0], fallbackGap: 0, expand: 0, soften: false, innerCheck: false };
  return { ...gapsFor(mode, W, H), expand: 2, soften: true, innerCheck: true };
}

/** A growable Int32 stack/queue. */
class IntStack {
  data: Int32Array;
  n = 0;
  constructor(cap = 4096) {
    this.data = new Int32Array(cap);
  }
  push(v: number): void {
    if (this.n === this.data.length) {
      const g = new Int32Array(this.data.length * 2);
      g.set(this.data);
      this.data = g;
    }
    this.data[this.n++] = v;
  }
  pop(): number {
    return this.data[--this.n];
  }
}

/** Walls from the alpha of the line-art layers (anything at least ~30% opaque). */
export function wallsFromAlpha(rgba: Uint8ClampedArray, W: number, H: number, threshold = 80): Uint8Array {
  const N = W * H;
  const wall = new Uint8Array(N);
  for (let i = 0, j = 3; i < N; i++, j += 4) wall[i] = rgba[j] > threshold ? 1 : 0;
  return wall;
}

/** Walls from colour distance to the seed pixel (premultiplied RGBA, so transparent pixels compare cleanly). */
export function wallsFromColor(rgba: Uint8ClampedArray, W: number, H: number, sx: number, sy: number, tol: number): Uint8Array {
  const N = W * H;
  const s = (sy * W + sx) * 4;
  const as = rgba[s + 3];
  const r0 = (rgba[s] * as) / 255;
  const g0 = (rgba[s + 1] * as) / 255;
  const b0 = (rgba[s + 2] * as) / 255;
  const wall = new Uint8Array(N);
  for (let i = 0, j = 0; i < N; i++, j += 4) {
    const a = rgba[j + 3];
    const k = a / 255;
    let d = Math.abs(a - as);
    let e = Math.abs(rgba[j] * k - r0);
    if (e > d) d = e;
    e = Math.abs(rgba[j + 1] * k - g0);
    if (e > d) d = e;
    e = Math.abs(rgba[j + 2] * k - b0);
    if (e > d) d = e;
    wall[i] = d > tol ? 1 : 0;
  }
  return wall;
}

/** Nudges a tap off an anti-aliased edge to the most uniform pixel nearby (colour-distance fills). */
export function uniformSeed(rgba: Uint8ClampedArray, W: number, H: number, sx: number, sy: number, tol: number): [number, number] {
  sx = Math.max(0, Math.min(W - 1, Math.floor(sx)));
  sy = Math.max(0, Math.min(H - 1, Math.floor(sy)));
  let best: [number, number] = [sx, sy];
  let bestScore = -Infinity;
  for (let dy = -4; dy <= 4; dy++)
    for (let dx = -4; dx <= 4; dx++) {
      const x = sx + dx;
      const y = sy + dy;
      if (x < 2 || y < 2 || x >= W - 2 || y >= H - 2 || dx * dx + dy * dy > 16) continue;
      const c = (y * W + x) * 4;
      let score = 0;
      for (let v = -2; v <= 2; v++)
        for (let u = -2; u <= 2; u++) {
          const k = ((y + v) * W + x + u) * 4;
          const d = Math.max(Math.abs(rgba[k] - rgba[c]), Math.abs(rgba[k + 1] - rgba[c + 1]), Math.abs(rgba[k + 2] - rgba[c + 2]), Math.abs(rgba[k + 3] - rgba[c + 3]));
          if (d <= tol / 2) score++;
        }
      score = score * 100 - (dx * dx + dy * dy);
      if (score > bestScore) {
        bestScore = score;
        best = [x, y];
      }
    }
  return best;
}

/** Chamfer (3-4) distance to the nearest wall, in thirds of a pixel. */
export function distanceTransform(wall: Uint8Array, W: number, H: number): Uint16Array {
  const N = W * H;
  const dist = new Uint16Array(N);
  for (let i = 0; i < N; i++) dist[i] = wall[i] ? 0 : 60000;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      let d = dist[i];
      if (d === 0) continue;
      if (x > 0 && dist[i - 1] + 3 < d) d = dist[i - 1] + 3;
      if (y > 0) {
        const u = i - W;
        if (dist[u] + 3 < d) d = dist[u] + 3;
        if (x > 0 && dist[u - 1] + 4 < d) d = dist[u - 1] + 4;
        if (x < W - 1 && dist[u + 1] + 4 < d) d = dist[u + 1] + 4;
      }
      dist[i] = d;
    }
  }
  for (let y = H - 1; y >= 0; y--) {
    for (let x = W - 1; x >= 0; x--) {
      const i = y * W + x;
      let d = dist[i];
      if (d === 0) continue;
      if (x < W - 1 && dist[i + 1] + 3 < d) d = dist[i + 1] + 3;
      if (y < H - 1) {
        const u = i + W;
        if (dist[u] + 3 < d) d = dist[u] + 3;
        if (x < W - 1 && dist[u + 1] + 4 < d) d = dist[u + 1] + 4;
        if (x > 0 && dist[u - 1] + 4 < d) d = dist[u - 1] + 4;
      }
      dist[i] = d;
    }
  }
  return dist;
}

/**
 * Escape levels: max-first priority flood from the canvas border, level by level. Within a level every
 * unvisited pixel with clearance >= level gets that level, so each level is a plain scanline flood; only
 * neighbours with less clearance are queued (in the bucket of their own clearance) for a later level.
 */
export function escapeLevels(dist: Uint16Array, W: number, H: number, maxGap: number): Uint16Array {
  const N = W * H;
  const cap = UNIT * maxGap + 1;
  const esc = new Uint16Array(N).fill(UNSET);
  const buckets: IntStack[] = [];
  for (let v = 0; v <= cap; v++) buckets.push(new IntStack(v === cap ? 4 * (W + H) : 1024));
  const clip = (d: number): number => (d < cap ? d : cap);
  for (let x = 0; x < W; x++) {
    buckets[clip(dist[x])].push(x);
    buckets[clip(dist[(H - 1) * W + x])].push((H - 1) * W + x);
  }
  for (let y = 1; y < H - 1; y++) {
    buckets[clip(dist[y * W])].push(y * W);
    buckets[clip(dist[y * W + W - 1])].push(y * W + W - 1);
  }
  for (let v = cap; v >= 0; v--) {
    const bucket = buckets[v];
    while (bucket.n > 0) {
      const p = bucket.pop();
      if (esc[p] !== UNSET) continue;
      const y = (p / W) | 0;
      const row = y * W;
      let l = p;
      while (l > row && esc[l - 1] === UNSET && dist[l - 1] >= v) l--;
      let r = p;
      while (r < row + W - 1 && esc[r + 1] === UNSET && dist[r + 1] >= v) r++;
      esc.fill(v, l, r + 1);
      if (l > row && esc[l - 1] === UNSET) buckets[dist[l - 1] < v ? dist[l - 1] : v].push(l - 1);
      if (r < row + W - 1 && esc[r + 1] === UNSET) buckets[dist[r + 1] < v ? dist[r + 1] : v].push(r + 1);
      for (let ny = y - 1; ny <= y + 1; ny += 2) {
        if (ny < 0 || ny >= H) continue;
        const off = (ny - y) * W;
        let run = false;
        for (let k = l; k <= r; k++) {
          const q = k + off;
          if (esc[q] !== UNSET) {
            run = false;
            continue;
          }
          const d = dist[q];
          if (d >= v) {
            if (!run) bucket.push(q);
            run = true;
          } else {
            buckets[d].push(q);
            run = false;
          }
        }
      }
    }
  }
  return esc;
}

const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export function analyze(wall: Uint8Array, W: number, H: number, maxGap: number): Analysis {
  const t0 = now();
  const dist = distanceTransform(wall, W, H);
  const esc = escapeLevels(dist, W, H, maxGap);
  return { W, H, wall, dist, esc, maxGap, ms: now() - t0 };
}

/**
 * Moves a tap that landed on a line to the nearest open pixel; among equally near ones, the most interior.
 * Returns -1 when nothing open is within `rad`.
 */
function openSeed(a: Analysis, sx: number, sy: number, rad: number): number {
  const { W, H, wall, dist } = a;
  const s = sy * W + sx;
  if (!wall[s]) return s;
  let best = -1;
  let bestScore = -Infinity;
  for (let dy = -rad; dy <= rad; dy++)
    for (let dx = -rad; dx <= rad; dx++) {
      const x = sx + dx;
      const y = sy + dy;
      const d2 = dx * dx + dy * dy;
      if (x < 0 || y < 0 || x >= W || y >= H || d2 > rad * rad) continue;
      const i = y * W + x;
      if (wall[i]) continue;
      const score = -d2 * 4 + Math.min(dist[i], 9);
      if (score > bestScore) {
        bestScore = score;
        best = i;
      }
    }
  return best;
}

/**
 * Walks inward (breadth-first over open pixels, optionally only inside `within`) until it finds a pixel
 * farther than `thr` from any wall; returns the most interior one of the first layer that has any, or -1.
 */
function reseed(a: Analysis, s: number, thr: number, rad: number, within: Uint8Array | null): number {
  const { W, H, wall, dist } = a;
  if (dist[s] > thr) return s;
  const sx = s % W;
  const sy = (s / W) | 0;
  const side = 2 * rad + 1;
  const seen = new Uint8Array(side * side);
  const key = (i: number): number => ((((i / W) | 0) - sy + rad) * side + (i % W) - sx + rad);
  seen[key(s)] = 1;
  let queue = [s];
  for (let step = 0; step <= rad && queue.length; step++) {
    let best = -1;
    for (const i of queue) if (dist[i] > thr && (best < 0 || dist[i] > dist[best])) best = i;
    if (best >= 0) return best;
    const next: number[] = [];
    for (const i of queue) {
      const x = i % W;
      const y = (i / W) | 0;
      const nb = [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, y > 0 ? i - W : -1, y < H - 1 ? i + W : -1];
      for (const q of nb) {
        if (q < 0 || wall[q] || (within && !within[q])) continue;
        const qx = q % W;
        const qy = (q / W) | 0;
        if (Math.abs(qx - sx) > rad || Math.abs(qy - sy) > rad) continue;
        const k = key(q);
        if (seen[k]) continue;
        seen[k] = 1;
        next.push(q);
      }
    }
    queue = next;
  }
  return -1;
}

/** Scanline flood of pixels with dist > thr from `seed`, writing `mark` into `lab` (0 = unvisited). */
function floodCore(a: Analysis, seed: number, thr: number, lab: Uint8Array, mark: number, stack: IntStack): Flood {
  const { W, H, dist } = a;
  const f: Flood = { area: 0, maxDist: 0, x0: W, y0: H, x1: -1, y1: -1 };
  stack.n = 0;
  stack.push(seed);
  while (stack.n > 0) {
    const i = stack.pop();
    if (lab[i] || dist[i] <= thr) continue;
    const y = (i / W) | 0;
    const row = y * W;
    let l = i;
    while (l > row && !lab[l - 1] && dist[l - 1] > thr) l--;
    let r = i;
    while (r < row + W - 1 && !lab[r + 1] && dist[r + 1] > thr) r++;
    for (let k = l; k <= r; k++) {
      lab[k] = mark;
      if (dist[k] > f.maxDist) f.maxDist = dist[k];
    }
    f.area += r - l + 1;
    if (l - row < f.x0) f.x0 = l - row;
    if (r - row > f.x1) f.x1 = r - row;
    if (y < f.y0) f.y0 = y;
    if (y > f.y1) f.y1 = y;
    for (let ny = y - 1; ny <= y + 1; ny += 2) {
      if (ny < 0 || ny >= H) continue;
      const off = (ny - y) * W;
      let run = false;
      for (let k = l; k <= r; k++) {
        const q = k + off;
        const ok = !lab[q] && dist[q] > thr;
        if (ok && !run) stack.push(q);
        run = ok;
      }
    }
  }
  return f;
}

/**
 * The smallest-enclosing-region check. `region` (value 1) is the seed's core at the chosen gap. For each
 * larger gap, re-flood the seed's core; when some other part of the old region is now a separate, sizeable
 * core, the region is split among its cores at that gap and the parts beyond REAL gaps (a line end at the
 * opening) are cut off (`splitAtGaps`). Narrow necks of one closed shape never split it.
 */
function innerSplit(a: Analysis, seed: number, chosen: number, region: Uint8Array, reg: Flood, gaps: number[], stack: IntStack): { gap: number; lab: Uint8Array; flood: Flood } | null {
  const { W, dist } = a;
  const lab = new Uint8Array(a.W * a.H);
  for (const G of gaps) {
    if (G <= chosen || G > a.maxGap) continue;
    const thr = UNIT * G;
    const s = reseed(a, seed, thr, G * 2 + 4, region);
    if (s < 0) continue;
    floodCore(a, s, thr, lab, 1, stack);
    let found = false;
    for (let y = reg.y0; y <= reg.y1 && !found; y++) {
      for (let x = reg.x0; x <= reg.x1; x++) {
        const i = y * W + x;
        if (!region[i] || lab[i] || dist[i] <= thr) continue;
        const other = floodCore(a, i, thr, lab, 2, stack);
        if (other.area >= 32 && other.maxDist >= thr + 2 * UNIT) {
          found = true;
          break;
        }
      }
    }
    for (let y = reg.y0; y <= reg.y1; y++) lab.fill(0, y * W + reg.x0, y * W + reg.x1 + 1);
    if (!found) continue;
    const cut = splitAtGaps(a, region, reg, s, G);
    if (cut) return { gap: G, lab: cut.lab, flood: cut.flood };
  }
  return null;
}

/** Fills from the tap (sx, sy). Returns null when there is nothing to fill (a sliver along a line). */
export function fillRegion(a: Analysis, sx: number, sy: number, prm: FillParams): FillResult | null {
  const t0 = now();
  const { W, H, wall, dist, esc } = a;
  sx = Math.max(0, Math.min(W - 1, Math.floor(sx)));
  sy = Math.max(0, Math.min(H - 1, Math.floor(sy)));
  const s0 = openSeed(a, sx, sy, 6);
  if (s0 < 0) return null;
  const gaps = prm.gaps.filter((g) => g <= a.maxGap);
  const fallback = Math.min(prm.fallbackGap, a.maxGap);

  // Smallest gap-closing radius that seals the seed from the border (a seed near a wall may move inward).
  let chosen = -1;
  let seed = s0;
  for (const G of gaps) {
    const s = reseed(a, s0, G * UNIT, G * 2 + 4, null);
    if (s < 0) continue;
    if (esc[s] <= G * UNIT) {
      chosen = G;
      seed = s;
      break;
    }
  }
  let background = false;
  if (chosen < 0) {
    background = true; // leaks at every G: the seed is in the open background
    chosen = fallback;
    const s = reseed(a, s0, chosen * UNIT, chosen * 2 + 4, null);
    if (s < 0) chosen = 0;
    else seed = s;
  }

  const stack = new IntStack();
  let region: Uint8Array = new Uint8Array(W * H);
  let core = floodCore(a, seed, chosen * UNIT, region, 1, stack);
  if (core.x1 < 0 || (chosen === 0 && core.maxDist < 4 && prm.expand > 0)) return null; // nothing, or a sliver along a line

  let split = false;
  let reported = chosen;
  if (!background && prm.innerCheck) {
    const r = innerSplit(a, seed, chosen, region, core, gaps, stack);
    if (r) {
      // The seed's side of the old region, cut along the gaps' midlines; it still grows back at `chosen`.
      split = true;
      reported = r.gap;
      region = r.lab;
      core = r.flood;
    }
  }
  const thr = chosen * UNIT;
  let bx0 = core.x0;
  let by0 = core.y0;
  let bx1 = core.x1;
  let by1 = core.y1;

  // Competitive grow-back inside a window around the region: every core within reach grows at once.
  if (chosen > 0) {
    const m = chosen * 2 + 2;
    const X0 = Math.max(0, bx0 - m);
    const Y0 = Math.max(0, by0 - m);
    const X1 = Math.min(W - 1, bx1 + m);
    const Y1 = Math.min(H - 1, by1 + m);
    const ww = X1 - X0 + 1;
    const label = new Int32Array(ww * (Y1 - Y0 + 1));
    const L = (x: number, y: number): number => (y - Y0) * ww + (x - X0);
    let next = 2;
    const st = new IntStack(256);
    for (let y = Y0; y <= Y1; y++)
      for (let x = X0; x <= X1; x++) {
        const i = y * W + x;
        if (region[i]) label[L(x, y)] = 1;
        else if (dist[i] > thr && !label[L(x, y)]) {
          // Label this (partial) competing core within the window.
          label[L(x, y)] = next;
          st.n = 0;
          st.push(i);
          while (st.n > 0) {
            const q = st.pop();
            const qx = q % W;
            const qy = (q / W) | 0;
            if (qx > X0 && !label[L(qx - 1, qy)] && !region[q - 1] && dist[q - 1] > thr) (label[L(qx - 1, qy)] = next), st.push(q - 1);
            if (qx < X1 && !label[L(qx + 1, qy)] && !region[q + 1] && dist[q + 1] > thr) (label[L(qx + 1, qy)] = next), st.push(q + 1);
            if (qy > Y0 && !label[L(qx, qy - 1)] && !region[q - W] && dist[q - W] > thr) (label[L(qx, qy - 1)] = next), st.push(q - W);
            if (qy < Y1 && !label[L(qx, qy + 1)] && !region[q + W] && dist[q + W] > thr) (label[L(qx, qy + 1)] = next), st.push(q + W);
          }
          next++;
        }
      }
    let frontier = new IntStack();
    for (let y = Y0; y <= Y1; y++)
      for (let x = X0; x <= X1; x++) {
        if (!label[L(x, y)]) continue;
        if ((x > X0 && !label[L(x - 1, y)]) || (x < X1 && !label[L(x + 1, y)]) || (y > Y0 && !label[L(x, y - 1)]) || (y < Y1 && !label[L(x, y + 1)])) frontier.push(y * W + x);
      }
    for (let k = 1; k <= chosen && frontier.n > 0; k++) {
      const diag = k % 2 === 0;
      const nxt = new IntStack(frontier.n * 2 + 16);
      for (let f = 0; f < frontier.n; f++) {
        const i = frontier.data[f];
        const x = i % W;
        const y = (i / W) | 0;
        const lab = label[L(x, y)];
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            if ((dx === 0 && dy === 0) || (!diag && dx !== 0 && dy !== 0)) continue;
            const nx = x + dx;
            const ny = y + dy;
            if (nx < X0 || ny < Y0 || nx > X1 || ny > Y1) continue;
            const li = L(nx, ny);
            const q = ny * W + nx;
            if (label[li] || wall[q]) continue;
            label[li] = lab;
            nxt.push(q);
          }
      }
      frontier = nxt;
    }
    for (let y = Y0; y <= Y1; y++)
      for (let x = X0; x <= X1; x++) {
        const i = y * W + x;
        if (label[L(x, y)] === 1 && !region[i]) {
          region[i] = 1;
          if (x < bx0) bx0 = x;
          if (x > bx1) bx1 = x;
          if (y < by0) by0 = y;
          if (y > by1) by1 = y;
        }
      }
  }

  // Expand under the lines (only into wall pixels, never into other regions); mark those as "under".
  const underMark = 2;
  let frontier = new IntStack();
  for (let y = by0; y <= by1; y++)
    for (let x = bx0; x <= bx1; x++) {
      const i = y * W + x;
      if (region[i] && ((x > 0 && !region[i - 1]) || (x < W - 1 && !region[i + 1]) || (y > 0 && !region[i - W]) || (y < H - 1 && !region[i + W]))) frontier.push(i);
    }
  for (let k = 1; k <= prm.expand && frontier.n > 0; k++) {
    const diag = k % 2 === 0;
    const nxt = new IntStack(frontier.n * 2 + 16);
    for (let f = 0; f < frontier.n; f++) {
      const i = frontier.data[f];
      const x = i % W;
      const y = (i / W) | 0;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          if ((dx === 0 && dy === 0) || (!diag && dx !== 0 && dy !== 0)) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          const q = ny * W + nx;
          if (region[q] || !wall[q]) continue;
          region[q] = underMark;
          nxt.push(q);
          if (nx < bx0) bx0 = nx;
          if (nx > bx1) bx1 = nx;
          if (ny < by0) by0 = ny;
          if (ny > by1) by1 = ny;
        }
    }
    frontier = nxt;
  }

  // Mask: the region, softened with a 3x3 box when asked (no white halo against anti-aliased ink).
  const pad = prm.soften ? 1 : 0;
  const X0 = Math.max(0, bx0 - pad);
  const X1 = Math.min(W - 1, bx1 + pad);
  const Y0 = Math.max(0, by0 - pad);
  const Y1 = Math.min(H - 1, by1 + pad);
  const bw = X1 - X0 + 1;
  const bh = Y1 - Y0 + 1;
  const mask = new Uint8Array(bw * bh);
  const under = new Uint8Array(bw * bh);
  const over = new Uint8Array(bw * bh);
  // How far past a shared line a neighbouring fill reaches: its expansion, soft edge and grow-back.
  const rim = UNIT * Math.max(prm.expand + 2, reported);
  let area = 0;
  if (prm.soften) {
    // The board's own edge is not an edge of the fill: neighbours beyond it count as the pixel itself.
    const hs = new Uint8Array(bw * bh);
    for (let y = Y0; y <= Y1; y++) {
      const ro = y * W;
      const ho = (y - Y0) * bw - X0;
      for (let x = X0; x <= X1; x++) {
        const c = region[ro + x] ? 1 : 0;
        hs[ho + x] = (x > 0 ? (region[ro + x - 1] ? 1 : 0) : c) + c + (x < W - 1 ? (region[ro + x + 1] ? 1 : 0) : c);
      }
    }
    for (let y = Y0; y <= Y1; y++) {
      const ho = (y - Y0) * bw - X0;
      for (let x = X0; x <= X1; x++) {
        const up = y > Y0 ? hs[ho - bw + x] : y === 0 ? hs[ho + x] : 0;
        const down = y < Y1 ? hs[ho + bw + x] : y === H - 1 ? hs[ho + x] : 0;
        const sum = hs[ho + x] + up + down;
        if (!sum) continue;
        const i = y * W + x;
        mask[ho + x] = Math.round((sum / 9) * 255);
        if (wall[i]) under[ho + x] = 1;
        else if (region[i] === 1 && dist[i] <= rim) over[ho + x] = 1;
        area++;
      }
    }
  } else {
    for (let y = Y0; y <= Y1; y++)
      for (let x = X0; x <= X1; x++) {
        const i = y * W + x;
        if (!region[i]) continue;
        const k = (y - Y0) * bw + (x - X0);
        mask[k] = 255;
        if (wall[i]) under[k] = 1;
        else if (region[i] === 1 && dist[i] <= rim) over[k] = 1;
        area++;
      }
  }
  return {
    gap: reported,
    background,
    split,
    area,
    box: { x0: X0, y0: Y0, x1: X1 + 1, y1: Y1 + 1 },
    mask,
    under,
    over,
    seedMoved: Math.hypot((s0 % W) - sx, ((s0 / W) | 0) - sy),
    ms: now() - t0,
  };
}
