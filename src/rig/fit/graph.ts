/** Paths on the skeleton: a BFS tree from a root pixel, ancestors, sub-paths and arc-length points. */
import { stepLen, type Analysis } from '../analyze';
import { RING_DX, RING_DY } from '../imgproc';

export type P2 = [number, number];

export const px = (a: Analysis, p: number): P2 => [p % a.w, Math.floor(p / a.w)];

export interface SkelTree {
  /** Parent pixel of each skeleton pixel (-1 = root, -2 = not reached). */
  parent: Int32Array;
  /** Arc length from the root. */
  dist: Float32Array;
}

/** BFS tree over skeleton pixels rooted at `root`. */
export function skelTree(a: Analysis, root: number): SkelTree {
  const { w, h, skel } = a;
  const parent = new Int32Array(w * h).fill(-2);
  const dist = new Float32Array(w * h).fill(Infinity);
  if (root < 0) return { parent, dist };
  parent[root] = -1;
  dist[root] = 0;
  const q = [root];
  for (let qi = 0; qi < q.length; qi++) {
    const p = q[qi];
    for (let k = 0; k < 8; k++) {
      const n = p + RING_DY[k] * w + RING_DX[k];
      if (n < 0 || n >= w * h || !skel[n] || parent[n] !== -2) continue;
      parent[n] = p;
      dist[n] = dist[p] + (k % 2 === 0 ? 1 : Math.SQRT2);
      q.push(n);
    }
  }
  return { parent, dist };
}

export function pathToRoot(parent: Int32Array, p: number): number[] {
  const out: number[] = [];
  let c = p;
  while (c >= 0) {
    out.push(c);
    c = parent[c];
    if (out.length > parent.length) break;
  }
  return out;
}

/** Lowest common ancestor of a and b. */
export function lca(parent: Int32Array, a: number, b: number): number {
  const seen = new Set(pathToRoot(parent, a));
  for (const c of pathToRoot(parent, b)) if (seen.has(c)) return c;
  return a;
}

/** Sub-path from `from` (an ancestor) down to `to`, ordered from → to. */
export function pathDown(parent: Int32Array, from: number, to: number): number[] {
  const up = pathToRoot(parent, to);
  const k = up.indexOf(from);
  return (k >= 0 ? up.slice(0, k + 1) : up).reverse();
}

export function pathLength(a: Analysis, path: number[]): number {
  let s = 0;
  for (let i = 1; i < path.length; i++) s += stepLen(path[i - 1], path[i], a.w);
  return s;
}

/** The point at fraction `frac` of a path's arc length. */
export function arcPoint(a: Analysis, path: number[], frac: number): P2 {
  const w = a.w;
  if (path.length === 0) return [a.cx, a.cy];
  let total = 0;
  const cum = [0];
  for (let i = 1; i < path.length; i++) cum.push((total += stepLen(path[i - 1], path[i], w)));
  const target = total * Math.max(0, Math.min(1, frac));
  let i = 1;
  while (i < path.length && cum[i] < target) i++;
  if (i >= path.length) return px(a, path[path.length - 1]);
  const t = (target - cum[i - 1]) / Math.max(1e-6, cum[i] - cum[i - 1]);
  const [ax, ay] = px(a, path[i - 1]);
  const [bx, by] = px(a, path[i]);
  return [ax + (bx - ax) * t, ay + (by - ay) * t];
}

/** Index of the path pixel nearest to (x, y). */
export function nearestOnPath(a: Analysis, path: number[], x: number, y: number): { i: number; d: number } {
  let best = -1, bd = Infinity;
  for (let i = 0; i < path.length; i++) {
    const [qx, qy] = px(a, path[i]);
    const d = Math.hypot(qx - x, qy - y);
    if (d < bd) {
      bd = d;
      best = i;
    }
  }
  return { i: best, d: bd };
}

export function segDist(x: number, y: number, ax: number, ay: number, bx: number, by: number): number {
  const vx = bx - ax, vy = by - ay;
  const l2 = vx * vx + vy * vy;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * vx + (y - ay) * vy) / l2)) : 0;
  return Math.hypot(x - (ax + vx * t), y - (ay + vy * t));
}

/** The topmost skeleton pixel (a stand-in end when a drawing has no branches). */
export function topSkeletonPixel(a: Analysis): number {
  for (let i = 0; i < a.w * a.h; i++) if (a.skel[i]) return i;
  return -1;
}
