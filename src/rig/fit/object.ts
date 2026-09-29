/**
 * Object template (vehicles, props, items): one rigid `body` bone from the bottom centre to the top,
 * wheels (round colour regions or round holes touching the bottom) as rigid `wheel1..n` bones that
 * spin, and other sticking-out bits as hinged extras (thin ones are springy: an aerial, a flag).
 */
import type { Analysis } from '../analyze';
import { colourDist, newFit, type Fit } from './common';
import { bottomCentre, protrusionExtras } from './blob';
import { addExtras } from './extras';
import type { P2 } from './graph';

interface Wheel {
  c: P2;
  r: number;
}

/**
 * Round regions near the bottom: a tyre (a ring of one colour, maybe around a hub or a hole) or a
 * filled disc, bounded by ink or transparency.
 */
function findWheels(a: Analysis): Wheel[] {
  const { w, h, bbox, solid, ink, holes } = a;
  const H = bbox.y1 - bbox.y0 + 1;
  const minR = 0.05 * a.maxDim;
  const seen = new Uint8Array(w * h);
  const found: Wheel[] = [];
  for (let i = 0; i < w * h; i++) {
    if (seen[i] || !solid[i] || ink[i] || Math.floor(i / w) < bbox.y0 + 0.45 * H) continue;
    const q = [i];
    seen[i] = 1;
    let x0 = w, x1 = 0, y0 = h, y1 = 0, sx = 0, sy = 0;
    for (let k = 0; k < q.length; k++) {
      const p = q[k];
      const x = p % w, y = Math.floor(p / w);
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
      sx += x;
      sy += y;
      for (const n of [p - 1, p + 1, p - w, p + w]) {
        if (seen[n] || !solid[n] || ink[n] || holes[n] || colourDist(a, p, n) > 40) continue;
        seen[n] = 1;
        q.push(n);
      }
      if (q.length > a.area * 0.3) break;
    }
    const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
    const r = (bw + bh) / 4;
    if (r < minR || q.length > a.area * 0.3) continue;
    if (bw > 1.3 * bh || bh > 1.3 * bw) continue;
    const c: P2 = [(x0 + x1) / 2, (y0 + y1) / 2];
    // the centroid of a disc or a ring sits at its centre; a blob that merely fits a square doesn't
    if (Math.hypot(sx / q.length - c[0], sy / q.length - c[1]) > 0.18 * r) continue;
    // every pixel within the circle, nothing far outside it
    let outside = 0;
    for (const p of q) if (Math.hypot((p % w) - c[0], Math.floor(p / w) - c[1]) > 1.15 * r) outside++;
    if (outside > 0.06 * q.length) continue;
    const fill = q.length / (Math.PI * r * r);
    if (fill < 0.3) continue;
    if (c[1] + r < bbox.y1 - 0.12 * H) continue;
    found.push({ c, r: r + Math.max(1, a.strokeW / 2) });
  }
  const out: Wheel[] = [];
  for (const wh of found.sort((p, q) => q.r - p.r)) {
    if (out.some((o) => Math.hypot(o.c[0] - wh.c[0], o.c[1] - wh.c[1]) < Math.max(o.r, wh.r))) continue;
    out.push(wh);
  }
  return out.sort((p, q) => p.c[0] - q.c[0]).slice(0, 6);
}

export function fitObject(a: Analysis): Fit {
  const fit = newFit('object', 0);
  const { bbox, cx } = a;
  const [bx, by] = bottomCentre(a);
  fit.bones.push({ name: 'body', role: 'body', parent: null, a: [bx, by], b: [cx, bbox.y0] });
  const wheels = findWheels(a);
  wheels.forEach((wh, k) => {
    fit.bones.push({ name: `wheel${k + 1}`, role: 'extra', parent: 'body', a: wh.c, b: [wh.c[0] + wh.r, wh.c[1]], rigid: true });
  });
  for (const e of a.ends) {
    if (wheels.some((wh) => Math.hypot(e.tipX - wh.c[0], e.tipY - wh.c[1]) < 1.6 * wh.r)) fit.used.add(e);
  }
  protrusionExtras(a, fit);
  addExtras(a, fit, { thin: 0.3, thinOnly: true });
  if (wheels.length) fit.notes.push(`Amble found ${wheels.length === 1 ? 'a wheel' : `${wheels.length} wheels`}; they spin when it moves.`);
  fit.anchor = [bx, bbox.y1 + 0.5];
  return fit;
}
