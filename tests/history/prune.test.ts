/** Prune rules (§4.5): 60 steps per world with snapshots, then one per day. */
import { describe, expect, it } from 'vitest';
import { foldedSteps, newlyFolded, prunePlan } from '../../src/history/prune';
import type { StepSummary } from '../../src/model/types';

const DAY = 24 * 3_600_000;
const T0 = new Date(2026, 8, 1, 9, 0, 0).getTime();

function steps(times: number[]): StepSummary[] {
  return times.map((at, i) => ({ id: `s_${String(i).padStart(10, '0')}`, at, by: 'student', kind: 'dials', text: `step ${i}` }));
}

describe('prune', () => {
  it('keeps everything up to 60 steps', () => {
    const list = steps(Array.from({ length: 60 }, (_, i) => T0 + i * 1000));
    expect(prunePlan(list).drop).toEqual([]);
    expect(prunePlan(list).keep).toHaveLength(60);
  });

  it('keeps the newest 60, then the last step of each older day', () => {
    // 10 steps on day 1, 10 on day 2, then 60 on day 3.
    const times = [
      ...Array.from({ length: 10 }, (_, i) => T0 + i * 60_000),
      ...Array.from({ length: 10 }, (_, i) => T0 + DAY + i * 60_000),
      ...Array.from({ length: 60 }, (_, i) => T0 + 2 * DAY + i * 60_000),
    ];
    const list = steps(times);
    const plan = prunePlan(list);
    expect(plan.keep).toHaveLength(62);
    expect(plan.keep).toContain(list[9].id);
    expect(plan.keep).toContain(list[19].id);
    expect(plan.drop).toHaveLength(18);
    expect(plan.drop).not.toContain(list[20].id);
    expect(foldedSteps(list).has(list[0].id)).toBe(true);
  });

  it('never folds the steps it kept before a new day starts, and reports what just folded', () => {
    const times = Array.from({ length: 61 }, (_, i) => T0 + i * 1000);
    const list = steps(times);
    // The oldest step left the window and is the only old step of its day: kept.
    expect(prunePlan(list).drop).toEqual([]);
    const more = steps([...times, T0 + 70_000]);
    // Now two old steps share a day: the older one folds.
    expect(newlyFolded(list, more)).toEqual([more[0].id]);
  });
});
