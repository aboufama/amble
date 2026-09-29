/**
 * Meshes and weights: a global lattice (cell ~ sqrt(area/160) px) of which each part meshes the cells
 * it touches, so legs drawn close together never share triangles; the parts' images are shelf-packed
 * into one atlas; each vertex takes its owner bone at full weight, blended with the bones it shares a
 * joint with inside the same part (elbows, knees, spine/hips) by exp(-geodesic distance / tau).
 * Between parts the joint is a rigid pin (cut-out); hidden-area pixels follow their pinned bone.
 */
import { geodesic, nearestOn } from '../imgproc';
import { layerAlpha, type Analysis } from '../analyze';
import type { BoundRig, PartRange, Pixels, RigData, RigPart } from '../types';
import type { PartImage } from './cut';
import type { Ownership } from './ownership';

export interface MeshOptions {
  cell?: number;
  blend: number;
  softPartJoints: boolean;
}

interface PartMesh {
  cells: number[];
  ci0: number;
  cj0: number;
  ci1: number;
  cj1: number;
  verts: Map<number, number>;
  vlist: number[];
}

export type MeshResult = Omit<BoundRig, 'rig' | 'flat' | 'stats'> & { cell: number };

export function buildMesh(
  img: Pixels, A: Analysis, rig: RigData, parts: RigPart[], boneToPart: Int16Array, adj: boolean[][],
  own: Ownership, images: PartImage[], opts: MeshOptions,
): MeshResult {
  const W = img.width, H = img.height;
  const { w, h, scale: s, pad, solid, dt } = A;
  const bones = rig.bones;
  const nb = bones.length;
  const { owner, ownerAll, ax, ay, bx, by } = own;
  // --- lattice mesh per part
  let area = 0;
  const any = new Uint8Array(W * H);
  for (const im of images) for (let i = 0; i < W * H; i++) if (im.mask[i] && !any[i]) {
    any[i] = 1;
    area++;
  }
  const cell = Math.max(6, Math.min(28, Math.round(opts.cell ?? rig.skin?.cell ?? Math.sqrt(area / 160))));
  const cols = Math.ceil(W / cell), rows = Math.ceil(H / cell);
  const meshes: PartMesh[] = images.map((im) => {
    const has = new Uint8Array(cols * rows);
    for (let y = 0; y < H; y++) {
      const cj = Math.floor(y / cell);
      for (let x = 0; x < W; x++) if (im.mask[y * W + x]) has[cj * cols + Math.floor(x / cell)] = 1;
    }
    const cells: number[] = [];
    let ci0 = cols, cj0 = rows, ci1 = -1, cj1 = -1;
    for (let k = 0; k < cols * rows; k++) {
      if (!has[k]) continue;
      cells.push(k);
      const ci = k % cols, cj = Math.floor(k / cols);
      ci0 = Math.min(ci0, ci);
      ci1 = Math.max(ci1, ci);
      cj0 = Math.min(cj0, cj);
      cj1 = Math.max(cj1, cj);
    }
    const verts = new Map<number, number>();
    const vlist: number[] = [];
    for (const k of cells) {
      const ci = k % cols, cj = Math.floor(k / cols);
      for (const [di, dj] of [[0, 0], [1, 0], [1, 1], [0, 1]]) {
        const key = (cj + dj) * (cols + 1) + ci + di;
        if (!verts.has(key)) {
          verts.set(key, vlist.length);
          vlist.push(key);
        }
      }
    }
    return { cells, ci0, cj0, ci1, cj1, verts, vlist };
  });
  // --- atlas (shelf packing)
  const PADPX = 2;
  const rects = meshes.map((m) => (m.cells.length
    ? { x: m.ci0 * cell, y: m.cj0 * cell, w: (m.ci1 - m.ci0 + 1) * cell, h: (m.cj1 - m.cj0 + 1) * cell }
    : { x: 0, y: 0, w: 0, h: 0 }));
  const totalArea = rects.reduce((t, r) => t + (r.w + 2 * PADPX) * (r.h + 2 * PADPX), 0);
  const maxW = Math.max(1, ...rects.map((r) => r.w + 2 * PADPX));
  const shelfW = Math.max(maxW, Math.ceil(Math.sqrt(totalArea * 1.15)));
  const order = rects.map((_, i) => i).sort((p, q) => rects[q].h - rects[p].h);
  const slots = rects.map(() => ({ x: 0, y: 0 }));
  let cx = 0, cy = 0, shelfH = 0;
  for (const i of order) {
    const r = rects[i];
    if (!r.w) continue;
    const rw = r.w + 2 * PADPX, rh = r.h + 2 * PADPX;
    if (cx + rw > shelfW) {
      cx = 0;
      cy += shelfH;
      shelfH = 0;
    }
    slots[i] = { x: cx + PADPX, y: cy + PADPX };
    cx += rw;
    shelfH = Math.max(shelfH, rh);
  }
  const atlasW = shelfW, atlasH = Math.max(1, cy + shelfH);
  const atlasData = new Uint8ClampedArray(atlasW * atlasH * 4);
  images.forEach((im, p) => {
    const r = rects[p];
    if (!r.w) return;
    const src = im.source;
    for (let y = 0; y < r.h; y++) {
      const sy = r.y + y;
      if (sy >= H) break;
      for (let x = 0; x < r.w; x++) {
        const sx = r.x + x;
        if (sx >= W) break;
        const si = sy * W + sx;
        if (!im.mask[si]) continue;
        const o = ((slots[p].y + y) * atlasW + slots[p].x + x) * 4;
        const syn = im.synth.get(si);
        if (syn) {
          atlasData[o] = syn[0];
          atlasData[o + 1] = syn[1];
          atlasData[o + 2] = syn[2];
          atlasData[o + 3] = syn[3];
        } else if (src) {
          const lx = sx - (src.x ?? 0), ly = sy - (src.y ?? 0);
          const so = (ly * src.width + lx) * 4;
          atlasData[o] = src.data[so];
          atlasData[o + 1] = src.data[so + 1];
          atlasData[o + 2] = src.data[so + 2];
          atlasData[o + 3] = layerAlpha(src, sx, sy);
        } else {
          const so = si * 4;
          atlasData[o] = img.data[so];
          atlasData[o + 1] = img.data[so + 1];
          atlasData[o + 2] = img.data[so + 2];
          atlasData[o + 3] = img.data[so + 3];
        }
      }
    }
  });
  // --- weights
  const tauOf = new Float32Array(nb);
  for (let b = 0; b < nb; b++) {
    const q = nearestOn(solid, w, h, ax[b], ay[b], 6);
    tauOf[b] = opts.blend * Math.max(1.5, q >= 0 ? dt[q] : 2);
  }
  const jointSib = (i: number, j: number) => bones[i].parent === bones[j].parent && Math.hypot(ax[i] - ax[j], ay[i] - ay[j]) < 1.5;
  const nbrs: number[][] = bones.map((b, i) => {
    const o: number[] = [];
    if (b.parent >= 0) o.push(b.parent);
    bones.forEach((c, j) => {
      if (c.parent === i || (j !== i && jointSib(i, j))) o.push(j);
    });
    return o;
  });
  const pairTau = (b0: number, b: number) =>
    bones[b].parent === b0 ? tauOf[b] : bones[b0].parent === b ? tauOf[b0] : Math.max(tauOf[b], tauOf[b0]);
  // distance from each bone's region, only through the regions that may blend with it
  const regionDist: Float64Array[] = [];
  const dom = new Uint8Array(w * h);
  const empty = new Float64Array(0);
  for (let b = 0; b < nb; b++) {
    if (!nbrs[b].length) {
      regionDist.push(empty);
      continue;
    }
    const allowed = new Set([b, ...nbrs[b]]);
    for (let i = 0; i < w * h; i++) dom[i] = owner[i] >= 0 && allowed.has(owner[i]) ? 1 : 0;
    const sd: number[] = [];
    for (let i = w; i < w * h - w; i++) {
      if (owner[i] !== b) continue;
      if ((owner[i - 1] !== b && dom[i - 1]) || (owner[i + 1] !== b && dom[i + 1]) || (owner[i - w] !== b && dom[i - w]) || (owner[i + w] !== b && dom[i + w])) sd.push(i);
    }
    const maxD = 4 * Math.max(...nbrs[b].map((n) => pairTau(b, n)));
    regionDist.push(geodesic(dom, w, h, sd, { maxDist: maxD }));
  }
  /** Distance of a working point to a bone, measured as a joint-aware segment (layer parts). */
  const hasChild = new Array<boolean>(nb).fill(false);
  bones.forEach((b) => {
    if (b.parent >= 0) hasChild[b.parent] = true;
  });
  const jointDist = (i: number, x: number, y: number) => {
    const vx = bx[i] - ax[i], vy = by[i] - ay[i];
    const L = Math.hypot(vx, vy) || 1;
    const ux = vx / L, uy = vy / L;
    const t = (x - ax[i]) * ux + (y - ay[i]) * uy;
    const perp = Math.abs(-(x - ax[i]) * uy + (y - ay[i]) * ux);
    let along = 0;
    if (t < 0) along = -t * 2.5;
    else if (t > L) along = (t - L) * (hasChild[i] ? 2.5 : 1);
    return Math.hypot(along, perp);
  };
  const boneIndex = new Map(bones.map((b, i) => [b.name, i] as [string, number]));
  const rigid = bones.map((b) => !!b.rigid);
  const allV: number[] = [], allUV: number[] = [], bIdx: number[] = [], bW: number[] = [], tris: number[] = [];
  const partRanges: PartRange[] = [];
  const tmpW = new Float32Array(nb);
  parts.forEach((part, p) => {
    const m = meshes[p];
    const base = allV.length / 2;
    const r = rects[p], slot = slots[p];
    const own = part.bones.map((n) => boneIndex.get(n)).filter((i): i is number => i !== undefined);
    // a rigid piece (a wheel, a held sword) moves as one: no vertex of it may stay with a neighbour
    const allRigid = own.length > 0 && own.every((b) => rigid[b]);
    const topCount = new Float32Array(nb);
    for (const key of m.vlist) {
      const li = key % (cols + 1), lj = Math.floor(key / (cols + 1));
      const X = li * cell, Y = lj * cell;
      allV.push(X, Y);
      allUV.push((X - r.x + slot.x) / atlasW, (Y - r.y + slot.y) / atlasH);
      const wx = X * s + pad, wy = Y * s + pad;
      const ix = Math.min(w - 1, Math.max(0, Math.round(wx))), iy = Math.min(h - 1, Math.max(0, Math.round(wy)));
      tmpW.fill(0);
      const artI = Math.min(H - 1, Math.max(0, Math.round(Y))) * W + Math.min(W - 1, Math.max(0, Math.round(X)));
      const pinned = images[p].pinned.get(artI);
      if (pinned !== undefined) tmpW[pinned] = 1;
      else if (allRigid) {
        let best = own[0], bd = Infinity;
        for (const b of own) {
          const d = jointDist(b, wx, wy);
          if (d < bd) {
            bd = d;
            best = b;
          }
        }
        tmpW[best] = 1;
      } else if (images[p].source && own.length) {
        // a layer part: only its own bones, nearest first, blended within the part
        let best = own[0], bd = Infinity;
        for (const b of own) {
          const d = jointDist(b, wx, wy);
          if (d < bd) {
            bd = d;
            best = b;
          }
        }
        tmpW[best] = 1;
        if (!rigid[best]) for (const b of own) {
          if (b === best || !nbrs[best].includes(b)) continue;
          const tau = pairTau(best, b);
          const d = jointDist(b, wx, wy) - bd;
          if (d < tau * 4) tmpW[b] = Math.exp(-d / tau);
        }
      } else {
        let q = iy * w + ix;
        const okPart = (i: number) => owner[i] >= 0 && boneToPart[owner[i]] === p;
        if (!(solid[q] && owner[q] >= 0 && (boneToPart[owner[q]] === p || adj[p][boneToPart[owner[q]]]))) {
          const r2 = Math.ceil(cell * s) + 3;
          let qq = nearestOn(solid, w, h, wx, wy, r2, okPart);
          if (qq < 0) qq = nearestOn(solid, w, h, wx, wy, r2, (i) => owner[i] >= 0 && adj[p][boneToPart[owner[i]]]);
          q = qq;
        }
        if (q < 0 || owner[q] < 0) {
          // loose accessory or nothing nearby: follow the expanded owner rigidly
          const o = ownerAll[iy * w + ix];
          tmpW[o >= 0 ? o : own[0] ?? 0] = 1;
        } else {
          const b0 = owner[q];
          tmpW[b0] = 1;
          if (!rigid[b0]) {
            for (const b of nbrs[b0]) {
              // between parts: a pinned cut-out joint; within a part: smooth skinning
              if (boneToPart[b] !== boneToPart[b0] && !opts.softPartJoints) continue;
              const tau = pairTau(b0, b);
              const d = regionDist[b][q];
              if (d < tau * 4) tmpW[b] = Math.exp(-d / tau);
            }
          }
        }
      }
      const top = Array.from(tmpW, (v, i) => [v, i] as [number, number]).filter((e) => e[0] > 0.01).sort((a2, b2) => b2[0] - a2[0]).slice(0, 4);
      const sum = top.reduce((acc, e) => acc + e[0], 0) || 1;
      if (top[0]) topCount[top[0][1]]++;
      for (let k = 0; k < 4; k++) {
        bIdx.push(top[k] ? top[k][1] : 0);
        bW.push(top[k] ? top[k][0] / sum : 0);
      }
    }
    const first = tris.length / 3;
    for (const k of m.cells) {
      const ci = k % cols, cj = Math.floor(k / cols);
      const v00 = base + m.verts.get(cj * (cols + 1) + ci)!;
      const v10 = base + m.verts.get(cj * (cols + 1) + ci + 1)!;
      const v11 = base + m.verts.get((cj + 1) * (cols + 1) + ci + 1)!;
      const v01 = base + m.verts.get((cj + 1) * (cols + 1) + ci)!;
      if ((ci + cj) % 2 === 0) tris.push(v00, v10, v11, v00, v11, v01);
      else tris.push(v00, v10, v01, v10, v11, v01);
    }
    let dominant = own[0] ?? 0, dc = -1;
    topCount.forEach((c, i) => {
      if (c > dc) {
        dc = c;
        dominant = i;
      }
    });
    partRanges.push({
      name: part.name, first, count: tris.length / 3 - first, order: part.order,
      atlas: { x: slot.x, y: slot.y, w: r.w, h: r.h }, art: { x: r.x, y: r.y, w: r.w, h: r.h }, bone: dominant,
    });
  });
  const nv = allV.length / 2;
  return {
    width: W,
    height: H,
    rest: Float32Array.from(allV),
    uvs: Float32Array.from(allUV),
    indices: nv < 65536 ? Uint16Array.from(tris) : Uint32Array.from(tris),
    boneIdx: Uint8Array.from(bIdx),
    boneW: Float32Array.from(bW),
    atlas: { data: atlasData, width: atlasW, height: atlasH },
    partRanges,
    cell,
  };
}
