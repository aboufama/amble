/**
 * Where a fill may split one enclosed region into two (§7.4 step 4, refined by the art department's
 * finding): only at a REAL GAP, an opening with a line end at it (a face outline that was not closed, a
 * divider that stops short of the edge). A narrow neck of one closed shape (a gear's body between its bolt
 * holes and the rim, a rocket beside its window, lantern glass beside its bars) has no line end, so the
 * whole shape fills from one tap.
 *
 * `splitAtGaps` partitions the old region among its cores at a larger gap G (every pixel joins its nearest
 * core, so neighbouring cells meet along the midline of each opening), keeps cells joined across any
 * opening that is not a real gap, and cuts off the sizeable parts beyond real gaps. `hasLineEnd` is the
 * test for one opening. Pure TypeScript on typed arrays (fill worker, main thread or Node).
 */
import type { Analysis } from './fill';

/** Distances in an Analysis are in thirds of a pixel (chamfer 3-4). */
const UNIT = 3;

export interface Flood {
  area: number;
  maxDist: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** A tiny union-find over core ids. */
function makeSets(n: number): { find(i: number): number; union(i: number, j: number): void } {
  const parent = new Int32Array(n);
  for (let i = 0; i < n; i++) parent[i] = i;
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  return {
    find,
    union(i, j) {
      const a = find(i);
      const b = find(j);
      if (a !== b) parent[Math.max(a, b)] = Math.min(a, b);
    },
  };
}

/** The 4-neighbours of pixel p (-1 off the board). */
function neighbours4(p: number, W: number, H: number): [number, number, number, number] {
  const x = p % W;
  const y = (p / W) | 0;
  return [x > 0 ? p - 1 : -1, x < W - 1 ? p + 1 : -1, y > 0 ? p - W : -1, y < H - 1 ? p + W : -1];
}

/**
 * Splits the old region (`region` = 1, inside box `reg`) at gap G around `seed`. Returns the seed's side
 * (a region mask and its flood stats) when a sizeable part lies beyond real gaps, else null.
 */
export function splitAtGaps(a: Analysis, region: Uint8Array, reg: Flood, seed: number, G: number): { lab: Uint8Array; flood: Flood } | null {
  const { W, H, dist } = a;
  const thr = UNIT * G;
  const bx0 = reg.x0;
  const by0 = reg.y0;
  const bw = reg.x1 - reg.x0 + 1;
  const bh = reg.y1 - reg.y0 + 1;
  const cell = new Int32Array(bw * bh);
  const at = (i: number): number => (((i / W) | 0) - by0) * bw + (i % W) - bx0;
  const queue = new Int32Array(bw * bh);
  // 1. The cores at G: 4-connected region pixels farther than G from any wall.
  const cores: Array<{ area: number; maxDist: number }> = [{ area: 0, maxDist: 0 }];
  let qn = 0;
  for (let y = reg.y0; y <= reg.y1; y++)
    for (let x = reg.x0; x <= reg.x1; x++) {
      const i = y * W + x;
      if (region[i] !== 1 || dist[i] <= thr || cell[at(i)]) continue;
      const id = cores.length;
      const info = { area: 0, maxDist: 0 };
      cores.push(info);
      let head = qn;
      queue[qn++] = i;
      cell[at(i)] = id;
      while (head < qn) {
        const p = queue[head++];
        info.area++;
        if (dist[p] > info.maxDist) info.maxDist = dist[p];
        for (const q of neighbours4(p, W, H)) {
          if (q < 0 || region[q] !== 1 || dist[q] <= thr) continue;
          const k = at(q);
          if (cell[k]) continue;
          cell[k] = id;
          queue[qn++] = q;
        }
      }
    }
  const mine = cell[at(seed)];
  if (!mine || cores.length < 3) return null;
  // 2. Every other region pixel joins its nearest core (breadth-first from all the cores at once).
  let head = 0;
  while (head < qn) {
    const p = queue[head++];
    const id = cell[at(p)];
    for (const q of neighbours4(p, W, H)) {
      if (q < 0 || region[q] !== 1) continue;
      const k = at(q);
      if (cell[k]) continue;
      cell[k] = id;
      queue[qn++] = q;
    }
  }
  // 3. Where two cells touch: their border pixels, per pair of cells.
  const n = cores.length;
  const borders = new Map<number, number[]>();
  for (let y = reg.y0; y <= reg.y1; y++)
    for (let x = reg.x0; x <= reg.x1; x++) {
      const i = y * W + x;
      if (region[i] !== 1) continue;
      const c = cell[at(i)];
      for (const q of [x < reg.x1 ? i + 1 : -1, y < reg.y1 ? i + W : -1]) {
        if (q < 0 || region[q] !== 1) continue;
        const d = cell[at(q)];
        if (!d || d === c) continue;
        const key = Math.min(c, d) * n + Math.max(c, d);
        let list = borders.get(key);
        if (!list) borders.set(key, (list = []));
        list.push(i, q);
      }
    }
  // 4. Cells stay together across any opening that is not a real gap.
  const sets = makeSets(n);
  for (const [key, list] of borders) if (!openingsAreGaps(a, list, G)) sets.union(Math.floor(key / n), key % n);
  const keep = sets.find(mine);
  // Tiny pockets beyond a gap stay with the fill; only a sizeable part is cut off.
  const cut = new Set<number>();
  for (let id = 1; id < n; id++) {
    const root = sets.find(id);
    if (root !== keep && cores[id].area >= 32 && cores[id].maxDist >= thr + 2 * UNIT) cut.add(root);
  }
  if (!cut.size) return null;
  const lab = new Uint8Array(W * H);
  const f: Flood = { area: 0, maxDist: 0, x0: W, y0: H, x1: -1, y1: -1 };
  for (let y = reg.y0; y <= reg.y1; y++)
    for (let x = reg.x0; x <= reg.x1; x++) {
      const i = y * W + x;
      if (region[i] !== 1 || cut.has(sets.find(cell[at(i)]))) continue;
      lab[i] = 1;
      f.area++;
      if (dist[i] > f.maxDist) f.maxDist = dist[i];
      if (x < f.x0) f.x0 = x;
      if (x > f.x1) f.x1 = x;
      if (y < f.y0) f.y0 = y;
      if (y > f.y1) f.y1 = y;
    }
  return { lab, flood: f };
}

/**
 * Whether every opening along a border (pairs of pixels across two cells, flattened) is a real gap. The
 * border pixels are grouped into openings (8-connected); each is tested at its widest point.
 */
function openingsAreGaps(a: Analysis, list: number[], G: number): boolean {
  const { W, dist } = a;
  const pixels = new Set(list);
  const seen = new Set<number>();
  for (const start of pixels) {
    if (seen.has(start)) continue;
    let widest = start;
    const stack = [start];
    seen.add(start);
    while (stack.length) {
      const p = stack.pop()!;
      if (dist[p] > dist[widest]) widest = p;
      const px = p % W;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          if ((!dx && !dy) || (px === 0 && dx < 0) || (px === W - 1 && dx > 0)) continue;
          const q = p + dy * W + dx;
          if (!pixels.has(q) || seen.has(q)) continue;
          seen.add(q);
          stack.push(q);
        }
    }
    if (!hasLineEnd(a, widest, G)) return false;
  }
  return true;
}

/**
 * Whether a line stops within about G + 2 px of the opening at pixel `p`. Looks at the wall pieces inside a
 * disc around the opening that is wide enough to cross the thickest line there: a line passing by crosses
 * the disc's rim an even number of times, a line that stops inside crosses it an odd number of times. A
 * piece entirely inside the disc counts when it is open (a dash, a hook) and not when it is a small closed
 * ring (a bolt hole). Pieces that touch the page edge run off the page and never count.
 */
export function hasLineEnd(a: Analysis, p: number, G: number): boolean {
  const { W, H, wall, dist } = a;
  const px = p % W;
  const py = (p / W) | 0;
  const near = dist[p] / UNIT + G + 2;
  const R = Math.ceil(near + wallThickness(a, px, py, near) + 1);
  const x0 = Math.max(0, px - R);
  const x1 = Math.min(W - 1, px + R);
  const y0 = Math.max(0, py - R);
  const y1 = Math.min(H - 1, py + R);
  const ww = x1 - x0 + 1;
  const hh = y1 - y0 + 1;
  const r2 = (R + 0.5) * (R + 0.5);
  const inDisc = (x: number, y: number): boolean => (x - px) * (x - px) + (y - py) * (y - py) <= r2;
  // The wall pieces inside the disc (8-connected).
  const comp = new Int32Array(ww * hh);
  const info: Array<{ area: number; near: boolean; edge: boolean; closed: boolean }> = [{ area: 0, near: false, edge: false, closed: false }];
  const stack: number[] = [];
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      const k = (y - y0) * ww + (x - x0);
      if (comp[k] || !wall[y * W + x] || !inDisc(x, y)) continue;
      const id = info.length;
      const it = { area: 0, near: false, edge: false, closed: false };
      info.push(it);
      comp[k] = id;
      stack.push(k);
      while (stack.length) {
        const q = stack.pop()!;
        const qx = (q % ww) + x0;
        const qy = ((q / ww) | 0) + y0;
        it.area++;
        if ((qx - px) * (qx - px) + (qy - py) * (qy - py) <= near * near) it.near = true;
        if (qx === 0 || qy === 0 || qx === W - 1 || qy === H - 1) it.edge = true;
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const nx = qx + dx;
            const ny = qy + dy;
            if ((!dx && !dy) || nx < x0 || ny < y0 || nx > x1 || ny > y1) continue;
            const nk = (ny - y0) * ww + (nx - x0);
            if (comp[nk] || !wall[ny * W + nx] || !inDisc(nx, ny)) continue;
            comp[nk] = id;
            stack.push(nk);
          }
      }
    }
  if (info.length === 1) return false;
  // Walk the rim: how many separate times each piece crosses it.
  const steps = Math.max(32, Math.ceil(4 * Math.PI * R));
  const rim: number[] = [];
  const rimPixels: number[] = [];
  for (let k = 0; k < steps; k++) {
    const t = (2 * Math.PI * k) / steps;
    const x = Math.round(px + R * Math.cos(t));
    const y = Math.round(py + R * Math.sin(t));
    if (x < x0 || y < y0 || x > x1 || y > y1) {
      rim.push(0);
      continue;
    }
    const q = (y - y0) * ww + (x - x0);
    rim.push(comp[q]);
    if (!comp[q]) rimPixels.push(q);
  }
  const runs = countRuns(rim, info.length, (2 * Math.PI * R) / steps);
  // Open space the rim reaches; wall pieces around open space it cannot reach are closed rings.
  const reached = new Uint8Array(ww * hh);
  for (const q of rimPixels) reached[q] = 1;
  const open = rimPixels.slice();
  while (open.length) {
    const q = open.pop()!;
    const qx = (q % ww) + x0;
    const qy = ((q / ww) | 0) + y0;
    for (const [nx, ny] of [
      [qx - 1, qy],
      [qx + 1, qy],
      [qx, qy - 1],
      [qx, qy + 1],
    ]) {
      if (nx < x0 || ny < y0 || nx > x1 || ny > y1 || !inDisc(nx, ny)) continue;
      const nk = (ny - y0) * ww + (nx - x0);
      if (reached[nk] || comp[nk]) continue;
      reached[nk] = 1;
      open.push(nk);
    }
  }
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      const k = (y - y0) * ww + (x - x0);
      if (comp[k] || reached[k] || !inDisc(x, y)) continue;
      for (const nk of [x > x0 ? k - 1 : -1, x < x1 ? k + 1 : -1, y > y0 ? k - ww : -1, y < y1 ? k + ww : -1]) if (nk >= 0 && comp[nk]) info[comp[nk]].closed = true;
    }
  for (let id = 1; id < info.length; id++) {
    const it = info[id];
    if (!it.near || it.edge || it.area < 6) continue;
    if (runs[id] % 2 === 1) return true;
    if (runs[id] === 0 && !it.closed) return true;
  }
  return false;
}

/**
 * How many separate times each label crosses a closed rim (labels in order around it, 0 = open). A rim
 * that grazes a curved line flickers in and out of it: runs of one label split by at most 3 px of open rim
 * are one crossing, and runs shorter than 1.5 px are grazes, not crossings. A label covering the whole rim
 * surrounds the disc and crosses it zero times.
 */
function countRuns(rim: number[], labels: number, step: number): Int32Array {
  const out = new Int32Array(labels);
  const n = rim.length;
  const zero = rim.indexOf(0);
  if (zero < 0) return out;
  const minRun = Math.max(1, Math.ceil(1.5 / step));
  const maxGap = Math.max(1, Math.floor(3 / step));
  // Runs in order, starting right after an open sample: [label, first, length].
  const runs: Array<[number, number, number]> = [];
  for (let k = 1; k <= n; k++) {
    const i = (zero + k) % n;
    const l = rim[i];
    if (!l) continue;
    const last = runs[runs.length - 1];
    if (last && last[0] === l && last[1] + last[2] === k) last[2]++;
    else runs.push([l, k, 1]);
  }
  // Join runs of one label separated only by a little open rim (across the wrap too).
  const joined: Array<[number, number, number]> = [];
  for (const r of runs) {
    const prev = joined[joined.length - 1];
    if (prev && prev[0] === r[0] && r[1] - (prev[1] + prev[2]) <= maxGap) prev[2] = r[1] + r[2] - prev[1];
    else joined.push([...r]);
  }
  if (joined.length > 1) {
    const first = joined[0];
    const last = joined[joined.length - 1];
    if (first[0] === last[0] && n - (last[1] + last[2]) + first[1] <= maxGap) {
      last[2] += first[2];
      joined.shift();
    }
  }
  for (const [l, , len] of joined) if (len >= minRun) out[l]++;
  return out;
}

/** How thick the lines near (px, py) are, px: twice the deepest wall pixel's distance to open space. */
function wallThickness(a: Analysis, px: number, py: number, near: number): number {
  const { W, H, wall } = a;
  const M = 40;
  const r = Math.ceil(near);
  const x0 = Math.max(0, px - r - M);
  const x1 = Math.min(W - 1, px + r + M);
  const y0 = Math.max(0, py - r - M);
  const y1 = Math.min(H - 1, py + r + M);
  const ww = x1 - x0 + 1;
  const hh = y1 - y0 + 1;
  // Chamfer (3-4) distance inside the walls to the nearest open pixel.
  const d = new Uint16Array(ww * hh);
  for (let y = 0; y < hh; y++) for (let x = 0; x < ww; x++) d[y * ww + x] = wall[(y + y0) * W + x + x0] ? 60000 : 0;
  for (let y = 0; y < hh; y++)
    for (let x = 0; x < ww; x++) {
      const i = y * ww + x;
      let v = d[i];
      if (!v) continue;
      if (x > 0 && d[i - 1] + 3 < v) v = d[i - 1] + 3;
      if (y > 0) {
        if (d[i - ww] + 3 < v) v = d[i - ww] + 3;
        if (x > 0 && d[i - ww - 1] + 4 < v) v = d[i - ww - 1] + 4;
        if (x < ww - 1 && d[i - ww + 1] + 4 < v) v = d[i - ww + 1] + 4;
      }
      d[i] = v;
    }
  let deepest = 0;
  for (let y = hh - 1; y >= 0; y--)
    for (let x = ww - 1; x >= 0; x--) {
      const i = y * ww + x;
      let v = d[i];
      if (!v) continue;
      if (x < ww - 1 && d[i + 1] + 3 < v) v = d[i + 1] + 3;
      if (y < hh - 1) {
        if (d[i + ww] + 3 < v) v = d[i + ww] + 3;
        if (x < ww - 1 && d[i + ww + 1] + 4 < v) v = d[i + ww + 1] + 4;
        if (x > 0 && d[i + ww - 1] + 4 < v) v = d[i + ww - 1] + 4;
      }
      d[i] = v;
      const gx = x + x0;
      const gy = y + y0;
      if (v < 60000 && v > deepest && (gx - px) * (gx - px) + (gy - py) * (gy - py) <= near * near) deepest = v;
    }
  return Math.min(2 * M, (2 * deepest) / UNIT + 1);
}
