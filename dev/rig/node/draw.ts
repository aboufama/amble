/** Pixel-sheet helpers for Node dev tools: blits, checkerboards, bone overlays. */
import { Painter, type RGB } from '../../../src/rig/samples/raster';
import type { Pixels, RigData } from '../../../src/rig/types';

export function blank(w: number, h: number, bg: RGB = [250, 250, 248]): Pixels {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    data[i * 4] = bg[0];
    data[i * 4 + 1] = bg[1];
    data[i * 4 + 2] = bg[2];
    data[i * 4 + 3] = 255;
  }
  return { data, width: w, height: h };
}

export function checker(dst: Pixels, x0: number, y0: number, w: number, h: number): void {
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const X = x0 + x, Y = y0 + y;
    if (X < 0 || Y < 0 || X >= dst.width || Y >= dst.height) continue;
    const v = ((x >> 3) + (y >> 3)) % 2 ? 236 : 255;
    const o = (Y * dst.width + X) * 4;
    dst.data[o] = dst.data[o + 1] = dst.data[o + 2] = v;
    dst.data[o + 3] = 255;
  }
}

/** Draws src scaled by k (nearest) at (x0, y0), alpha-blended. */
export function blit(dst: Pixels, src: Pixels, x0: number, y0: number, k: number, alpha = 1): void {
  const W = Math.round(src.width * k), H = Math.round(src.height * k);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const X = x0 + x, Y = y0 + y;
    if (X < 0 || Y < 0 || X >= dst.width || Y >= dst.height) continue;
    const sx = Math.min(src.width - 1, Math.floor(x / k)), sy = Math.min(src.height - 1, Math.floor(y / k));
    const so = (sy * src.width + sx) * 4, o = (Y * dst.width + X) * 4;
    const a = (src.data[so + 3] / 255) * alpha;
    if (a <= 0) continue;
    for (let c = 0; c < 3; c++) dst.data[o + c] = src.data[so + c] * a + dst.data[o + c] * (1 - a);
  }
}

export function painterOf(p: Pixels): Painter {
  const pt = new Painter(p.width, p.height);
  for (let i = 0; i < p.width * p.height; i++) {
    const a = p.data[i * 4 + 3] / 255;
    pt.buf[i * 4] = p.data[i * 4] * a;
    pt.buf[i * 4 + 1] = p.data[i * 4 + 1] * a;
    pt.buf[i * 4 + 2] = p.data[i * 4 + 2] * a;
    pt.buf[i * 4 + 3] = a;
  }
  return pt;
}

const SIDE_COLOURS: Record<string, RGB> = { L: [70, 140, 235], R: [240, 130, 60], C: [40, 170, 110], X: [190, 80, 200] };

export function sideOf(role: string, name: string): string {
  if (role === 'extra') return /^wheel/.test(name) ? 'C' : 'X';
  if (/L\d?$/.test(role) && role !== 'tail1') return /^(arm|leg|wing)/.test(role) ? 'L' : 'C';
  if (/R\d?$/.test(role)) return /^(arm|leg|wing)/.test(role) ? 'R' : 'C';
  return 'C';
}

export function disc(p: Painter, x: number, y: number, r: number, c: RGB, alpha = 1): void {
  const pts: [number, number][] = [];
  for (let i = 0; i < 20; i++) pts.push([x + Math.cos((i / 20) * Math.PI * 2) * r, y + Math.sin((i / 20) * Math.PI * 2) * r]);
  p.fill(pts, c, alpha);
}

/** Bones as tapered shapes (left side cool, right side warm), joints as white dots, anchor pink. */
export function drawRigOverlay(p: Painter, rig: RigData, ox: number, oy: number, k: number): void {
  for (const b of rig.bones) {
    const x1 = ox + b.x * k, y1 = oy + b.y * k, x2 = ox + b.x2 * k, y2 = oy + b.y2 * k;
    const L = Math.hypot(x2 - x1, y2 - y1) || 1;
    const ux = (x2 - x1) / L, uy = (y2 - y1) / L;
    const wdt = Math.min(6, L * 0.2);
    const bx = x1 + ux * L * 0.18, by = y1 + uy * L * 0.18;
    const shape: [number, number][] = [[x1, y1], [bx - uy * wdt, by + ux * wdt], [x2, y2], [bx + uy * wdt, by - ux * wdt]];
    const col = SIDE_COLOURS[sideOf(b.role, b.name)];
    p.fill(shape, col, 0.85);
    p.stroke(shape, true, 1.2, [255, 255, 255], 0.9);
    if (b.dynamic) p.stroke([[x1, y1], [x2, y2]], false, 1, [255, 255, 255], 0.9);
  }
  for (const b of rig.bones) {
    for (const [x, y] of [[b.x, b.y], [b.x2, b.y2]]) {
      disc(p, ox + x * k, oy + y * k, 3.6, [25, 25, 25]);
      disc(p, ox + x * k, oy + y * k, 2.4, [255, 255, 255]);
    }
  }
  const [ax, ay] = rig.anchor;
  p.fill([[ox + ax * k - 6, oy + ay * k - 1.5], [ox + ax * k + 6, oy + ay * k - 1.5], [ox + ax * k + 6, oy + ay * k + 1.5], [ox + ax * k - 6, oy + ay * k + 1.5]], [255, 0, 170]);
}

export function cross(p: Painter, x: number, y: number, c: RGB): void {
  p.stroke([[x - 5, y - 5], [x + 5, y + 5]], false, 2, c);
  p.stroke([[x - 5, y + 5], [x + 5, y - 5]], false, 2, c);
}
