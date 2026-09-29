/** The Bones view's undo stack (§7.11): steps, bursts, limits. */
import { describe, expect, it } from 'vitest';
import { COALESCE_MS, HISTORY_LIMIT, canRedo, canUndo, commit, createStack, redo, settle, undo } from '../../src/bones/rigHistory';
import { moveJoint, templateFor } from '../../src/cores/rig';

describe('rig undo stack', () => {
  it('undoes and redoes rig edits in order', () => {
    const a = templateFor('biped', 200, 300);
    const b = moveJoint(a, 'armL2', 20, 120);
    const c = moveJoint(b, 'armR2', 180, 120);
    let s = createStack(a);
    expect(canUndo(s)).toBe(false);
    s = commit(s, b, { now: 0 });
    s = commit(s, c, { now: 5000 });
    expect(s.present).toBe(c);
    s = undo(s);
    expect(s.present).toBe(b);
    expect(canRedo(s)).toBe(true);
    s = undo(s);
    expect(s.present).toBe(a);
    expect(canUndo(s)).toBe(false);
    expect(undo(s)).toBe(s);
    s = redo(s);
    expect(s.present).toBe(b);
    s = redo(s);
    expect(s.present).toBe(c);
    expect(redo(s)).toBe(s);
  });

  it('drops the redo steps when a new edit lands', () => {
    let s = createStack(1);
    s = commit(s, 2, { now: 0 });
    s = commit(s, 3, { now: 5000 });
    s = undo(s);
    s = commit(s, 4, { now: 10000 });
    expect(s.present).toBe(4);
    expect(canRedo(s)).toBe(false);
    expect(s.past).toEqual([1, 2]);
  });

  it('ignores an edit that changes nothing', () => {
    const s = commit(createStack('a'), 'b');
    expect(commit(s, 'b')).toBe(s);
  });

  it('merges a burst of nudges on one star into one step', () => {
    let s = createStack(0);
    s = commit(s, 1, { coalesce: 'nudge:armL2', now: 1000 });
    s = commit(s, 2, { coalesce: 'nudge:armL2', now: 1200 });
    s = commit(s, 3, { coalesce: 'nudge:armL2', now: 1400 });
    expect(s.past).toEqual([0]);
    expect(s.present).toBe(3);
    // another star, or a pause longer than the burst window, is a new step
    s = commit(s, 4, { coalesce: 'nudge:armR2', now: 1500 });
    s = commit(s, 5, { coalesce: 'nudge:armR2', now: 1500 + COALESCE_MS + 1 });
    expect(s.past).toEqual([0, 3, 4]);
    expect(undo(s).present).toBe(4);
  });

  it('starts a new step after the burst settles (a star was dropped)', () => {
    let s = createStack(0);
    s = commit(s, 1, { coalesce: 'nudge:a', now: 0 });
    s = settle(s);
    s = commit(s, 2, { coalesce: 'nudge:a', now: 10 });
    expect(s.past).toEqual([0, 1]);
  });

  it('replaces the newest step for a follow-up of the same action', () => {
    let s = createStack('before');
    s = commit(s, 'magic', { now: 0 });
    s = commit(s, 'magic + hints', { replace: true, now: 60_000 });
    expect(s.past).toEqual(['before']);
    expect(undo(s).present).toBe('before');
  });

  it('keeps at least the last HISTORY_LIMIT steps', () => {
    let s = createStack(0);
    for (let i = 1; i <= HISTORY_LIMIT + 20; i++) s = commit(s, i, { now: i * 10_000 });
    expect(s.past.length).toBe(HISTORY_LIMIT);
    expect(s.past[0]).toBe(20);
    let n = 0;
    while (canUndo(s)) {
      s = undo(s);
      n++;
    }
    expect(n).toBe(HISTORY_LIMIT);
  });
});
