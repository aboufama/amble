/** Small, allocation-light image processing on binary masks (Uint8Array, 1 = inside). */

const INF = 1e20;

// Ring order N, NE, E, SE, S, SW, W, NW
export const RING_DX = [0, 1, 1, 1, 0, -1, -1, -1];
export const RING_DY = [-1, -1, 0, 1, 1, 1, 0, -1];

/**
 * Downscales an 8-bit channel to a working mask with `pad` empty pixels on every side (borders are
 * background). Max-pooling keeps thin strokes alive when shrinking.
 */
export function downsampleMax(
  alpha: Uint8Array, srcW: number, srcH: number, scale: number, pad: number, threshold: number,
): { m: Uint8Array; w: number; h: number } {
  const iw = Math.max(1, Math.ceil(srcW * scale));
  const ih = Math.max(1, Math.ceil(srcH * scale));
  const w = iw + pad * 2;
  const h = ih + pad * 2;
  const m = new Uint8Array(w * h);
  const inv = 1 / scale;
  for (let y = 0; y < ih; y++) {
    const sy0 = Math.min(srcH - 1, Math.floor(y * inv));
    const sy1 = Math.min(srcH, Math.max(sy0 + 1, Math.floor((y + 1) * inv)));
    for (let x = 0; x < iw; x++) {
      const sx0 = Math.min(srcW - 1, Math.floor(x * inv));
      const sx1 = Math.min(srcW, Math.max(sx0 + 1, Math.floor((x + 1) * inv)));
      let on = 0;
      for (let sy = sy0; sy < sy1 && !on; sy++) {
        let o = sy * srcW + sx0;
        for (let sx = sx0; sx < sx1; sx++, o++) {
          if (alpha[o] > threshold) {
            on = 1;
            break;
          }
        }
      }
      m[(y + pad) * w + x + pad] = on;
    }
  }
  return { m, w, h };
}

/** 1D squared distance transform (Felzenszwalb & Huttenlocher). */
function dt1d(f: Float64Array, n: number, d: Float64Array, v: Int32Array, z: Float64Array): void {
  let k = 0;
  v[0] = 0;
  z[0] = -INF;
  z[1] = INF;
  for (let q = 1; q < n; q++) {
    let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) {
      k--;
      s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = INF;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    const dq = q - v[k];
    d[q] = dq * dq + f[v[k]];
  }
}

/** Exact Euclidean distance from every pixel with m==1 to the nearest pixel with m==0 (0 outside). */
export function edt(m: Uint8Array, w: number, h: number): Float32Array {
  const n = Math.max(w, h);
  const f = new Float64Array(n);
  const d = new Float64Array(n);
  const v = new Int32Array(n);
  const z = new Float64Array(n + 1);
  const g = new Float64Array(w * h);
  for (let i = 0; i < w * h; i++) g[i] = m[i] ? INF : 0;
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) f[y] = g[y * w + x];
    dt1d(f, h, d, v, z);
    for (let y = 0; y < h; y++) g[y * w + x] = d[y];
  }
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) f[x] = g[y * w + x];
    dt1d(f, w, d, v, z);
    for (let x = 0; x < w; x++) out[y * w + x] = Math.sqrt(d[x]);
  }
  return out;
}

export function dilate(m: Uint8Array, w: number, h: number, r: number): Uint8Array {
  const inv = new Uint8Array(w * h);
  for (let i = 0; i < inv.length; i++) inv[i] = m[i] ? 0 : 1;
  const d = edt(inv, w, h);
  const out = new Uint8Array(w * h);
  for (let i = 0; i < out.length; i++) out[i] = m[i] || d[i] <= r ? 1 : 0;
  return out;
}

export function erode(m: Uint8Array, w: number, h: number, r: number): Uint8Array {
  const d = edt(m, w, h);
  const out = new Uint8Array(w * h);
  for (let i = 0; i < out.length; i++) out[i] = d[i] > r ? 1 : 0;
  return out;
}

/** Morphological closing: bridges gaps narrower than about 2r between strokes. */
export function close(m: Uint8Array, w: number, h: number, r: number): Uint8Array {
  const c = erode(dilate(m, w, h, r), w, h, r);
  for (let i = 0; i < c.length; i++) c[i] |= m[i];
  return c;
}

/** Morphological opening: keeps only regions wider than about 2r (removes strokes and specks). */
export function open(m: Uint8Array, w: number, h: number, r: number): Uint8Array {
  const o = dilate(erode(m, w, h, r), w, h, r);
  for (let i = 0; i < o.length; i++) o[i] &= m[i];
  return o;
}

/** Separable square max filter (binary dilation by a (2r+1)² box). */
export function boxDilate(m: Uint8Array, w: number, h: number, r: number): Uint8Array {
  if (r <= 0) return m.slice();
  const tmp = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    let run = -1e9;
    for (let x = 0; x < w; x++) {
      if (m[y * w + x]) run = x;
      if (x - run <= r) tmp[y * w + x] = 1;
    }
    run = 1e9;
    for (let x = w - 1; x >= 0; x--) {
      if (m[y * w + x]) run = x;
      if (run - x <= r) tmp[y * w + x] = 1;
    }
  }
  const out = new Uint8Array(w * h);
  for (let x = 0; x < w; x++) {
    let run = -1e9;
    for (let y = 0; y < h; y++) {
      if (tmp[y * w + x]) run = y;
      if (y - run <= r) out[y * w + x] = 1;
    }
    run = 1e9;
    for (let y = h - 1; y >= 0; y--) {
      if (tmp[y * w + x]) run = y;
      if (run - y <= r) out[y * w + x] = 1;
    }
  }
  return out;
}

/** 8-connected components. Returns labels (0 = background, 1..n) and sizes (index = label). */
export function components(m: Uint8Array, w: number, h: number): { labels: Int32Array; sizes: number[] } {
  const labels = new Int32Array(w * h);
  const sizes = [0];
  const stack: number[] = [];
  let next = 0;
  for (let i = 0; i < w * h; i++) {
    if (!m[i] || labels[i]) continue;
    next++;
    let size = 0;
    labels[i] = next;
    stack.push(i);
    while (stack.length) {
      const p = stack.pop()!;
      size++;
      const px = p % w;
      const py = (p - px) / w;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = py + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = px + dx;
          if (xx < 0 || xx >= w) continue;
          const q = yy * w + xx;
          if (m[q] && !labels[q]) {
            labels[q] = next;
            stack.push(q);
          }
        }
      }
    }
    sizes.push(size);
  }
  return { labels, sizes };
}

/** Fill enclosed holes (background not 4-connected to the border). Outline drawings become solid. */
export function fillHoles(m: Uint8Array, w: number, h: number): Uint8Array {
  const outside = new Uint8Array(w * h);
  const stack: number[] = [];
  const push = (i: number) => {
    if (!m[i] && !outside[i]) {
      outside[i] = 1;
      stack.push(i);
    }
  };
  for (let x = 0; x < w; x++) {
    push(x);
    push((h - 1) * w + x);
  }
  for (let y = 0; y < h; y++) {
    push(y * w);
    push(y * w + w - 1);
  }
  while (stack.length) {
    const p = stack.pop()!;
    const x = p % w;
    if (x > 0) push(p - 1);
    if (x < w - 1) push(p + 1);
    if (p >= w) push(p - w);
    if (p < w * (h - 1)) push(p + w);
  }
  const out = new Uint8Array(w * h);
  for (let i = 0; i < out.length; i++) out[i] = outside[i] ? 0 : 1;
  return out;
}

/** Draw a disc-brush line into a mask (used to bridge nearly-touching pieces). */
export function stampLine(m: Uint8Array, w: number, h: number, x0: number, y0: number, x1: number, y1: number, r: number): void {
  const steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0)));
  const rr = r * r;
  for (let s = 0; s <= steps; s++) {
    const cx = x0 + ((x1 - x0) * s) / steps;
    const cy = y0 + ((y1 - y0) * s) / steps;
    for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
      if (y < 0 || y >= h) continue;
      for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
        if (x < 0 || x >= w) continue;
        if ((x - cx) * (x - cx) + (y - cy) * (y - cy) <= rr) m[y * w + x] = 1;
      }
    }
  }
}

/** Zhang-Suen thinning (topology preserving for simply connected shapes). */
export function zhangSuen(mask: Uint8Array, w: number, h: number): Uint8Array {
  const img = mask.slice();
  const clear: number[] = [];
  let changed = true;
  while (changed) {
    changed = false;
    for (let pass = 0; pass < 2; pass++) {
      clear.length = 0;
      for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
          const i = y * w + x;
          if (!img[i]) continue;
          const p2 = img[i - w], p3 = img[i - w + 1], p4 = img[i + 1], p5 = img[i + w + 1];
          const p6 = img[i + w], p7 = img[i + w - 1], p8 = img[i - 1], p9 = img[i - w - 1];
          const b = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9;
          if (b < 2 || b > 6) continue;
          const a =
            (!p2 && p3 ? 1 : 0) + (!p3 && p4 ? 1 : 0) + (!p4 && p5 ? 1 : 0) + (!p5 && p6 ? 1 : 0) +
            (!p6 && p7 ? 1 : 0) + (!p7 && p8 ? 1 : 0) + (!p8 && p9 ? 1 : 0) + (!p9 && p2 ? 1 : 0);
          if (a !== 1) continue;
          if (pass === 0) {
            if (p2 && p4 && p6) continue;
            if (p4 && p6 && p8) continue;
          } else {
            if (p2 && p4 && p8) continue;
            if (p2 && p6 && p8) continue;
          }
          clear.push(i);
        }
      }
      for (const i of clear) img[i] = 0;
      if (clear.length) changed = true;
    }
  }
  return img;
}

/** Number of 8-connected groups among the set neighbours of pixel i (ring adjacency). */
function ringGroups(s: Uint8Array, w: number, i: number): { count: number; groups: number } {
  const on: boolean[] = [];
  let count = 0;
  for (let k = 0; k < 8; k++) {
    const v = s[i + RING_DY[k] * w + RING_DX[k]] === 1;
    on.push(v);
    if (v) count++;
  }
  if (count === 0) return { count, groups: 0 };
  const parent = [0, 1, 2, 3, 4, 5, 6, 7];
  const find = (a: number): number => (parent[a] === a ? a : (parent[a] = find(parent[a])));
  const unite = (a: number, b: number) => {
    parent[find(a)] = find(b);
  };
  for (let k = 0; k < 8; k++) {
    if (!on[k]) continue;
    const k1 = (k + 1) % 8;
    if (on[k1]) unite(k, k1);
    // 4-neighbours two apart in the ring are diagonal-adjacent (N-E, E-S, S-W, W-N)
    if (k % 2 === 0) {
      const k2 = (k + 2) % 8;
      if (on[k2]) unite(k, k2);
    }
  }
  const roots = new Set<number>();
  for (let k = 0; k < 8; k++) if (on[k]) roots.add(find(k));
  return { count, groups: roots.size };
}

/** Remove staircase corners so every non-junction skeleton pixel has exactly 2 neighbours. */
export function makeThin(s: Uint8Array, w: number, h: number): void {
  let changed = true;
  while (changed) {
    changed = false;
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        if (!s[i]) continue;
        const g = ringGroups(s, w, i);
        if (g.count >= 2 && g.groups === 1) {
          s[i] = 0;
          changed = true;
        }
      }
    }
  }
}

export function neighbourCount(s: Uint8Array, w: number, i: number): number {
  let c = 0;
  for (let k = 0; k < 8; k++) if (s[i + RING_DY[k] * w + RING_DX[k]]) c++;
  return c;
}

/** Binary min-heap of (key, value) with typed arrays. Keys are Float64 (see `geodesic`). */
export class MinHeap {
  private keys: Float64Array;
  private vals: Int32Array;
  size = 0;
  /** The key of the value returned by the last `pop()`. */
  lastKey = 0;

  constructor(cap: number) {
    this.keys = new Float64Array(cap);
    this.vals = new Int32Array(cap);
  }

  push(key: number, val: number): void {
    if (this.size >= this.keys.length) {
      const k = new Float64Array(this.keys.length * 2);
      k.set(this.keys);
      const v = new Int32Array(this.vals.length * 2);
      v.set(this.vals);
      this.keys = k;
      this.vals = v;
    }
    let i = this.size++;
    const keys = this.keys;
    const vals = this.vals;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (keys[p] <= key) break;
      keys[i] = keys[p];
      vals[i] = vals[p];
      i = p;
    }
    keys[i] = key;
    vals[i] = val;
  }

  pop(): number {
    const keys = this.keys;
    const vals = this.vals;
    const topVal = vals[0];
    this.lastKey = keys[0];
    const n = --this.size;
    if (n > 0) {
      const key = keys[n];
      const val = vals[n];
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && keys[c + 1] < keys[c]) c++;
        if (keys[c] >= key) break;
        keys[i] = keys[c];
        vals[i] = vals[c];
        i = c;
      }
      keys[i] = key;
      vals[i] = val;
    }
    return topVal;
  }
}

export interface GeodesicOptions {
  maxDist?: number;
  /** Per seed: start at this distance instead of 0 (e.g. -radius: "the medial disc that covers me most"). */
  offsets?: number[];
  /** Per seed: the label written to `owner` for every pixel that seed reaches first. */
  seedLabels?: number[];
  owner?: Int32Array;
  /** Pixels whose steps cost `slowCost` times more (ink lines, so borders snap to them). */
  slow?: Uint8Array;
  slowCost?: number;
}

/**
 * Geodesic (inside-the-shape) distance from seed pixels, 8-connected Dijkstra; Infinity outside.
 *
 * Distances are Float64 throughout and a pixel is relaxed only when the new distance is smaller by
 * more than 1e-9. Storing them in Float32 while the heap keys are Float64 makes equal-length paths
 * "improve" each other forever: a cascade of 1-ulp re-pushes that once took an ownership pass from
 * 13 ms to 1.1 s (or, with a strict test, silently skipped pixels).
 */
export function geodesic(m: Uint8Array, w: number, h: number, seeds: number[], opts: GeodesicOptions = {}): Float64Array {
  const dist = new Float64Array(w * h).fill(Infinity);
  const maxDist = opts.maxDist ?? Infinity;
  const { owner, slow } = opts;
  const slowCost = opts.slowCost ?? 1;
  const heap = new MinHeap(1024);
  for (let k = 0; k < seeds.length; k++) {
    const s = seeds[k];
    if (!m[s]) continue;
    const d0 = opts.offsets ? opts.offsets[k] : 0;
    if (d0 < dist[s]) {
      dist[s] = d0;
      if (owner && opts.seedLabels) owner[s] = opts.seedLabels[k];
      heap.push(d0, s);
    }
  }
  while (heap.size) {
    const p = heap.pop();
    const dp = heap.lastKey;
    if (dp > dist[p] || dp > maxDist) continue;
    const x = p % w;
    const y = (p - x) / w;
    for (let k = 0; k < 8; k++) {
      const xx = x + RING_DX[k];
      const yy = y + RING_DY[k];
      if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
      const q = yy * w + xx;
      if (!m[q]) continue;
      const nd = dp + (k % 2 === 0 ? 1 : Math.SQRT2) * (slow && slow[q] ? slowCost : 1);
      if (nd < dist[q] - 1e-9) {
        dist[q] = nd;
        if (owner) owner[q] = owner[p];
        heap.push(nd, q);
      }
    }
  }
  return dist;
}

/** Pixels of a segment, clipped to the mask. */
export function segmentPixels(m: Uint8Array, w: number, h: number, x0: number, y0: number, x1: number, y1: number): number[] {
  const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 2));
  const out: number[] = [];
  let last = -1;
  for (let s = 0; s <= n; s++) {
    const x = Math.round(x0 + ((x1 - x0) * s) / n);
    const y = Math.round(y0 + ((y1 - y0) * s) / n);
    if (x < 0 || y < 0 || x >= w || y >= h) continue;
    const i = y * w + x;
    if (i !== last && m[i]) out.push(i);
    last = i;
  }
  return out;
}

/** Nearest pixel with m==1 to (x,y), searching rings up to `maxR`. -1 if none. */
export function nearestOn(
  m: Uint8Array, w: number, h: number, x: number, y: number, maxR: number, accept?: (i: number) => boolean,
): number {
  const cx = Math.round(x);
  const cy = Math.round(y);
  let best = -1;
  let bestD = Infinity;
  for (let r = 0; r <= maxR; r++) {
    for (let yy = cy - r; yy <= cy + r; yy++) {
      if (yy < 0 || yy >= h) continue;
      const edge = yy === cy - r || yy === cy + r;
      for (let xx = cx - r; xx <= cx + r; xx += edge ? 1 : 2 * r) {
        if (xx < 0 || xx >= w) {
          if (r === 0) break;
          continue;
        }
        const i = yy * w + xx;
        if (m[i] && (!accept || accept(i))) {
          const d = (xx - x) * (xx - x) + (yy - y) * (yy - y);
          if (d < bestD) {
            bestD = d;
            best = i;
          }
        }
        if (r === 0) break;
      }
    }
    if (best >= 0 && r >= Math.ceil(Math.sqrt(bestD))) break;
  }
  return best;
}
