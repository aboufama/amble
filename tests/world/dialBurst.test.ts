/** Dial bursts (§2.7): one footstep per dial after 1.5 s of rest, from the value before the burst. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DIAL_REST_MS, DialBurst, type DialCommit } from '../../src/world/dialBurst';

describe('DialBurst', () => {
  let commits: DialCommit[];
  let burst: DialBurst;

  beforeEach(() => {
    vi.useFakeTimers();
    commits = [];
    burst = new DialBurst((c) => commits.push(c));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('merges a drag into one step after 1.5 s of rest', () => {
    burst.change('orbSpeed', 280, 270);
    vi.advanceTimersByTime(500);
    burst.change('orbSpeed', 270, 200);
    vi.advanceTimersByTime(1000);
    burst.change('orbSpeed', 200, 160);
    vi.advanceTimersByTime(DIAL_REST_MS - 1);
    expect(commits).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(commits).toEqual([{ key: 'orbSpeed', from: 280, to: 160 }]);
  });

  it('keeps each dial to its own burst', () => {
    burst.change('jump', 720, 800);
    vi.advanceTimersByTime(1000);
    burst.change('gravity', 1500, 900);
    vi.advanceTimersByTime(500);
    expect(commits).toEqual([{ key: 'jump', from: 720, to: 800 }]);
    vi.advanceTimersByTime(1000);
    expect(commits).toEqual([
      { key: 'jump', from: 720, to: 800 },
      { key: 'gravity', from: 1500, to: 900 },
    ]);
  });

  it('records nothing when a drag ends where it started', () => {
    burst.change('jump', 720, 900);
    burst.change('jump', 900, 720);
    vi.advanceTimersByTime(DIAL_REST_MS);
    expect(commits).toEqual([]);
  });

  it('flushes open bursts at once, and cancel forgets them', () => {
    burst.change('jump', 720, 760);
    expect(burst.pending()).toBe(true);
    burst.flush();
    expect(commits).toEqual([{ key: 'jump', from: 720, to: 760 }]);
    burst.change('jump', 760, 800);
    burst.cancel();
    vi.advanceTimersByTime(DIAL_REST_MS * 2);
    expect(commits).toHaveLength(1);
    expect(burst.pending()).toBe(false);
  });
});
