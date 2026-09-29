/** How footsteps read (§2.9): who, the bold lead, when, and the texts Footsteps writes. */
import { describe, expect, it } from 'vitest';
import { canSeeChange, codeStepText, lookOf, splitText, timeAgo, wentBackText } from '../../src/history/summary';
import type { StepSummary } from '../../src/model/types';

const step = (over: Partial<StepSummary>): StepSummary => ({ id: 's_0000000001', at: 0, by: 'student', kind: 'dials', text: '', ...over });

describe('footstep words', () => {
  it('bolds the right part of each kind of step', () => {
    expect(splitText(step({ text: 'You turned Jump height up to 820.' }))).toEqual({ lead: 'You turned Jump height up', rest: ' to 820.' });
    expect(splitText(step({ kind: 'ask', by: 'ai', text: 'Amble made the Moon King throw orbs.' }))).toEqual({ lead: 'Amble', rest: ' made the Moon King throw orbs.' });
    expect(splitText(step({ kind: 'goback', text: "You went back to 'You drew Pip'" }))).toEqual({ lead: 'You went back to', rest: " 'You drew Pip'" });
    expect(splitText(step({ kind: 'draw', text: 'You drew the Moon King' }))).toEqual({ lead: 'You drew the Moon King', rest: '' });
    expect(splitText(step({ kind: 'fix', by: 'auto', text: 'Amble fixed a small bug by itself (line 42).' }))).toEqual({ lead: '', rest: 'Amble fixed a small bug by itself (line 42).' });
  });

  it('gives each author its footprint', () => {
    expect(lookOf(step({ by: 'ai' }))).toBe('ai');
    expect(lookOf(step({ by: 'auto', kind: 'fix' }))).toBe('fix');
    expect(lookOf(step({ kind: 'refused' }))).toBe('fix');
    expect(lookOf(step({ by: 'teacher' }))).toBe('teacher');
    expect(lookOf(step({}))).toBe('you');
  });

  it('says when, briefly', () => {
    const now = new Date(2026, 8, 29, 15, 0).getTime();
    expect(timeAgo(now - 20_000, now)).toBe('now');
    expect(timeAgo(now - 6 * 60_000, now)).toBe('6 min');
    expect(timeAgo(now - 2 * 3_600_000, now)).toBe('2 h');
    expect(timeAgo(new Date(2026, 8, 28, 9, 0).getTime(), now)).toBe('Yesterday');
    expect(timeAgo(new Date(2026, 8, 20, 9, 0).getTime(), now)).toBe('Sep 20');
  });

  it('writes its own footsteps', () => {
    expect(codeStepText(['boss.js'])).toBe('You changed boss.js');
    expect(codeStepText(['game.js', 'boss.js'])).toBe('You changed game.js and boss.js');
    expect(codeStepText(['a.js', 'b.js', 'c.js'])).toBe('You changed 3 files');
    expect(wentBackText(step({ text: 'You turned Jump height up to 820.' }))).toBe("You went back to 'You turned Jump height up to 820'");
  });

  it('offers See the change where there is something to see', () => {
    expect(canSeeChange(step({ kind: 'code' }))).toBe(true);
    expect(canSeeChange(step({ kind: 'ask', by: 'ai' }))).toBe(true);
    expect(canSeeChange(step({ kind: 'draw' }))).toBe(true);
    expect(canSeeChange(step({ kind: 'dials' }))).toBe(false);
    expect(canSeeChange(step({ kind: 'start' }))).toBe(false);
    expect(canSeeChange(step({ kind: 'refused', by: 'ai' }))).toBe(false);
  });
});
