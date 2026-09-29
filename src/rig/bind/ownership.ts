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
  if (inkAware) keepRegionsWhole(a, owner, seeds, labels, boneToPart);
  keepThinBonesClose(a, owner, ax, ay, bx, by);
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

/**
 * The drawn lines split the shape into regions (a shirt, a sleeve, a face). A part whose bones don't
 * run through a region owns none of it: a thick torso with a star on it must not lose the side under
 * the armpit to the arm next to it. Only pixels of other parts move, to the nearest owner that runs
 * through the region; ink between regions follows the regions it touches.
 */
function keepRegionsWhole(a: Analysis, owner: Int32Array, seeds: number[], labels: number[], boneToPart: Int16Array): void {
  const { w, h, solid, ink } = a;
  const n = w * h;
  const region = new Int32Array(n).fill(-1);
  const stack: number[] = [];
  let count = 0;
  for (let i = 0; i < n; i++) {
    if (!solid[i] || ink[i] || region[i] >= 0) continue;
    region[i] = count;
    stack.push(i);
    while (stack.length) {
      const p = stack.pop()!;
      const x = p % w;
      for (const q of [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, p - w, p + w]) {
        if (q < 0 || q >= n || region[q] >= 0 || !solid[q] || ink[q]) continue;
        region[q] = count;
        stack.push(q);
      }
    }
    count++;
  }
  // the parts that really run through a region: a bone merely grazing it (a body's end inside the
  // head, a wing's root inside the body) doesn't count
  const perRegion: Map<number, number>[] = Array.from({ length: count }, () => new Map<number, number>());
  seeds.forEach((p, k) => {
    if (region[p] < 0) return;
    const m = perRegion[region[p]], part = boneToPart[labels[k]];
    m.set(part, (m.get(part) ?? 0) + 1);
  });
  const seeded: Set<number>[] = perRegion.map((m) => {
    const most = Math.max(0, ...m.values());
    return new Set([...m].filter(([, c]) => c >= 0.35 * most).map(([part]) => part));
  });
  const partOf = (i: number) => (owner[i] >= 0 ? boneToPart[owner[i]] : -1);
  const ok = (i: number) => region[i] < 0 || !seeded[region[i]].size || seeded[region[i]].has(partOf(i));
  // grow the rightful owners of each region over its strays
  let frontier: number[] = [];
  const stray = new Uint8Array(n);
  for (let i = 0; i < n; i++) if (region[i] >= 0 && owner[i] >= 0 && !ok(i)) stray[i] = 1;
  for (let i = 0; i < n; i++) {
    if (!stray[i]) continue;
    const x = i % w;
    for (const q of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i - w, i + w]) {
      if (q >= 0 && q < n && region[q] === region[i] && !stray[q] && owner[q] >= 0) {
        frontier.push(i);
        break;
      }
    }
  }
  while (frontier.length) {
    const next: number[] = [];
    for (const i of frontier) {
      if (!stray[i]) continue;
      const x = i % w;
      let got = -1;
      for (const q of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i - w, i + w]) {
        if (q >= 0 && q < n && region[q] === region[i] && !stray[q] && owner[q] >= 0) {
          got = owner[q];
          break;
        }
      }
      if (got < 0) continue;
      owner[i] = got;
      stray[i] = 0;
      for (const q of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i - w, i + w]) if (q >= 0 && q < n && stray[q]) next.push(q);
    }
    frontier = next;
  }
  // ink: a line mostly bordering regions its part doesn't reach joins its neighbours (the torso's
  // side under an armpit is the torso's, even where it touches the sleeve)
  const moves: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    if (!ink[i] || owner[i] < 0) continue;
    const x = i % w, y = (i - x) / w;
    let mine = 0, other = 0;
    const votes = new Map<number, number>();
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const xx = x + dx, yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
      const q = yy * w + xx;
      if (region[q] < 0 || owner[q] < 0 || !seeded[region[q]].size) continue;
      if (seeded[region[q]].has(partOf(i))) mine++;
      else {
        other++;
        votes.set(owner[q], (votes.get(owner[q]) ?? 0) + 1);
      }
    }
    if (other <= mine) continue;
    let best = -1, bv = 0;
    for (const [o, v] of votes) if (v > bv) {
      bv = v;
      best = o;
    }
    if (best >= 0) moves.push([i, best]);
  }
  for (const [i, o] of moves) owner[i] = o;
}

/**
 * A bone owns only what lies within about twice its own thickness of it: a stick leg must not take
 * the body's edge running beside its top. Strays go to the nearest other owner.
 */
function keepThinBonesClose(a: Analysis, owner: Int32Array, ax: number[], ay: number[], bx: number[], by: number[]): void {
  const { w, h, dt } = a;
  const n = w * h;
  const stray = new Uint8Array(n);
  let any = false;
  for (let i = 0; i < n; i++) {
    const b = owner[i];
    if (b < 0) continue;
    const x = i % w, y = (i - x) / w;
    const vx = bx[b] - ax[b], vy = by[b] - ay[b];
    const L2 = vx * vx + vy * vy || 1;
    const t = Math.max(0, Math.min(1, ((x - ax[b]) * vx + (y - ay[b]) * vy) / L2));
    const cx = ax[b] + t * vx, cy = ay[b] + t * vy;
    const qx = Math.min(w - 1, Math.max(0, Math.round(cx))), qy = Math.min(h - 1, Math.max(0, Math.round(cy)));
    const r = Math.max(1, dt[qy * w + qx]);
    if (Math.hypot(x - cx, y - cy) > 2 * r + 2) {
      stray[i] = 1;
      any = true;
    }
  }
  if (!any) return;
  let frontier: number[] = [];
  for (let i = 0; i < n; i++) if (stray[i]) frontier.push(i);
  for (let round = 0; round < w + h && frontier.length; round++) {
    const next: number[] = [];
    const moves: [number, number][] = [];
    for (const i of frontier) {
      const x = i % w;
      let got = -1;
      for (const q of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i - w, i + w]) {
        if (q >= 0 && q < n && !stray[q] && owner[q] >= 0 && owner[q] !== owner[i]) {
          got = owner[q];
          break;
        }
      }
      if (got >= 0) moves.push([i, got]);
      else next.push(i);
    }
    if (!moves.length) break;
    for (const [i, o] of moves) {
      owner[i] = o;
      stray[i] = 0;
    }
    frontier = next;
  }
}
