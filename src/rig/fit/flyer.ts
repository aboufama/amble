/**
 * Flyer template: body, head, two 2-bone wings, an optional springy tail and optional legs.
 * - Front view (bats, butterflies): the two biggest branches sit on opposite sides, mirror-like and
 *   equally slim at their tips; the head is the highest central end; facing 0.
 * - Side view (birds): the head is the bulky end out to one side (that side is the facing); the tail
 *   is the far end on the other side; wings are the big branches leaving the body upward.
 * The art request's facing (viewer = front, left/right = side) settles the view when given.
 */
import { nearestOn } from '../imgproc';
import type { Analysis, End } from '../analyze';
import type { BoneRole, Facing } from '../types';
import { castToEdge, colourRegions, exitIndex, headJoint, limbGeometry, newFit, pushLimb, type Fit } from './common';
import { addExtras, branchPath } from './extras';
import { arcPoint, lca, pathDown, pathToRoot, px, skelTree, type P2 } from './graph';
import type { Guide } from './guide';
import { snapMid } from './snap';

const protrusion = (a: Analysis, e: End) => e.len - (e.junction >= 0 ? a.dt[e.junction] : 0);

export function fitFlyer(a: Analysis, guide: Guide | null, facingHint?: Facing): Fit {
  const fit = newFit('flyer', 0);
  const { bbox, cx, cy } = a;
  const H = bbox.y1 - bbox.y0 + 1, W = bbox.x1 - bbox.x0 + 1;
  const size = Math.max(W, H);
  const hinted = (slot: string) => guide?.ends.get(slot);
  const taken = new Set<End>();
  const medThick = [...a.ends.map((e) => e.thick)].sort((p, q) => p - q)[Math.floor(a.ends.length / 2)] ?? 1;
  let legs = [hinted('legL'), hinted('legR')].filter((e): e is End => !!e);
  if (!legs.length) {
    legs = a.ends
      .filter((e) => e.tipY > cy + 0.15 * H && e.thick <= Math.max(1.5, 0.8 * medThick))
      .sort((p, q) => q.tipY - p.tipY)
      .slice(0, 2);
  }
  legs.forEach((e) => taken.add(e));
  const mass = (e: End) => Math.max(0, protrusion(a, e)) * Math.max(1, e.thick);
  let wings = [hinted('wingL'), hinted('wingR')].filter((e): e is End => !!e);
  wings.forEach((e) => taken.add(e));
  let head = hinted('head');
  if (head) taken.add(head);
  // which view?
  let front: boolean;
  if (facingHint !== undefined) front = facingHint === 0;
  else if (wings.length === 2) front = Math.sign(wings[0].tipX - cx) !== Math.sign(wings[1].tipX - cx);
  else {
    const [w1, w2] = a.ends.filter((e) => !taken.has(e)).sort((p, q) => mass(q) - mass(p));
    front = !!w1 && !!w2 && Math.sign(w1.tipX - cx) !== Math.sign(w2.tipX - cx) &&
      Math.abs(Math.abs(w1.tipX - cx) - Math.abs(w2.tipX - cx)) < 0.3 * Math.max(Math.abs(w1.tipX - cx), Math.abs(w2.tipX - cx)) &&
      Math.abs(w1.tipY - w2.tipY) < 0.25 * H &&
      Math.max(w1.bulk, w2.bulk) < 1.6 * Math.max(1, Math.min(w1.bulk, w2.bulk));
    if (front && !wings.length) {
      wings = [w1, w2];
      wings.forEach((e) => taken.add(e));
    }
  }
  const maxBulk = Math.max(1, ...a.ends.map((e) => e.bulk));
  if (!head) {
    let bestS = -Infinity;
    for (const e of a.ends) {
      if (taken.has(e)) continue;
      const s = front
        ? (cy - e.tipY) / H - 1.2 * (Math.abs(e.tipX - cx) / W) + 0.3 * (e.bulk / maxBulk)
        : 1.2 * (e.bulk / maxBulk) + 0.6 * (Math.abs(e.tipX - cx) / W) + 0.3 * ((cy - e.tipY) / H);
      if (s > bestS) {
        bestS = s;
        head = e;
      }
    }
  }
  if (!head) head = a.ends.find((e) => !taken.has(e));
  if (!head) {
    fit.issues.push('no-head', 'missing-wing');
    fit.bones.push({ name: 'body', role: 'body', parent: null, a: [cx, bbox.y1], b: [cx, bbox.y0] });
    fit.anchor = [cx, bbox.y1 + 0.5];
    return fit;
  }
  taken.add(head);
  const facing: Facing = front ? 0 : facingHint ?? (head.tipX >= cx ? 1 : -1);
  fit.facing = facing;
  let tail = hinted('tail');
  if (!tail && !front) {
    tail = a.ends
      .filter((e) => !taken.has(e) && Math.sign(e.tipX - cx) === -facing && e.tipY > cy - 0.25 * H)
      .sort((p, q) => Math.abs(q.tipX - cx) - Math.abs(p.tipX - cx))[0];
  }
  if (tail) taken.add(tail);
  const { parent, dist } = skelTree(a, head.p);
  // the rear of the body: where the tail leaves it, else where the legs meet, else the lowest trunk point
  let rear: number;
  if (tail) rear = tail.junction >= 0 ? tail.junction : tail.p;
  else if (legs.length === 2) rear = lca(parent, legs[0].p, legs[1].p);
  else if (legs.length === 1) rear = legs[0].junction >= 0 ? legs[0].junction : legs[0].p;
  else {
    let lowest = -1;
    for (let i = 0; i < a.w * a.h; i++) if (a.skel[i] && parent[i] !== -2 && (lowest < 0 || i > lowest)) lowest = i;
    rear = lowest >= 0 ? lowest : head.p;
  }
  const spinePath = pathDown(parent, head.p, rear).reverse(); // rear ... head end
  if (spinePath.length < 2) spinePath.push(head.p);
  const spineIdx = new Map(spinePath.map((p, i) => [p, i] as [number, number]));
  const attachOf = (e: End) => pathToRoot(parent, e.p).find((p) => spineIdx.has(p)) ?? rear;
  if (!wings.length) {
    // side view: big branches leaving the body upward; two tips of one V-shaped wing count once
    const cands = a.ends
      .filter((e) => {
        if (taken.has(e)) return false;
        const at = attachOf(e);
        return dist[e.p] - dist[at] >= 0.15 * size && e.tipY < Math.floor(at / a.w);
      })
      .sort((p, q) => dist[q.p] - dist[attachOf(q)] - (dist[p.p] - dist[attachOf(p)]));
    let maxDt = 0;
    for (let i = 0; i < a.w * a.h; i++) if (a.dt[i] > maxDt) maxDt = a.dt[i];
    const regions = colourRegions(a);
    for (const e of cands) {
      if (wings.length >= 2) break;
      // two tips in one coloured piece (a V-shaped wing), or split inside a thin part: one wing
      const regionOf = (x: End) => {
        for (const p of branchPath(a, x).reverse()) {
          const q = nearestOn(a.solid, a.w, a.h, p % a.w, Math.floor(p / a.w), 4, (i) => regions.sizes[regions.labels[i]] >= Math.max(12, 0.01 * a.area));
          if (q >= 0) return regions.labels[q];
        }
        return 0;
      };
      const sameRegion = (o: End) => {
        const lo = regionOf(o), le = regionOf(e);
        return lo > 0 && lo === le && regions.sizes[lo] < 0.4 * a.area;
      };
      if (wings.some((o) => sameRegion(o) || a.dt[lca(parent, o.p, e.p)] < 0.5 * maxDt)) {
        taken.add(e);
        fit.used.add(e);
        continue;
      }
      wings.push(e);
      taken.add(e);
    }
  }
  if (!wings.length || (front && wings.length < 2)) {
    fit.issues.push('missing-wing');
    fit.notes.push('I couldn\'t find both wings. Add a wiggly bit, or pick another kind.');
  }
  const wingAttach = wings.map(attachOf);
  let shoulderIdx = wingAttach.length ? Math.max(...wingAttach.map((p) => spineIdx.get(p) ?? 0)) : Math.floor(spinePath.length * 0.5);
  shoulderIdx = Math.min(shoulderIdx, spinePath.length - 2);
  const headSection = spinePath.slice(shoulderIdx);
  const nIdx = Math.min(shoulderIdx + headJoint(a, headSection), spinePath.length - 1);
  const neck = px(a, spinePath[nIdx]);
  let hI = nIdx, hD = -1;
  for (let i = nIdx; i < spinePath.length; i++) if (a.dt[spinePath[i]] > hD) {
    hD = a.dt[spinePath[i]];
    hI = i;
  }
  const hc = px(a, spinePath[hI]);
  const hl = Math.hypot(hc[0] - neck[0], hc[1] - neck[1]);
  const headTip: P2 = front && hl >= 1
    ? castToEdge(a, hc, (hc[0] - neck[0]) / hl, (hc[1] - neck[1]) / hl)
    : [head.tipX, head.tipY];
  let rearP = px(a, rear);
  if (Math.hypot(rearP[0] - neck[0], rearP[1] - neck[1]) < 2) rearP = [neck[0], neck[1] + Math.max(2, a.limbR)];
  fit.bones.push({ name: 'body', role: 'body', parent: null, a: rearP, b: neck });
  fit.bones.push({ name: 'head', role: 'head', parent: 'body', a: neck, b: headTip });
  const sides: ('L' | 'R')[] = wings.length === 2 ? (wings[0].tipX <= wings[1].tipX ? ['L', 'R'] : ['R', 'L']) : ['R'];
  const hintSide = (e: End) => (e === hinted('wingL') ? 'L' : e === hinted('wingR') ? 'R' : null);
  wings.forEach((e, k) => {
    const side = hintSide(e) ?? sides[k];
    const g = limbGeometry(a, parent, wingAttach[k], e);
    snapMid(a, g, guide?.joints[`wing${side}2` as BoneRole], guide);
    pushLimb(fit, g, [`wing${side}1`, `wing${side}2`], [`wing${side}1` as BoneRole, `wing${side}2` as BoneRole], 'body');
  });
  if (tail) {
    const path = pathDown(parent, tail.junction >= 0 ? tail.junction : rear, tail.p);
    const ex = Math.min(exitIndex(a, path, tail.thick), Math.max(0, path.length - 1));
    const st = px(a, path[ex] ?? tail.p);
    const len = Math.hypot(tail.tipX - st[0], tail.tipY - st[1]);
    if (len > 0.2 * size && path.length - ex > 4) {
      const mid = arcPoint(a, path.slice(ex), 0.5);
      fit.bones.push({ name: 'tail1', role: 'tail1', parent: 'body', a: st, b: mid, dynamic: true });
      fit.bones.push({ name: 'tail2', role: 'tail2', parent: 'tail1', a: mid, b: [tail.tipX, tail.tipY], dynamic: true });
    } else fit.bones.push({ name: 'tail1', role: 'tail1', parent: 'body', a: st, b: [tail.tipX, tail.tipY], dynamic: true });
  }
  legs.sort((p, q) => p.tipX - q.tipX).forEach((e, k) => {
    const side = legs.length === 2 ? (k === 0 ? 'L' : 'R') : 'R';
    const g = limbGeometry(a, parent, attachOf(e), e);
    pushLimb(fit, g, [`leg${side}1`, `leg${side}2`], [`leg${side}1` as BoneRole, `leg${side}2` as BoneRole], 'body');
  });
  [head, ...wings, ...legs, ...(tail ? [tail] : [])].forEach((e) => fit.used.add(e));
  addExtras(a, fit);
  const feet = fit.bones.filter((b) => b.role === 'legL2' || b.role === 'legR2').map((b) => b.b[0]);
  fit.anchor = [feet.length ? feet.reduce((s, x) => s + x, 0) / feet.length : cx, bbox.y1 + 0.5];
  return fit;
}
