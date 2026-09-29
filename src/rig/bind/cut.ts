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
 * Every part then bleeds 2 px under the parts drawn in front of it, with its own edge colours, so
 * bilinear sampling never shows hairline cracks at the seams.
 *
 * Parts drawn on their own layers (`part:<name>`) use the layer's pixels as they are: nothing is hidden.
 */
import { boxDilate, nearestOn, RING_DX, RING_DY } from '../imgproc';
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
  /** Bounding box of `mask` (x1 < x0 when empty). */
  box: { x0: number; y0: number; x1: number; y1: number };
}

function withBoxes(out: PartImage[], W: number, H: number): PartImage[] {
  for (const im of out) {
    const b = { x0: W, y0: H, x1: -1, y1: -1 };
    const m = im.mask;
    for (let y = 0; y < H; y++) {
      const row = y * W;
      for (let x = 0; x < W; x++) {
        if (!m[row + x]) continue;
        if (x < b.x0) b.x0 = x;
        if (x > b.x1) b.x1 = x;
        if (y < b.y0) b.y0 = y;
        b.y1 = y;
      }
    }
    im.box = b;
  }
  return out;
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
  const out: PartImage[] = parts.map((_, k) => ({ mask: new Uint8Array(W * H), synth: new Map(), pinned: new Map(), source: layerOf[k], box: { x0: W, y0: H, x1: -1, y1: -1 } }));
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
  if (!flatParts.some((f) => f)) return withBoxes(out, W, H);
  // --- flat parts: pixel → part by bone ownership
  const partOf = new Int8Array(W * H).fill(-1);
  const toW = (v: number, s: number, lim: number) => Math.min(lim - 1, Math.max(0, Math.round((v + 0.5) * s + A.pad - 0.5)));
  const workOf = (i: number) => toW(Math.floor(i / W), A.scale, h) * w + toW(i % W, A.scale, w);
  const fringe: number[] = [];
  for (let i = 0; i < W * H; i++) {
    if (px[i * 4 + 3] <= 8 || layered[i]) continue;
    const o = own.owner[workOf(i)];
    if (o < 0) {
      fringe.push(i);
      continue;
    }
    if (flatParts[boneToPart[o]]) partOf[i] = boneToPart[o];
  }
  // soft edges outside the working shape belong to the stroke they soften: each takes the part of its
  // most opaque neighbour, most opaque first (else a thin leg would take the body's edge beside it)
  fringe.sort((a2, b2) => px[b2 * 4 + 3] - px[a2 * 4 + 3]);
  let pending = fringe;
  for (let pass = 0; pass < 4 && pending.length; pass++) {
    const next: number[] = [];
    for (const i of pending) {
      const x = i % W, y = (i - x) / W;
      let best = -1, ba = -1;
      for (let k = 0; k < 8; k++) {
        const xx = x + RING_DX[k], yy = y + RING_DY[k];
        if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
        const n = yy * W + xx;
        if (partOf[n] >= 0 && px[n * 4 + 3] > ba) {
          ba = px[n * 4 + 3];
          best = partOf[n];
        }
      }
      if (best >= 0) partOf[i] = best;
      else next.push(i);
    }
    pending = next;
  }
  for (const i of pending) {
    const k = boneToPart[own.ownerAll[workOf(i)]];
    if (flatParts[k]) partOf[i] = k;
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
  // the drawing's line width (from the analysis): outlines are claimed and continued at this width
  const inkAll = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) inkAll[i] = px[i * 4 + 3] > 128 && isInk(i) ? 1 : 0;
  const halfStroke = A.strokeW > 0 ? (A.strokeW / A.scale) * 0.6 : 0;
  const inkW = halfStroke ? Math.max(1.5, Math.min(6, halfStroke * 1.6)) : 0;
  // contested ink goes to the part drawn in front: all of its outline, not only the half nearest it
  if (opts.inkAware) {
    const reach = Math.max(3, Math.min(10, Math.ceil(2 * halfStroke) + 1));
    const byOrder = parts.map((_, k) => k).sort((a2, b2) => parts[b2].order - parts[a2].order);
    const claimed = new Uint8Array(W * H);
    for (const Q of byOrder) {
      if (!flatParts[Q] || bb[Q].x1 < 0) continue;
      const b = bb[Q];
      const x0 = Math.max(0, b.x0 - reach - 1), y0 = Math.max(0, b.y0 - reach - 1);
      const x1 = Math.min(W - 1, b.x1 + reach + 1), y1 = Math.min(H - 1, b.y1 + reach + 1);
      const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
      // a line with the front part's paint and another part's paint both within a stroke's width
      // lies between them and is contested (all of it goes to the front part); a line only the other
      // part borders (a torso's side under the armpit) stays with it
      const paintQ = new Uint8Array(bw * bh), paintO = new Uint8Array(bw * bh);
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const i = y * W + x, k = (y - y0) * bw + x - x0;
        if (partOf[i] < 0 || isInk(i)) continue;
        if (partOf[i] === Q) paintQ[k] = 1;
        else paintO[k] = 1;
      }
      const nearQ = boxDilate(paintQ, bw, bh, reach), nearO = boxDilate(paintO, bw, bh, reach);
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const i = y * W + x, k = (y - y0) * bw + x - x0;
        const P = partOf[i];
        if (P < 0 || P === Q || claimed[i] || !adj[P][Q] || parts[P].order > parts[Q].order || !isInk(i)) continue;
        if (!nearQ[k] || !nearO[k]) continue;
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
    const bones = rig.bones;
    bones.forEach((c, ci) => {
      if (c.parent < 0) return;
      const P = boneToPart[c.parent], C = boneToPart[ci];
      if (P === C || !flatParts[P] || !flatParts[C]) return;
      const front = parts[C].order > parts[P].order;
      const T = front ? P : C, F = front ? C : P, rigidBone = front ? c.parent : ci;
      const L = Math.hypot(c.x2 - c.x, c.y2 - c.y) || 1;
      const ux = (c.x2 - c.x) / L, uy = (c.y2 - c.y) / L;
      // the child's own thickness where it starts (a joint inside the parent sees the parent's)
      const tq = nearestOn(A.solid, w, h, toWorkX(A, c.x + ux * Math.min(L * 0.3, 12)), toWorkY(A, c.y + uy * Math.min(L * 0.3, 12)), 6);
      const jq = nearestOn(A.solid, w, h, toWorkX(A, c.x), toWorkY(A, c.y), 6);
      const rJ = Math.min(jq >= 0 ? A.dt[jq] : 3, tq >= 0 ? A.dt[tq] : 3) / A.scale;
      const R = 2.2 * rJ + 6;
      if (!front) {
        // overhang: the child behind extends a shallow band, as wide as itself, under the parent
        for (let y = Math.max(0, Math.floor(c.y - R)); y <= Math.min(H - 1, Math.ceil(c.y + R)); y++) {
          for (let x = Math.max(0, Math.floor(c.x - R)); x <= Math.min(W - 1, Math.ceil(c.x + R)); x++) {
            const i = y * W + x;
            if (partOf[i] !== F || (x - c.x) ** 2 + (y - c.y) ** 2 > R * R) continue;
            const t = (x - c.x) * ux + (y - c.y) * uy;
            const perp = Math.abs(-(x - c.x) * uy + (y - c.y) * ux);
            if (t > 0.15 * rJ || t < -Math.max(3, 0.55 * rJ) || perp > 1.3 * rJ + 2) continue;
            if (!added[T].has(i)) added[T].set(i, rigidBone);
          }
        }
        return;
      }
      // underlay: where the child covers the parent, the parent continues as the convex hull of its
      // own pixels around the child, with its outline along the hull, so a lifted arm uncovers a plain
      // continuation of the shirt rather than a hole or the arm's own shape
      const cb = bb[C];
      if (cb.x1 < 0) return;
      const mx = Math.round((cb.x1 - cb.x0) * 0.25) + 4, my = Math.round((cb.y1 - cb.y0) * 0.25) + 4;
      const x0 = Math.max(0, cb.x0 - mx), y0 = Math.max(0, cb.y0 - my);
      const x1 = Math.min(W - 1, cb.x1 + mx), y1 = Math.min(H - 1, cb.y1 + my);
      const pts: [number, number][] = [];
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const i = y * W + x;
        if (partOf[i] !== P) continue;
        const inner = x > 0 && y > 0 && x < W - 1 && y < H - 1 && partOf[i - 1] === P && partOf[i + 1] === P && partOf[i - W] === P && partOf[i + W] === P;
        if (!inner) pts.push([x + 0.5, y + 0.5]);
      }
      const hull = convexHull(pts);
      if (hull.length < 3) return;
      let hx0 = Infinity, hy0 = Infinity, hx1 = -Infinity, hy1 = -Infinity;
      for (const [hx, hy] of hull) {
        hx0 = Math.min(hx0, hx);
        hx1 = Math.max(hx1, hx);
        hy0 = Math.min(hy0, hy);
        hy1 = Math.max(hy1, hy);
      }
      for (let y = Math.max(cb.y0, Math.floor(hy0)); y <= Math.min(cb.y1, Math.ceil(hy1)); y++) for (let x = Math.max(cb.x0, Math.floor(hx0)); x <= Math.min(cb.x1, Math.ceil(hx1)); x++) {
        const i = y * W + x;
        if (partOf[i] !== C) continue;
        const d = insideDistance(hull, x + 0.5, y + 0.5);
        if (d < 0) continue;
        if (!added[T].has(i)) added[T].set(i, rigidBone);
        if (d <= inkW) outline[T].add(i);
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
      // colour from the cleanest source that reaches each pixel; the part's own pixels that aren't a
      // source (next to ink) carry the growth across, so a notch lined with ink still fills
      const got = new Map<number, [number, number, number]>();
      let x0 = W, y0 = H, x1 = 0, y1 = 0;
      for (const i of add.keys()) {
        const x = i % W, y = (i - x) / W;
        x0 = Math.min(x0, x);
        x1 = Math.max(x1, x);
        y0 = Math.min(y0, y);
        y1 = Math.max(y1, y);
      }
      x0 = Math.max(0, x0 - 6);
      y0 = Math.max(0, y0 - 6);
      x1 = Math.min(W - 1, x1 + 6);
      y1 = Math.min(H - 1, y1 + 6);
      for (const src of [(i: number) => !nearInk[i], (i: number) => !isInk(i), () => true]) {
        const targets = new Set<number>();
        for (const i of add.keys()) if (!got.has(i)) targets.add(i);
        if (!targets.size) break;
        for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
          const i = y * W + x;
          if (partOf[i] === T && !src(i)) targets.add(i);
        }
        for (const [i, c] of grow(T, targets, src)) if (add.has(i) && !got.has(i)) got.set(i, c);
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
        // only under a part drawn in front: a front part's own edge is what shows, and bleeding it
        // outward would carry its neighbour's lines along when it moves
        if (q >= 0 && q !== T && adj[T][q] && parts[q].order > parts[T].order && !out[T].synth.has(i) && near.has(x, y)) tgt.add(i);
      }
      for (const [i, c] of grow(T, tgt, () => true)) {
        out[T].synth.set(i, [c[0], c[1], c[2], px[i * 4 + 3]]);
        out[T].mask[i] = 1;
      }
    });
  }
  return withBoxes(out, W, H);
}

/** Convex hull (counter-clockwise on screen, y down) of points, by the monotone chain. */
function convexHull(pts: [number, number][]): [number, number][] {
  if (pts.length < 3) return pts;
  const p = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: [number, number], a: [number, number], b: [number, number]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: [number, number][] = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop();
    lower.push(q);
  }
  const upper: [number, number][] = [];
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop();
    upper.push(q);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

/** Distance from a point inside a convex polygon to its boundary (negative outside). */
function insideDistance(hull: [number, number][], x: number, y: number): number {
  let best = Infinity;
  for (let k = 0; k < hull.length; k++) {
    const a = hull[k], b = hull[(k + 1) % hull.length];
    const ex = b[0] - a[0], ey = b[1] - a[1];
    const len = Math.hypot(ex, ey) || 1;
    const d = (ex * (y - a[1]) - ey * (x - a[0])) / len;
    if (d < 0) return d;
    if (d < best) best = d;
  }
  return best;
}
