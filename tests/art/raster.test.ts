import { describe, expect, it } from 'vitest';
import { type Grain, type Target, capsule, makeTarget, stadiumSpan, touch } from '../../src/art/engine/raster';
import { grainFor, mulberry32 } from '../../src/art/engine/grain';
import { sameBytes } from './helpers';

/** The plain full-box scan (the editor probe's rasterizer): the fast capsule must match it exactly. */
function referenceCapsule(t: Target, ax: number, ay: number, ra: number, pa: number, bx: number, by: number, rb: number, pb: number, opacity: number, grain: Grain | null): void {
  const raC = ra < 0.5 ? 0.5 : ra;
  const rbC = rb < 0.5 ? 0.5 : rb;
  const fa = ra < 0.5 ? ra * 2 : 1;
  const fb = rb < 0.5 ? rb * 2 : 1;
  const rmax = raC > rbC ? raC : rbC;
  const W = t.W;
  const x0 = Math.max(0, Math.floor(Math.min(ax, bx) - rmax - 1));
  const x1 = Math.min(W - 1, Math.ceil(Math.max(ax, bx) + rmax + 1));
  const y0 = Math.max(0, Math.floor(Math.min(ay, by) - rmax - 1));
  const y1 = Math.min(t.H - 1, Math.ceil(Math.max(ay, by) + rmax + 1));
  if (x0 > x1 || y0 > y1) return;
  touch(t, x0, y0, x1, y1);
  const buf = t.buf;
  const dx = bx - ax;
  const dy = by - ay;
  const h = dx * dx + dy * dy;
  const bb = raC - rbC;
  const degenerate = h <= bb * bb + 1e-6;
  const cxD = raC >= rbC ? ax : bx;
  const cyD = raC >= rbC ? ay : by;
  const crD = raC >= rbC ? raC : rbC;
  const cfD = raC >= rbC ? fa : fb;
  const cpD = raC >= rbC ? pa : pb;
  const invH = degenerate ? 0 : 1 / h;
  const cx = degenerate ? 0 : Math.sqrt(h - bb * bb);
  const tex = grain ? grain.tex : null;
  const lut = grain ? grain.lut : null;
  for (let y = y0; y <= y1; y++) {
    const py = y + 0.5 - ay;
    let i = y * W + x0;
    const trow = (y & 255) << 8;
    for (let x = x0; x <= x1; x++, i++) {
      const px = x + 0.5 - ax;
      let sd: number;
      let tt: number;
      if (degenerate) {
        sd = Math.hypot(x + 0.5 - cxD, y + 0.5 - cyD) - crD;
        tt = -1;
      } else {
        let qx = (px * dy - py * dx) * invH;
        if (qx < 0) qx = -qx;
        const qy = (px * dx + py * dy) * invH;
        const k = cx * qy - bb * qx;
        const n = qx * qx + qy * qy;
        if (k < 0) sd = Math.sqrt(h * n) - raC;
        else if (k > cx) sd = Math.sqrt(h * (n + 1 - 2 * qy)) - rbC;
        else sd = cx * qx + bb * qy - raC;
        tt = qy < 0 ? 0 : qy > 1 ? 1 : qy;
      }
      let a = 0.5 - sd;
      if (a <= 0) continue;
      if (a > 1) a = 1;
      if (tt < 0) {
        a *= cfD * opacity;
        if (lut && tex) {
          let e = -sd / (0.6 * crD);
          if (e > 1) e = 1;
          else if (e < 0) e = 0;
          const pe = cpD * (0.55 + 0.45 * e);
          a *= lut[(((pe * 31 + 0.5) | 0) << 8) | tex[trow | (x & 255)]];
        }
      } else {
        a *= (fa + (fb - fa) * tt) * opacity;
        if (lut && tex) {
          let e = -sd / (0.6 * (raC + (rbC - raC) * tt));
          if (e > 1) e = 1;
          else if (e < 0) e = 0;
          const pe = (pa + (pb - pa) * tt) * (0.55 + 0.45 * e);
          a *= lut[(((pe * 31 + 0.5) | 0) << 8) | tex[trow | (x & 255)]];
        }
      }
      if (a > buf[i]) buf[i] = a;
    }
  }
}

describe('capsule rasterizer', () => {
  it('matches the full scan exactly (thick, thin, uneven, degenerate, grain, board edges)', () => {
    const rand = mulberry32(21);
    const W = 160;
    const H = 120;
    const fast = makeTarget(W, H, true);
    const ref = makeTarget(W, H, true);
    const grains: Array<Grain | null> = [null, grainFor('pencil'), grainFor('crayon')];
    for (let n = 0; n < 600; n++) {
      const ax = -20 + rand() * (W + 40);
      const ay = -20 + rand() * (H + 40);
      const kind = n % 5;
      const len = kind === 0 ? 0 : kind === 1 ? rand() * 2 : rand() * 60;
      const ang = rand() * Math.PI * 2;
      const bx = ax + Math.cos(ang) * len;
      const by = ay + Math.sin(ang) * len;
      const big = rand() < 0.5;
      const ra = big ? rand() * 40 : rand() * 3;
      const rb = rand() < 0.3 ? ra : big ? rand() * 40 : rand() * 3;
      const opacity = rand() < 0.5 ? 1 : 0.2 + rand() * 0.8;
      const g = grains[n % 3];
      const pa = rand();
      const pb = rand();
      capsule(fast, ax, ay, ra, pa, bx, by, rb, pb, opacity, g);
      referenceCapsule(ref, ax, ay, ra, pa, bx, by, rb, pb, opacity, g);
      if (n % 25 === 24) {
        expect(sameBytes(fast.buf, ref.buf)).toBe(true);
        fast.buf.fill(0);
        ref.buf.fill(0);
      }
    }
    expect(fast.box).toEqual(ref.box);
    expect(sameBytes(fast.tiles as Uint8Array, ref.tiles as Uint8Array)).toBe(true);
  });

  it('crosses a horizontal line where the stadium is', () => {
    const s = new Float64Array(2);
    // Horizontal segment (0,0)-(10,0), R 2: y = 1 crosses from -sqrt(3) to 10 + sqrt(3).
    stadiumSpan(0, 0, 10, 0, 2, 1, s);
    expect(s[0]).toBeCloseTo(-Math.sqrt(3), 9);
    expect(s[1]).toBeCloseTo(10 + Math.sqrt(3), 9);
    // Vertical segment, line through its middle: just the band.
    stadiumSpan(5, 0, 5, 10, 3, 5, s);
    expect([s[0], s[1]]).toEqual([2, 8]);
    // Misses.
    stadiumSpan(0, 0, 10, 0, 2, 3, s);
    expect(s[0] > s[1]).toBe(true);
    // A 45 degree segment: every point found is within R of it (and the ends are on the boundary).
    stadiumSpan(0, 0, 10, 10, 2, 4, s);
    const dist = (x: number): number => Math.abs(x - 4) / Math.SQRT2;
    expect(dist(s[0])).toBeCloseTo(2, 9);
    expect(dist(s[1])).toBeCloseTo(2, 9);
  });
});
