/**
 * Region ownership: every pixel of the shape is owned by one bone. Bones grow through the shape from
 * their segments; each segment pixel starts at -(its ink-bounded thickness), so a bone owns the drawn
 * part its medial disc covers ("the medial disc that covers me most deeply wins"), and steps onto ink
 * cost 4x, so part borders snap to the outlines the child drew.
 */
import { geodesic, nearestOn, segmentPixels } from '../imgproc';
import { toWorkX, toWorkY, type Analysis } from '../analyze';
import type { RigData, RigPart } from '../types';

export interface Ownership {
  /** Bone per working pixel inside the shape, -1 outside. */
  owner: Int32Array;
  /** Bone per working pixel everywhere (the nearest owner): antialiased edges, loose accessories. */
  ownerAll: Int32Array;
  /** Bone geometry in working px. */
  ax: number[];
  ay: number[];
  bx: number[];
  by: number[];
}

export function computeOwnership(a: Analysis, rig: RigData, parts: RigPart[], boneToPart: Int16Array, inkAware = true): Ownership {
  const { w, h, solid, dt } = a;
  const bones = rig.bones;
  const nb = bones.length;
  const ax = bones.map((b) => toWorkX(a, b.x)), ay = bones.map((b) => toWorkY(a, b.y));
  const bx = bones.map((b) => toWorkX(a, b.x2)), by = bones.map((b) => toWorkY(a, b.y2));
  const thick = inkAware ? a.dtInk : dt;
  const seeds: number[] = [], offsets: number[] = [], labels: number[] = [];
  for (let b = 0; b < nb; b++) {
    let pix = segmentPixels(solid, w, h, ax[b], ay[b], bx[b], by[b]);
    if (!pix.length) {
      const q = nearestOn(solid, w, h, (ax[b] + bx[b]) / 2, (ay[b] + by[b]) / 2, 40);
      pix = q >= 0 ? [q] : [];
    }
    for (const p of pix) {
      seeds.push(p);
      offsets.push(-thick[p] + 0.01);
      labels.push(b);
    }
  }
  const owner = new Int32Array(w * h).fill(-1);
  geodesic(solid, w, h, seeds, { offsets, seedLabels: labels, owner, slow: inkAware ? a.ink : undefined, slowCost: 4 });
  // a part drawn BEHIND its parent never owns pixels behind its own pivot (they are the parent's):
  // a tail must not steal the rump
  for (let b = 0; b < nb; b++) {
    const pb = bones[b].parent;
    if (pb < 0 || parts[boneToPart[b]].order >= parts[boneToPart[pb]].order) continue;
    const vx = bx[b] - ax[b], vy = by[b] - ay[b];
    const L = Math.hypot(vx, vy) || 1;
    const jq = nearestOn(solid, w, h, ax[b], ay[b], 6);
    const lim = -0.3 * (jq >= 0 ? dt[jq] : 2);
    for (let i = 0; i < w * h; i++) {
      if (owner[i] !== b) continue;
      const t = ((i % w) - ax[b]) * (vx / L) + (Math.floor(i / w) - ay[b]) * (vy / L);
      if (t < lim) owner[i] = pb;
    }
  }
  // wheels own exactly their disc: they turn in place, so anything else they carried would spin
  const discs: number[] = [];
  for (let b = 0; b < nb; b++) if (isDisc(bones[b])) discs.push(b);
  const inDisc = (b: number, i: number, extra: number) =>
    Math.hypot((i % w) - ax[b], Math.floor(i / w) - ay[b]) <= Math.hypot(bx[b] - ax[b], by[b] - ay[b]) + extra;
  for (const b of discs) {
    const pb = Math.max(0, bones[b].parent);
    for (let i = 0; i < w * h; i++) {
      if (owner[i] === b && !inDisc(b, i, 0.5)) owner[i] = pb;
      else if (solid[i] && owner[i] !== b && inDisc(b, i, 0) && !discs.includes(owner[i])) owner[i] = b;
    }
  }
  const ownerAll = owner.slice();
  const q: number[] = [];
  for (let i = 0; i < w * h; i++) if (ownerAll[i] >= 0) q.push(i);
  if (!q.length) ownerAll.fill(0);
  for (let qi = 0; qi < q.length; qi++) {
    const p = q[qi];
    const x = p % w;
    for (const n of [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, p - w, p + w]) {
      if (n < 0 || n >= w * h || ownerAll[n] >= 0) continue;
      ownerAll[n] = ownerAll[p];
      q.push(n);
    }
  }
  for (const b of discs) {
    const pb = Math.max(0, bones[b].parent);
    for (let i = 0; i < w * h; i++) if (ownerAll[i] === b && !inDisc(b, i, 1.5)) ownerAll[i] = pb;
  }
  return { owner, ownerAll, ax, ay, bx, by };
}

/** Wheels: rigid bones from the centre to the rim, turning in place. */
export function isDisc(b: RigData['bones'][number]): boolean {
  return !!b.rigid && /^wheel/.test(b.name);
}
