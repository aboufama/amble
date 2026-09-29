/**
 * Quadruped template (side view): spine from hips to shoulders, neck and head, a springy tail, four
 * 2-bone legs. "L" legs are the far ones (drawn behind the body), "R" the near ones.
 * - Legs: up to four low ends. Head: bulky and far out. Facing: the side the head is on.
 * - Front/back legs split at the widest horizontal gap. A group with a single thick leg is split
 *   by colour: near and far legs drawn touching (the far one is usually darker).
 */
import type { Analysis, End } from '../analyze';
import type { BoneRole } from '../types';
import { exitIndex, headJoint, limbGeometry, newFit, pushLimb, splitByColour, straightLimb, type Fit } from './common';
import { arcPoint, lca, pathDown, pathToRoot, px, skelTree } from './graph';
import type { Guide } from './guide';
import { snapMid } from './snap';

export function fitQuadruped(a: Analysis, guide: Guide | null): Fit {
  const { bbox, cx, cy } = a;
  const H = bbox.y1 - bbox.y0 + 1, W = bbox.x1 - bbox.x0 + 1;
  const hinted = (slot: string) => guide?.ends.get(slot);
  const used = new Set<End>();
  const hintedLegs = ['legFL', 'legFR', 'legBL', 'legBR'].map((s) => hinted(s)).filter((e): e is End => !!e);
  hintedLegs.forEach((e) => used.add(e));
  let head = hinted('head');
  if (head) used.add(head);
  const legs = [
    ...hintedLegs,
    ...a.ends.filter((e) => !used.has(e) && e.tipY > cy + 0.12 * H).sort((p, q) => q.tipY - p.tipY),
  ].slice(0, 4);
  legs.forEach((e) => used.add(e));
  const others = a.ends.filter((e) => !used.has(e));
  const maxBulk = Math.max(1, ...a.ends.map((e) => e.bulk));
  const fit = newFit('quadruped', 1);
  if (!head) {
    let bestS = -Infinity;
    for (const e of others) {
      const s = 1.3 * (e.bulk / maxBulk) + 0.6 * (Math.abs(e.tipX - cx) / W) + 0.4 * ((cy - e.tipY) / H);
      if (s > bestS) {
        bestS = s;
        head = e;
      }
    }
  }
  if (!head) {
    fit.issues.push('no-head');
    head = others[0] ?? a.ends[0];
  }
  if (!head) {
    // a shape with no branches at all: one body bone
    fit.bones.push({ name: 'spine', role: 'spine', parent: null, a: [bbox.x0 + 0.2 * W, cy], b: [bbox.x1 - 0.2 * W, cy] });
    fit.anchor = [cx, bbox.y1 + 0.5];
    fit.issues.push('few-legs');
    return fit;
  }
  used.add(head);
  const facing: 1 | -1 = head.tipX >= cx ? 1 : -1;
  fit.facing = facing;
  const tail = hinted('tail') ?? others
    .filter((e) => e !== head && Math.sign(e.tipX - cx) === -facing)
    .sort((p, q) => Math.abs(q.tipX - cx) - Math.abs(p.tipX - cx))[0];
  if (tail) used.add(tail);
  const { parent } = skelTree(a, head.p);
  const byX = [...legs].sort((p, q) => (p.tipX - q.tipX) * facing); // back ... front
  let split = Math.ceil(byX.length / 2);
  if (byX.length >= 3) {
    let gap = -1;
    for (let i = 1; i < byX.length; i++) {
      const g = Math.abs(byX[i].tipX - byX[i - 1].tipX);
      if (g > gap) {
        gap = g;
        split = i;
      }
    }
  }
  const back = byX.slice(0, split), front = byX.slice(split);
  const junctionOf = (e: End) => (e.junction >= 0 ? e.junction : e.p);
  let rearNode: number;
  if (tail) rearNode = junctionOf(tail);
  else if (back.length >= 2) rearNode = lca(parent, back[0].p, back[1].p);
  else if (back.length === 1) rearNode = junctionOf(back[0]);
  else rearNode = front.length ? junctionOf(front[0]) : head.p;
  const axis = pathToRoot(parent, rearNode).reverse(); // head ... rear
  const axisIdx = new Map(axis.map((p, i) => [p, i] as [number, number]));
  const attachOf = (e: End) => pathToRoot(parent, e.p).find((p) => axisIdx.has(p)) ?? axis[axis.length - 1];
  const frontAtt = front.map(attachOf), backAtt = back.map(attachOf);
  const shoulders = frontAtt.length
    ? frontAtt.reduce((m, p) => ((axisIdx.get(p) ?? 0) < (axisIdx.get(m) ?? 0) ? p : m))
    : axis[Math.floor(axis.length * 0.3)];
  const hipsP = backAtt.length
    ? backAtt.reduce((m, p) => ((axisIdx.get(p) ?? 0) > (axisIdx.get(m) ?? 0) ? p : m))
    : axis[Math.floor(axis.length * 0.8)];
  const sh = px(a, shoulders), hp = px(a, hipsP);
  fit.bones.push({ name: 'spine', role: 'spine', parent: null, a: hp, b: sh });
  const si = axisIdx.get(shoulders) ?? 0;
  const headPath = axis.slice(0, si + 1).reverse(); // shoulders ... head end
  const nk = headJoint(a, headPath);
  const neckP = px(a, headPath[nk]);
  if (nk > 2) {
    fit.bones.push({ name: 'neck', role: 'neck', parent: 'spine', a: sh, b: neckP });
    fit.bones.push({ name: 'head', role: 'head', parent: 'neck', a: neckP, b: [head.tipX, head.tipY] });
  } else fit.bones.push({ name: 'head', role: 'head', parent: 'spine', a: sh, b: [head.tipX, head.tipY] });
  if (tail) {
    const path = pathDown(parent, junctionOf(tail), tail.p);
    const ex = Math.min(exitIndex(a, path, tail.thick), path.length - 1);
    const st = px(a, path[ex]);
    const len = Math.hypot(tail.tipX - st[0], tail.tipY - st[1]);
    if (len > 0.18 * Math.max(W, H)) {
      const mid = arcPoint(a, path.slice(ex), 0.5);
      fit.bones.push({ name: 'tail1', role: 'tail1', parent: 'spine', a: st, b: mid, dynamic: true });
      fit.bones.push({ name: 'tail2', role: 'tail2', parent: 'tail1', a: mid, b: [tail.tipX, tail.tipY], dynamic: true });
    } else fit.bones.push({ name: 'tail1', role: 'tail1', parent: 'spine', a: st, b: [tail.tipX, tail.tipY], dynamic: true });
  } else fit.issues.push('no-tail');
  const feet: number[] = [];
  const doGroup = (grp: End[], att: number[], fb: 'F' | 'B') => {
    if (grp.length === 1) {
      const sp = splitByColour(a, att[0], grp[0]);
      if (sp) {
        sp.forEach((s, i) => {
          const n = `leg${fb}${i === 0 ? 'L' : 'R'}`;
          pushLimb(fit, straightLimb(s.top, s.bottom), [`${n}1`, `${n}2`], [`${n}1` as BoneRole, `${n}2` as BoneRole], 'spine');
          feet.push(s.bottom[0]);
        });
        fit.notes.push(`The ${fb === 'F' ? 'front' : 'back'} legs touch, so I split them by colour.`);
        return;
      }
    }
    // with two legs in a group, the one further back along the facing direction is the far one
    const order = grp.length === 2 ? [...grp].sort((p, q) => (p.tipX - q.tipX) * facing) : grp;
    order.forEach((e) => {
      const side = grp.length === 2 ? (e === order[0] ? 'L' : 'R') : 'R';
      const n = `leg${fb}${side}`;
      const g = limbGeometry(a, parent, att[grp.indexOf(e)], e);
      snapMid(a, g, guide?.joints[`${n}2` as BoneRole], guide);
      pushLimb(fit, g, [`${n}1`, `${n}2`], [`${n}1` as BoneRole, `${n}2` as BoneRole], 'spine');
      feet.push(e.tipX);
    });
  };
  doGroup(front, frontAtt, 'F');
  doGroup(back, backAtt, 'B');
  if (feet.length < 4) {
    fit.issues.push('few-legs');
    fit.notes.push(`I found ${feet.length} legs. Drag the joints, or press Mirror sides to copy a leg.`);
  }
  [...legs, head, ...(tail ? [tail] : [])].forEach((e) => fit.used.add(e));
  fit.anchor = [feet.length ? feet.reduce((s, x) => s + x, 0) / feet.length : cx, bbox.y1 + 0.5];
  return fit;
}
