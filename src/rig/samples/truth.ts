/** Comparing a rig with a sample drawing's ground truth (tests and the dev harness). */
import type { RigBone, RigData } from '../types';
import type { JointTruth, SampleDrawing } from './kid-art';

export interface TruthCheck {
  truth: JointTruth;
  got: [number, number] | null;
  err: number;
  ok: boolean;
}

/** A bone by role or name; 'tail' means the last tail bone, 'extra' any extra. */
export function findBone(rig: RigData, key: string): RigBone | undefined {
  if (key === 'tail') {
    const tails = rig.bones.filter((b) => /^tail\d$/.test(b.role));
    return tails[tails.length - 1];
  }
  return rig.bones.find((b) => b.role === key && key !== 'extra') ?? rig.bones.find((b) => b.name === key);
}

export function checkTruth(rig: RigData, sample: SampleDrawing): TruthCheck[] {
  const out: TruthCheck[] = sample.truth.map((t) => {
    const b = findBone(rig, t.bone);
    if (!b) return { truth: t, got: null, err: Infinity, ok: false };
    const got: [number, number] = t.end === 'start' ? [b.x, b.y] : [b.x2, b.y2];
    const err = Math.hypot(got[0] - t.at[0], got[1] - t.at[1]);
    return { truth: t, got, err, ok: err <= t.tol };
  });
  if (sample.anchor) {
    const t: JointTruth = { bone: 'anchor', end: 'start', at: sample.anchor.at, tol: sample.anchor.tol };
    const err = Math.hypot(rig.anchor[0] - t.at[0], rig.anchor[1] - t.at[1]);
    out.push({ truth: t, got: [rig.anchor[0], rig.anchor[1]], err, ok: err <= t.tol });
  }
  return out;
}

/** Expected bones (by role or name prefix) that the rig lacks. */
export function missingExpected(rig: RigData, sample: SampleDrawing): string[] {
  return (sample.expect ?? []).filter((e) => !rig.bones.some((b) => b.role === e || b.name.startsWith(e)));
}
