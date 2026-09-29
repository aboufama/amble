/**
 * Cutting the drawing into part images at art resolution.
 *
 * Flat drawings: each pixel goes to the part of the bone that owns it; contested outlines go to the
 * part drawn in front (the child drew that line last). At each joint between parts the hidden pixels
 * are synthesized so a swinging limb never opens a hole:
 * - underlay: a part drawn in front (an arm over the shirt) hides some of its parent; the parent gets
 *   its own fill inpainted there, and its outline continued along the completed edge;
 * - overhang: a part drawn behind (a tail, a far leg) is cut at the parent's outline; it is extended a
 *   shallow band under the parent in its own colours.
 * Every part then bleeds 2 px across its cut edges with its own edge colours, so bilinear sampling
 * never shows hairline cracks at the seams.
 *
 * Parts drawn on their own layers (`part:<name>`) use the layer's pixels as they are: nothing is hidden.
 */
import { close as closeMask, boxDilate, edt, nearestOn, RING_DX, RING_DY } from '../imgproc';
import { layerAlpha, toWorkX, toWorkY, type Analysis } from '../analyze';
import type { LayerPixels, Pixels, RigData, RigPart } from '../types';
import type { Ownership } from './ownership';

export type RGBA = [number, number, number, number];

export interface PartImage {
  /** 1 = this art pixel is in the part's image. */
  mask: Uint8Array;
  /** Synthesized colours (hidden areas, seam bleed) by art pixel. */
  synth: Map<number, RGBA>;
  /** Hidden-area pixels follow this bone rigidly (not the skin weights). */
  pinned: Map<number, number>;
  /** Where the part's real pixels come from: its own layer, or the flattened drawing. */
  source: LayerPixels | null;
}

export interface CutOptions {
  hidden: boolean;
  bleed: boolean;
  inkAware: boolean;
}

export function cutParts(
  img: Pixels, layers: Record<string, LayerPixels> | undefined, A: Analysis, rig: RigData, parts: RigPart[],
  boneToPart: Int16Array, adj: boolean[][], own: Ownership, opts: CutOptions,
): PartImage[] {
  const W = img.width, H = img.height;
  const px = img.data;
  const { w, h } = A;
  const layerOf = parts.map((p) => (p.layer && layers?.[p.layer]) || null);
  const flat = !layerOf.some((l) => l);
  const out: PartImage[] = parts.map((_, k) => ({ mask: new Uint8Array(W * H), synth: new Map(), pinned: new Map(), source: layerOf[k] }));
  // layer parts: exactly what was drawn on the layer
  const layered = new Uint8Array(W * H);
  layerOf.forEach((l, k) => {
    if (!l) return;
    const m = out[k].mask;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (layerAlpha(l, x, y) <= 8) continue;
      m[y * W + x] = 1;
      layered[y * W + x] = 1;
    }
  });
  const flatParts = parts.map((_, k) => !layerOf[k]);
  if (!flatParts.some((f) => f)) return out;
  // --- flat parts: pixel → part by bone ownership
  const partOf = new Int8Array(W * H).fill(-1);
  const toW = (v: number, s: number, lim: number) => Math.min(lim - 1, Math.max(0, Math.round((v + 0.5) * s + A.pad - 0.5)));
  for (let y = 0; y < H; y++) {
    const wy = toW(y, A.scale, h);
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (px[i * 4 + 3] <= 8 || layered[i]) continue;
      const k = boneToPart[own.ownerAll[wy * w + toW(x, A.scale, w)]];
      if (flatParts[k]) partOf[i] = k;
    }
  }
  const isInk = (i: number) => A.inkArt[i] === 1;
  const bb = parts.map(() => ({ x0: W, y0: H, x1: -1, y1: -1 }));
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const q = partOf[y * W + x];
    if (q < 0) continue;
    const b = bb[q];
    if (x < b.x0) b.x0 = x;
    if (x > b.x1) b.x1 = x;
    if (y < b.y0) b.y0 = y;
    if (y > b.y1) b.y1 = y;
  }
  /** Dilate {i in box(part, margin) : pred(i)} by r inside the box; returns a test function. */
  const cropDilate = (T: number, margin: number, r: number, pred: (i: number) => boolean) => {
    const b = bb[T];
    const x0 = Math.max(0, b.x0 - margin), y0 = Math.max(0, b.y0 - margin);
    const x1 = Math.min(W - 1, b.x1 + margin), y1 = Math.min(H - 1, b.y1 + margin);
    const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
    if (bw <= 0 || bh <= 0) return { x0, y0, x1, y1, has: () => false };
    const m = new Uint8Array(bw * bh);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) m[(y - y0) * bw + x - x0] = pred(y * W + x) ? 1 : 0;
    const d = boxDilate(m, bw, bh, r);
    return { x0, y0, x1, y1, has: (x: number, y: number) => d[(y - y0) * bw + x - x0] === 1 };
  };
  // contested ink goes to the part drawn in front
  if (opts.inkAware) {
    const byOrder = parts.map((_, k) => k).sort((a2, b2) => parts[b2].order - parts[a2].order);
    const claimed = new Uint8Array(W * H);
    for (const Q of byOrder) {
      if (!flatParts[Q] || bb[Q].x1 < 0) continue;
      const near = cropDilate(Q, 4, 3, (i) => partOf[i] === Q && !isInk(i));
      for (let y = near.y0; y <= near.y1; y++) for (let x = near.x0; x <= near.x1; x++) {
        const i = y * W + x;
        const P = partOf[i];
        if (P < 0 || P === Q || claimed[i] || !adj[P][Q] || parts[P].order > parts[Q].order || !near.has(x, y) || !isInk(i)) continue;
        partOf[i] = Q;
        claimed[i] = 1;
      }
    }
  }
  for (let i = 0; i < W * H; i++) if (partOf[i] >= 0) out[partOf[i]].mask[i] = 1;
  /** Onion-peel colour growth from part T's own pixels into `targets` (8-neighbour average). */
  const grow = (T: number, targets: Set<number>, isSource: (i: number) => boolean) => {
    const got = new Map<number, [number, number, number]>();
    const colour = (i: number): [number, number, number] | undefined =>
      got.get(i) ?? (partOf[i] === T && isSource(i) ? [px[i * 4], px[i * 4 + 1], px[i * 4 + 2]] : undefined);
    const nbrs8 = (i: number, f: (n: number) => void) => {
      const x = i % W, y = (i - x) / W;
      for (let k = 0; k < 8; k++) {
        const xx = x + RING_DX[k], yy = y + RING_DY[k];
        if (xx >= 0 && yy >= 0 && xx < W && yy < H) f(yy * W + xx);
      }
    };
    let frontier: number[] = [];
    for (const i of targets) {
      let ok = false;
      nbrs8(i, (n) => {
        if (!ok && !targets.has(n) && colour(n)) ok = true;
      });
      if (ok) frontier.push(i);
    }
    while (frontier.length) {
      const done: [number, [number, number, number]][] = [];
      for (const i of frontier) {
        if (got.has(i)) continue;
        let r = 0, g = 0, b = 0, m = 0;
        nbrs8(i, (n) => {
          const c = colour(n);
          if (c) {
            r += c[0];
            g += c[1];
            b += c[2];
            m++;
          }
        });
        if (m) done.push([i, [r / m, g / m, b / m]]);
      }
      for (const [i, c] of done) got.set(i, c);
      const next = new Set<number>();
      for (const [i] of done) nbrs8(i, (n) => {
        if (targets.has(n) && !got.has(n)) next.add(n);
      });
      frontier = [...next];
    }
    return got;
  };
  const added: Map<number, number>[] = parts.map(() => new Map());
  const outline: Set<number>[] = parts.map(() => new Set());
  if (opts.hidden && flat) {
    // the drawing's typical line width, for continued outlines
    const inkAll = new Uint8Array(W * H);
    for (let i = 0; i < W * H; i++) inkAll[i] = px[i * 4 + 3] > 128 && isInk(i) ? 1 : 0;
    const inkDt = edt(inkAll, W, H);
    const inkDs: number[] = [];
    for (let i = 0; i < W * H; i += 3) if (inkAll[i]) inkDs.push(inkDt[i]);
    inkDs.sort((a2, b2) => a2 - b2);
    const inkW = inkDs.length > 20 ? Math.max(1.5, Math.min(6, inkDs[Math.floor(inkDs.length * 0.9)] * 1.6)) : 0;
    const bones = rig.bones;
    bones.forEach((c, ci) => {
      if (c.parent < 0) return;
      const P = boneToPart[c.parent], C = boneToPart[ci];
      if (P === C || !flatParts[P] || !flatParts[C]) return;
      const front = parts[C].order > parts[P].order;
      const T = front ? P : C, F = front ? C : P, rigidBone = front ? c.parent : ci;
      const L = Math.hypot(c.x2 - c.x, c.y2 - c.y) || 1;
      const ux = (c.x2 - c.x) / L, uy = (c.y2 - c.y) / L;
      const jq = nearestOn(A.solid, w, h, toWorkX(A, c.x), toWorkY(A, c.y), 6);
      const rJ = (jq >= 0 ? A.dt[jq] : 3) / A.scale;
      const R = 2.2 * rJ + 6;
      for (let y = Math.max(0, Math.floor(c.y - R)); y <= Math.min(H - 1, Math.ceil(c.y + R)); y++) {
        for (let x = Math.max(0, Math.floor(c.x - R)); x <= Math.min(W - 1, Math.ceil(c.x + R)); x++) {
          const i = y * W + x;
          if (partOf[i] !== F || (x - c.x) ** 2 + (y - c.y) ** 2 > R * R) continue;
          const t = (x - c.x) * ux + (y - c.y) * uy;
          const perp = Math.abs(-(x - c.x) * uy + (y - c.y) * ux);
          // underlay: the child behind its pivot; overhang: a shallow band as wide as the child
          if (front ? t > 0 : t > 0.15 * rJ || t < -Math.max(3, 0.55 * rJ) || perp > 1.3 * rJ + 2) continue;
          if (!added[T].has(i)) added[T].set(i, rigidBone);
        }
      }
      if (front) {
        // plus the notch the child's drawing cuts into the parent: close(parent) inside the child
        const x0 = Math.max(0, Math.floor(c.x - R)), y0 = Math.max(0, Math.floor(c.y - R));
        const x1 = Math.min(W - 1, Math.ceil(c.x + R)), y1 = Math.min(H - 1, Math.ceil(c.y + R));
        const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
        const pm = new Uint8Array(bw * bh);
        for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) pm[(y - y0) * bw + x - x0] = partOf[y * W + x] === P ? 1 : 0;
        const closed = closeMask(pm, bw, bh, 1.2 * rJ + 2);
        const inside = edt(closed, bw, bh);
        for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
          const i = y * W + x;
          const k = (y - y0) * bw + x - x0;
          if (!closed[k] || partOf[i] !== C) continue;
          if ((x - c.x) * ux + (y - c.y) * uy > 0.6 * rJ) continue;
          if (!added[T].has(i)) added[T].set(i, rigidBone);
          // continue the parent's outline along its completed edge
          if (inside[k] <= inkW && y > y0 && y < y1 && x > x0 && x < x1) outline[T].add(i);
        }
      }
    });
    // inpaint: grow the part's own clean fill colours (>= 2 px from ink) into its added pixels; thin
    // parts (a tail) have no clean fill, so fall back to any non-ink, then any own pixel
    const nearInk = boxDilate(inkAll, W, H, 2);
    const inkSample: number[][] = [];
    for (let i = 0; i < W * H; i += 7) if (inkAll[i]) inkSample.push([px[i * 4], px[i * 4 + 1], px[i * 4 + 2]]);
    const med = (k: number) => inkSample.map((v) => v[k]).sort((a2, b2) => a2 - b2)[Math.floor(inkSample.length / 2)];
    const inkCol: RGBA | null = inkSample.length > 10 ? [med(0), med(1), med(2), 255] : null;
    parts.forEach((_, T) => {
      const add = added[T];
      if (!add.size) return;
      const targets = new Set(add.keys());
      let got = new Map<number, [number, number, number]>();
      for (const src of [(i: number) => !nearInk[i], (i: number) => !isInk(i), () => true]) {
        got = grow(T, targets, src);
        if (got.size >= add.size * 0.6) break;
      }
      for (const [i, bone] of add) {
        const c = got.get(i);
        if (!c) continue;
        out[T].synth.set(i, inkCol && outline[T].has(i) ? inkCol : [c[0], c[1], c[2], 255]);
        out[T].pinned.set(i, bone);
        out[T].mask[i] = 1;
      }
    });
  }
  if (opts.bleed) {
    parts.forEach((_, T) => {
      if (!flatParts[T] || bb[T].x1 < 0) return;
      const near = cropDilate(T, 3, 2, (i) => partOf[i] === T);
      const tgt = new Set<number>();
      for (let y = near.y0; y <= near.y1; y++) for (let x = near.x0; x <= near.x1; x++) {
        const i = y * W + x;
        const q = partOf[i];
        if (q >= 0 && q !== T && adj[T][q] && !out[T].synth.has(i) && near.has(x, y)) tgt.add(i);
      }
      for (const [i, c] of grow(T, tgt, () => true)) {
        out[T].synth.set(i, [c[0], c[1], c[2], px[i * 4 + 3]]);
        out[T].mask[i] = 1;
      }
    });
  }
  return out;
}
