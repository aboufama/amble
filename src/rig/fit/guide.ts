/**
 * Joint hints (from the Draw room's star-pose guide, hand-placed joints kept through "Magic bones", or a
 * vision model) turned into a fitting guide: which skeleton end is which limb, snapped to the drawing.
 *
 * Tips snap to skeleton ends within 12% of the drawing's size; inner joints (elbows, knees) snap to the
 * limb's skeleton path within 8%. A limb that cannot snap is dropped (vision hints) or kept exactly
 * where the hint put it (a guide pose or the student's own joints).
 */
import { toWorkX, toWorkY, type Analysis, type End } from '../analyze';
import type { BoneRole, CharacterKind, JointHints } from '../types';
import type { P2 } from './graph';

export interface Hints {
  /** Where bones start (see `JointHints`). */
  joints?: JointHints;
  /** Where bones end: hands, feet, head top, tail tip, wing tips. */
  tips?: JointHints;
}

export interface Guide {
  joints: Partial<Record<BoneRole, P2>>;
  tips: Partial<Record<BoneRole, P2>>;
  /** Limb slot → the skeleton end its hinted tip snapped to. */
  ends: Map<string, End>;
  /** Slots that had a prediction but no end close enough. */
  unsnapped: Set<string>;
  keepUnsnapped: boolean;
  tolTip: number;
  tolJoint: number;
}

/** A limb slot: a chain of roles from its joint to its tip. */
export interface Slot {
  slot: string;
  roles: BoneRole[];
}

export const SLOTS: Record<CharacterKind, Slot[]> = {
  biped: [
    { slot: 'head', roles: ['head'] },
    { slot: 'armL', roles: ['armL1', 'armL2'] },
    { slot: 'armR', roles: ['armR1', 'armR2'] },
    { slot: 'legL', roles: ['legL1', 'legL2'] },
    { slot: 'legR', roles: ['legR1', 'legR2'] },
  ],
  quadruped: [
    { slot: 'head', roles: ['neck', 'head'] },
    { slot: 'tail', roles: ['tail1', 'tail2', 'tail3'] },
    { slot: 'legFL', roles: ['legFL1', 'legFL2'] },
    { slot: 'legFR', roles: ['legFR1', 'legFR2'] },
    { slot: 'legBL', roles: ['legBL1', 'legBL2'] },
    { slot: 'legBR', roles: ['legBR1', 'legBR2'] },
  ],
  flyer: [
    { slot: 'head', roles: ['head'] },
    { slot: 'wingL', roles: ['wingL1', 'wingL2'] },
    { slot: 'wingR', roles: ['wingR1', 'wingR2'] },
    { slot: 'tail', roles: ['tail1', 'tail2'] },
    { slot: 'legL', roles: ['legL1', 'legL2'] },
    { slot: 'legR', roles: ['legR1', 'legR2'] },
  ],
  swimmer: [
    { slot: 'head', roles: ['neck', 'head'] },
    { slot: 'tail', roles: ['tail1', 'tail2', 'tail3'] },
  ],
  blob: [],
  object: [],
};

const toW = (a: Analysis, p: readonly [number, number]): P2 => [toWorkX(a, p[0]), toWorkY(a, p[1])];

/** Where a slot's tip should be, from the hints (null = the hints don't say). */
export function predictTip(g: Pick<Guide, 'joints' | 'tips'>, s: Slot): P2 | null {
  for (let i = s.roles.length - 1; i >= 0; i--) {
    const t = g.tips[s.roles[i]];
    if (t) return t;
  }
  const last = s.roles.length - 1;
  const mid = g.joints[s.roles[last]];
  const start = s.roles.length > 1 ? g.joints[s.roles[last - 1]] : undefined;
  if (mid && start) return [2 * mid[0] - start[0], 2 * mid[1] - start[1]];
  if (s.slot === 'head') {
    const neck = g.joints.head ?? g.joints.neck;
    const pelvis = g.joints.spine ?? g.joints.hips;
    if (neck && pelvis) return [neck[0] + (neck[0] - pelvis[0]) * 0.8, neck[1] + (neck[1] - pelvis[1]) * 0.8];
  }
  return null;
}

export function makeGuide(a: Analysis, kind: CharacterKind, hints: Hints, keepUnsnapped: boolean): Guide {
  const joints: Guide['joints'] = {};
  const tips: Guide['tips'] = {};
  for (const [role, p] of Object.entries(hints.joints ?? {})) if (p) joints[role as BoneRole] = toW(a, p);
  for (const [role, p] of Object.entries(hints.tips ?? {})) if (p) tips[role as BoneRole] = toW(a, p);
  const size = a.maxDim;
  const g: Guide = { joints, tips, ends: new Map(), unsnapped: new Set(), keepUnsnapped, tolTip: 0.12 * size, tolJoint: 0.08 * size };
  const wants: { slot: string; at: P2 }[] = [];
  for (const s of SLOTS[kind]) {
    const at = predictTip(g, s);
    if (at) wants.push({ slot: s.slot, at });
  }
  // greedy: the closest (slot, end) pairs first, each end used once
  const pairs: { slot: string; e: End; d: number }[] = [];
  for (const wnt of wants) for (const e of a.ends) {
    const d = Math.hypot(e.tipX - wnt.at[0], e.tipY - wnt.at[1]);
    if (d <= g.tolTip) pairs.push({ slot: wnt.slot, e, d });
  }
  pairs.sort((p, q) => p.d - q.d);
  const usedEnds = new Set<End>();
  for (const p of pairs) {
    if (g.ends.has(p.slot) || usedEnds.has(p.e)) continue;
    g.ends.set(p.slot, p.e);
    usedEnds.add(p.e);
  }
  for (const wnt of wants) if (!g.ends.has(wnt.slot)) g.unsnapped.add(wnt.slot);
  return g;
}

/** Hinted positions of a slot's joints (start, middle, tip) for rebuilding an unsnapped limb. */
export function slotPoints(g: Guide, s: Slot): P2[] | null {
  const pts: P2[] = [];
  for (const r of s.roles) {
    const j = g.joints[r];
    if (!j) return null;
    pts.push(j);
  }
  const tip = predictTip(g, s);
  if (!tip) return null;
  pts.push(tip);
  return pts;
}
