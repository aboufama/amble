/**
 * Blob template: `body` (bottom centre → centroid) and `top` (centroid → top of the main mass).
 * Squash, stretch and wobble come from the clips; thin things sticking out of the mass (a sprout,
 * antennas, horns) become springy extras.
 */
import { open, RING_DX, RING_DY } from '../imgproc';
import type { Analysis } from '../analyze';
import { newFit, type Fit } from './common';
import { addExtras, nextName } from './extras';
import { segDist, type P2 } from './graph';

const massCache = new WeakMap<Analysis, Uint8Array>();

/** The shape without its thin parts (stalks, antennas, tails): an opening by 5% of its size. */
export function massOf(a: Analysis): Uint8Array {
  let m = massCache.get(a);
  if (!m) massCache.set(a, (m = open(a.solid, a.w, a.h, Math.max(1, Math.round(0.05 * a.maxDim)))));
  return m;
}

/** Centre of the lowest 10% band of the shape (not the lowest drip). */
export function bottomCentre(a: Analysis): P2 {
  const { bbox } = a;
  let n = 0, sx = 0;
  const band = Math.max(1, Math.round((bbox.y1 - bbox.y0) * 0.1));
  for (let y = bbox.y1 - band; y <= bbox.y1; y++) for (let x = bbox.x0; x <= bbox.x1; x++) if (a.solid[y * a.w + x]) {
    n++;
    sx += x;
  }
  return [n ? sx / n : a.cx, bbox.y1];
}

/** The top of the thick part of the shape above x: thin stalks and antennas don't count. */
export function massTop(a: Analysis, x: number): number {
  const thick = massOf(a);
  const ix = Math.round(x);
  for (let y = a.bbox.y0; y <= a.bbox.y1; y++) if (thick[y * a.w + ix]) return y;
  for (let y = a.bbox.y0; y <= a.bbox.y1; y++) if (a.solid[y * a.w + ix]) return y;
  return a.bbox.y0;
}

/**
 * Skeleton ends outside the thick mass: follow each back until it enters the mass; if it stuck out at
 * least 8% of the size, it's a wiggly bit (a sprout, an aerial, a horn).
 */
export function protrusionExtras(a: Analysis, fit: Fit, accept: (tipY: number) => boolean = () => true): void {
  const thick = massOf(a);
  const { w } = a;
  for (const e of a.ends) {
    if (fit.used.has(e) || thick[e.p] || !accept(e.tipY)) continue;
    const path = [e.p];
    const seen = new Set(path);
    let cur = e.p;
    for (let guard = 0; guard < 2000; guard++) {
      let next = -1;
      for (let k = 0; k < 8; k++) {
        const q = cur + RING_DY[k] * w + RING_DX[k];
        if (a.skel[q] && !seen.has(q)) {
          next = q;
          break;
        }
      }
      if (next < 0) break;
      path.push(next);
      seen.add(next);
      cur = next;
      if (thick[next]) break;
    }
    if (!thick[cur]) continue;
    const base: P2 = [cur % w, Math.floor(cur / w)];
    if (Math.hypot(e.tipX - base[0], e.tipY - base[1]) < 0.08 * a.maxDim) continue;
    let best = fit.bones[0], bd = Infinity;
    for (const b of fit.bones) {
      const d = segDist(base[0], base[1], b.a[0], b.a[1], b.b[0], b.b[1]);
      if (d < bd) {
        bd = d;
        best = b;
      }
    }
    const thin = e.thick < 0.35 * Math.max(a.limbR, ...path.map((p) => a.dt[p]));
    fit.bones.push({ name: nextName(fit, 'extra'), role: 'extra', parent: best.name, a: base, b: [e.tipX, e.tipY], dynamic: thin || e.thick <= 2 });
    fit.used.add(e);
  }
}

export function fitBlob(a: Analysis): Fit {
  const fit = newFit('blob', 0);
  const { bbox, cx, cy } = a;
  const [bx, by] = bottomCentre(a);
  const topY = massTop(a, cx);
  fit.bones.push({ name: 'body', role: 'body', parent: null, a: [bx, by], b: [cx, cy] });
  fit.bones.push({ name: 'top', role: 'top', parent: 'body', a: [cx, cy], b: [cx, Math.min(topY, cy - 1)] });
  const H = bbox.y1 - bbox.y0 + 1;
  const upper = (tipY: number) => tipY < bbox.y0 + 0.65 * H;
  protrusionExtras(a, fit, upper);
  addExtras(a, fit, { accept: (e) => upper(e.tipY) });
  fit.anchor = [bx, bbox.y1 + 0.5];
  return fit;
}
