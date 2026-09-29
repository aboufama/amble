/** A small software rasterizer for skinned rig meshes, so Node tools can draw frames without a canvas. */
import type { BoundRig, Pixels } from '../../../src/rig/types';

/**
 * Draws triangles in index order (back to front) with bilinear atlas sampling. `verts` are
 * anchor-relative art px; (ox, oy) is where the anchor goes, k the scale.
 */
export function rasterMesh(dst: Pixels, bound: BoundRig, verts: Float32Array, ox: number, oy: number, k: number, opts: { alpha?: number; tint?: [number, number, number] | null; wire?: boolean } = {}): void {
  const { uvs, indices, atlas } = bound;
  const AW = atlas.width, AH = atlas.height, A = atlas.data;
  const D = dst.data, W = dst.width, H = dst.height;
  const alpha = opts.alpha ?? 1;
  const sample = (u: number, v: number, out: number[]) => {
    const x = u * AW - 0.5, y = v * AH - 0.5;
    const x0 = Math.max(0, Math.min(AW - 1, Math.floor(x))), y0 = Math.max(0, Math.min(AH - 1, Math.floor(y)));
    const x1 = Math.min(AW - 1, x0 + 1), y1 = Math.min(AH - 1, y0 + 1);
    const fx = Math.max(0, Math.min(1, x - x0)), fy = Math.max(0, Math.min(1, y - y0));
    const o00 = (y0 * AW + x0) * 4, o10 = (y0 * AW + x1) * 4, o01 = (y1 * AW + x0) * 4, o11 = (y1 * AW + x1) * 4;
    // premultiplied bilinear so transparent neighbours don't darken edges
    let a = 0, r = 0, g = 0, b = 0;
    const acc = (o: number, w: number) => {
      const aw = (A[o + 3] / 255) * w;
      a += aw;
      r += A[o] * aw;
      g += A[o + 1] * aw;
      b += A[o + 2] * aw;
    };
    acc(o00, (1 - fx) * (1 - fy));
    acc(o10, fx * (1 - fy));
    acc(o01, (1 - fx) * fy);
    acc(o11, fx * fy);
    out[3] = a;
    if (a > 1e-6) {
      out[0] = r / a;
      out[1] = g / a;
      out[2] = b / a;
    }
  };
  const px = [0, 0, 0, 0];
  for (let t = 0; t < indices.length; t += 3) {
    const i0 = indices[t], i1 = indices[t + 1], i2 = indices[t + 2];
    const x0 = ox + verts[2 * i0] * k, y0 = oy + verts[2 * i0 + 1] * k;
    const x1 = ox + verts[2 * i1] * k, y1 = oy + verts[2 * i1 + 1] * k;
    const x2 = ox + verts[2 * i2] * k, y2 = oy + verts[2 * i2 + 1] * k;
    const den = (y1 - y2) * (x0 - x2) + (x2 - x1) * (y0 - y2);
    if (Math.abs(den) < 1e-9) continue;
    const minX = Math.max(0, Math.floor(Math.min(x0, x1, x2))), maxX = Math.min(W - 1, Math.ceil(Math.max(x0, x1, x2)));
    const minY = Math.max(0, Math.floor(Math.min(y0, y1, y2))), maxY = Math.min(H - 1, Math.ceil(Math.max(y0, y1, y2)));
    for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
      const cx = x + 0.5, cy = y + 0.5;
      const l0 = ((y1 - y2) * (cx - x2) + (x2 - x1) * (cy - y2)) / den;
      const l1 = ((y2 - y0) * (cx - x2) + (x0 - x2) * (cy - y2)) / den;
      const l2 = 1 - l0 - l1;
      if (l0 < -1e-4 || l1 < -1e-4 || l2 < -1e-4) continue;
      const u = l0 * uvs[2 * i0] + l1 * uvs[2 * i1] + l2 * uvs[2 * i2];
      const v = l0 * uvs[2 * i0 + 1] + l1 * uvs[2 * i1 + 1] + l2 * uvs[2 * i2 + 1];
      sample(u, v, px);
      const a = px[3] * alpha;
      if (a <= 0.002) continue;
      const o = (y * W + x) * 4;
      const tint = opts.tint;
      for (let c = 0; c < 3; c++) {
        const src = tint ? tint[c] : px[c];
        D[o + c] = src * a + D[o + c] * (1 - a);
      }
      D[o + 3] = Math.max(D[o + 3], Math.round(a * 255));
    }
    if (opts.wire) {
      line(dst, x0, y0, x1, y1);
      line(dst, x1, y1, x2, y2);
      line(dst, x2, y2, x0, y0);
    }
  }
}

function line(dst: Pixels, xa: number, ya: number, xb: number, yb: number): void {
  const n = Math.ceil(Math.hypot(xb - xa, yb - ya));
  for (let i = 0; i <= n; i++) {
    const x = Math.round(xa + ((xb - xa) * i) / Math.max(1, n)), y = Math.round(ya + ((yb - ya) * i) / Math.max(1, n));
    if (x < 0 || y < 0 || x >= dst.width || y >= dst.height) continue;
    const o = (y * dst.width + x) * 4;
    dst.data[o] = 60;
    dst.data[o + 1] = 90;
    dst.data[o + 2] = 220;
  }
}
