/** Snapping hinted inner joints (elbows, knees) onto a fitted limb. */
import type { Analysis } from '../analyze';
import type { LimbResult } from './common';
import type { P2 } from './graph';
import type { Guide } from './guide';

function closestOnSegment(p: P2, a: P2, b: P2): { q: P2; d: number } {
  const vx = b[0] - a[0], vy = b[1] - a[1];
  const l2 = vx * vx + vy * vy;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * vx + (p[1] - a[1]) * vy) / l2)) : 0;
  const q: P2 = [a[0] + vx * t, a[1] + vy * t];
  return { q, d: Math.hypot(p[0] - q[0], p[1] - q[1]) };
}

/**
 * Moves a limb's middle joint to the hinted one when the hint lies on the limb (within 8% of the
 * drawing's size). A guide or hand-placed hint that is off the limb is kept as it is.
 */
export function snapMid(_a: Analysis, g: LimbResult, hint: P2 | undefined, guide: Guide | null): void {
  if (!hint || !guide) return;
  const s1 = closestOnSegment(hint, g.start, g.mid);
  const s2 = closestOnSegment(hint, g.mid, g.tip);
  const best = s1.d <= s2.d ? s1 : s2;
  if (best.d <= guide.tolJoint) g.mid = best.q;
  else if (guide.keepUnsnapped) g.mid = hint;
}

/**
 * Legs drawn touching share one path through the drawing, which can run from a foot up the other thigh:
 * when each fitted hip is nearer the other leg's hinted hip (by more than 8% of the drawing's size in
 * all), the hips swap back.
 */
export function uncrossStarts(l: LimbResult, r: LimbResult, hl: P2 | undefined, hr: P2 | undefined, guide: Guide | null): void {
  if (!hl || !hr || !guide) return;
  const d = (p: P2, q: P2) => Math.hypot(p[0] - q[0], p[1] - q[1]);
  if (d(l.start, hr) + d(r.start, hl) + guide.tolJoint < d(l.start, hl) + d(r.start, hr)) [l.start, r.start] = [r.start, l.start];
}
