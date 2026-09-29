/**
 * Extras: branches the template didn't use that stick out at least 10% of the drawing's size become
 * one-bone chains on the nearest bone: ears, antennas, hair, horns, fins, capes. Thin ones are
 * "dynamic" (springy wiggly bits).
 */
import { RING_DX, RING_DY } from '../imgproc';
import type { Analysis, End } from '../analyze';
import { exitIndex, type Fit } from './common';
import { px, segDist, type P2 } from './graph';

export interface ExtraOptions {
  /** Only ends whose tip passes this test become extras. */
  accept?: (e: End) => boolean;
  /** Extras are springy when thinner than this fraction of the thickest junction (default 0.45). */
  thin?: number;
  /** Only thin branches become extras (objects: an aerial is a bit, a cabin is the body). */
  thinOnly?: boolean;
}

/** The skeleton path from an end to its junction, junction first. */
export function branchPath(a: Analysis, e: End): number[] {
  const path: number[] = [];
  const seen = new Set<number>();
  let cur = e.p;
  for (let guard = 0; guard < 4000; guard++) {
    path.push(cur);
    seen.add(cur);
    if (cur === e.junction) break;
    let next = -1;
    for (let d = 0; d < 8; d++) {
      const q = cur + RING_DY[d] * a.w + RING_DX[d];
      if (a.skel[q] && !seen.has(q)) {
        next = q;
        break;
      }
    }
    if (next < 0) break;
    cur = next;
  }
  return path.reverse();
}

/** `extra1`, `extra2`, ...: the first free numbered name. */
export function nextName(fit: Fit, base: string): string {
  const taken = new Set(fit.bones.map((b) => b.name));
  let k = 1;
  while (taken.has(`${base}${k}`)) k++;
  return `${base}${k}`;
}

export function addExtras(a: Analysis, fit: Fit, opts: ExtraOptions = {}): void {
  if (!fit.bones.length) return;
  const maxDim = a.maxDim;
  const torsoR = Math.max(a.limbR, ...a.ends.map((e) => (e.junction >= 0 ? a.dt[e.junction] : 0)));
  for (const e of a.ends) {
    if (fit.used.has(e) || e.junction < 0) continue;
    if (e.len - a.dt[e.junction] < 0.1 * maxDim) continue;
    if (opts.accept && !opts.accept(e)) continue;
    const path = branchPath(a, e);
    const ex = Math.min(exitIndex(a, path, e.thick), path.length - 1);
    const st: P2 = px(a, path[ex]);
    let best = fit.bones[0], bd = Infinity;
    for (const b of fit.bones) {
      const d = segDist(st[0], st[1], b.a[0], b.a[1], b.b[0], b.b[1]);
      if (d < bd) {
        bd = d;
        best = b;
      }
    }
    const thin = e.thick < (opts.thin ?? 0.45) * torsoR;
    if (opts.thinOnly && !thin) continue;
    const name = nextName(fit, 'extra');
    fit.bones.push({ name, role: 'extra', parent: best.name, a: st, b: [e.tipX, e.tipY], dynamic: thin });
    fit.used.add(e);
  }
}
