/**
 * Swimmer template (fish, snakes, worms): a chain of 4-6 bones along the longest path through the
 * skeleton. The root `body` sits in the middle pointing at the head; `neck`/`head` go forward and
 * `tail1..3` backward, so a travelling wave can run from head to tail.
 * The head is the bulkier end (or the hinted one). Fins become springy extras; a forked tail fin
 * stays with the last tail bone.
 */
import type { Analysis, End } from '../analyze';
import type { BoneRole } from '../types';
import { castToEdge, newFit, type Fit } from './common';
import { addExtras } from './extras';
import { arcPoint, pathDown, pathLength, skelTree, type P2 } from './graph';
import type { Guide } from './guide';

/** Fractions along the path from the head (0) to the tail (1), per chain length. */
const LAYOUT: Record<number, { name: string; role: BoneRole; from: number; to: number }[]> = {
  4: [
    { name: 'body', role: 'body', from: 0.55, to: 0.3 },
    { name: 'head', role: 'head', from: 0.3, to: 0 },
    { name: 'tail1', role: 'tail1', from: 0.55, to: 0.78 },
    { name: 'tail2', role: 'tail2', from: 0.78, to: 1 },
  ],
  5: [
    { name: 'body', role: 'body', from: 0.56, to: 0.38 },
    { name: 'neck', role: 'neck', from: 0.38, to: 0.2 },
    { name: 'head', role: 'head', from: 0.2, to: 0 },
    { name: 'tail1', role: 'tail1', from: 0.56, to: 0.74 },
    { name: 'tail2', role: 'tail2', from: 0.74, to: 1 },
  ],
  6: [
    { name: 'body', role: 'body', from: 0.48, to: 0.32 },
    { name: 'neck', role: 'neck', from: 0.32, to: 0.16 },
    { name: 'head', role: 'head', from: 0.16, to: 0 },
    { name: 'tail1', role: 'tail1', from: 0.48, to: 0.64 },
    { name: 'tail2', role: 'tail2', from: 0.64, to: 0.82 },
    { name: 'tail3', role: 'tail3', from: 0.82, to: 1 },
  ],
};
const PARENT: Record<string, string | null> = { body: null, neck: 'body', tail1: 'body', tail2: 'tail1', tail3: 'tail2' };

/** Mean distance-to-edge over the first quarter of a path (how bulky that end is). */
function endBulk(a: Analysis, path: number[]): number {
  const n = Math.max(1, Math.floor(path.length / 4));
  let s = 0;
  for (let i = 0; i < n; i++) s += a.dt[path[i]];
  return s / n;
}

export function fitSwimmer(a: Analysis, guide: Guide | null, facingHint: 1 | -1 | 0 = 0): Fit {
  const fit = newFit('swimmer', 0);
  const { bbox, cx } = a;
  const ends = a.ends;
  let e1: End | undefined, e2: End | undefined;
  const hHead = guide?.ends.get('head'), hTail = guide?.ends.get('tail');
  if (hHead && hTail) {
    e1 = hHead;
    e2 = hTail;
  } else if (ends.length >= 2) {
    // the longest path: the end farthest from any end, then the end farthest from that
    const t0 = skelTree(a, (hHead ?? hTail ?? ends[0]).p);
    let far = ends[0], fd = -1;
    for (const e of ends) if (Number.isFinite(t0.dist[e.p]) && t0.dist[e.p] > fd) {
      fd = t0.dist[e.p];
      far = e;
    }
    const start = hHead ?? hTail ?? far;
    const t1 = skelTree(a, start.p);
    let other = ends[0], od = -1;
    for (const e of ends) if (e !== start && Number.isFinite(t1.dist[e.p]) && t1.dist[e.p] > od) {
      od = t1.dist[e.p];
      other = e;
    }
    e1 = start;
    e2 = other;
  }
  if (!e1 || !e2 || e1 === e2) {
    // no clear chain: a horizontal body through the centre
    const W = bbox.x1 - bbox.x0 + 1;
    fit.bones.push({ name: 'body', role: 'body', parent: null, a: [cx - 0.1 * W, a.cy], b: [cx + 0.1 * W, a.cy] });
    fit.bones.push({ name: 'head', role: 'head', parent: 'body', a: [cx + 0.1 * W, a.cy], b: [bbox.x1, a.cy] });
    fit.bones.push({ name: 'tail1', role: 'tail1', parent: 'body', a: [cx - 0.1 * W, a.cy], b: [bbox.x0, a.cy] });
    fit.issues.push('short-body');
    fit.anchor = [cx, bbox.y1 + 0.5];
    fit.facing = 1;
    return fit;
  }
  const tree = skelTree(a, e1.p);
  let path = pathDown(tree.parent, e1.p, e2.p); // e1 ... e2
  // which end is the head: the hint, else the bulkier end, else the requested facing
  let headFirst = true;
  if (hHead) headFirst = e1 === hHead;
  else if (hTail) headFirst = e1 !== hTail;
  else {
    const b1 = endBulk(a, path), b2 = endBulk(a, [...path].reverse());
    if (Math.abs(b1 - b2) > 0.12 * Math.max(b1, b2)) headFirst = b1 > b2;
    else if (facingHint !== 0) headFirst = Math.sign(e1.tipX - e2.tipX) === facingHint;
  }
  const headEnd = headFirst ? e1 : e2, tailEnd = headFirst ? e2 : e1;
  if (!headFirst) path = path.reverse(); // head ... tail
  // a forked tail fin: the other lobes branch off near the tail; the tail points between them
  const index = new Map(path.map((p, i) => [p, i] as [number, number]));
  const lobes = ends.filter((e) => e !== headEnd && e !== tailEnd && e.junction >= 0 && (index.get(e.junction) ?? 0) >= 0.72 * path.length);
  let tailTip: P2 = [tailEnd.tipX, tailEnd.tipY];
  if (lobes.length) {
    path = path.slice(0, Math.min(...lobes.map((e) => index.get(e.junction) ?? path.length - 1)) + 1);
    tailTip = [
      (tailEnd.tipX + lobes.reduce((t, e) => t + e.tipX, 0)) / (lobes.length + 1),
      (tailEnd.tipY + lobes.reduce((t, e) => t + e.tipY, 0)) / (lobes.length + 1),
    ];
    lobes.forEach((e) => fit.used.add(e));
  }
  // extend the path's ends to the silhouette tips
  const pts: P2[] = [[headEnd.tipX, headEnd.tipY], ...path.map((p) => [p % a.w, Math.floor(p / a.w)] as P2), tailTip];
  const at = (f: number): P2 => {
    let total = 0;
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push((total += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1])));
    const target = total * f;
    let i = 1;
    while (i < pts.length - 1 && cum[i] < target) i++;
    const t = (target - cum[i - 1]) / Math.max(1e-6, cum[i] - cum[i - 1]);
    return [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t];
  };
  const len = pathLength(a, path);
  const dts = path.map((p) => a.dt[p]).sort((p, q) => p - q);
  const medDt = Math.max(1, dts[Math.floor(dts.length / 2)]);
  const n = Math.max(4, Math.min(6, Math.round(len / (2.4 * medDt))));
  for (const s of LAYOUT[n]) {
    const parent = s.name === 'head' ? (n >= 5 ? 'neck' : 'body') : PARENT[s.name];
    let b = at(s.to);
    if (s.name === 'head' && n >= 4) {
      // the head bone reaches the snout
      const from = at(s.from);
      const l = Math.hypot(b[0] - from[0], b[1] - from[1]) || 1;
      b = castToEdge(a, from, (b[0] - from[0]) / l, (b[1] - from[1]) / l);
    }
    fit.bones.push({ name: s.name, role: s.role, parent, a: at(s.from), b, dynamic: s.role === 'tail3' ? true : undefined });
  }
  fit.facing = Math.abs(headEnd.tipX - tailEnd.tipX) > Math.abs(headEnd.tipY - tailEnd.tipY) ? (headEnd.tipX > tailEnd.tipX ? 1 : -1) : 0;
  fit.used.add(headEnd);
  fit.used.add(tailEnd);
  // a forked tail fin: ends that join near the tail stay with the tail
  const tailZone = arcPoint(a, path, 0.8);
  addExtras(a, fit, {
    accept: (e) => e.junction < 0 || Math.hypot((e.junction % a.w) - tailZone[0], Math.floor(e.junction / a.w) - tailZone[1]) > 0.18 * len,
    thin: 0.6,
  });
  // the ground point under the root (the middle of the chain)
  const body = fit.bones.find((b) => b.name === 'body');
  fit.anchor = [body ? (body.a[0] + body.b[0]) / 2 : cx, bbox.y1 + 0.5];
  return fit;
}
