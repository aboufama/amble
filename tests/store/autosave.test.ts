/**
 * Autosave durability (§4.4), beyond FOUNDATION's debounce tests: `freeze` writes at once, a failed write
 * is tried again after a short wait even with no new change, the first landed write asks the browser to
 * keep Amble's data (once), and nothing queued is ever dropped.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SaveState } from '../../src/model/types';
import type { Commit, Store } from '../../src/store/api';
import { createAutosave, mergeExtra } from '../../src/store/autosave';
import { MemoryStore } from '../../src/store/memory';
import { sampleArt, sampleWorld } from '../foundation/samples';

class Target extends EventTarget {
  document = { visibilityState: 'visible' as DocumentVisibilityState };
}

let commits: Commit[];

function fakeStore(fail: () => Error | null = () => null): Store {
  const mem = new MemoryStore();
  return Object.assign(Object.create(mem) as Store, {
    mode: 'idb' as const,
    commit: async (c: Commit) => {
      const err = fail();
      if (err) throw err;
      commits.push(c);
    },
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  commits = [];
});

afterEach(() => {
  vi.useRealTimers();
});

describe('autosave', () => {
  it('writes at once on freeze (a tab put to sleep)', async () => {
    const target = new Target();
    const saver = createAutosave(fakeStore(), { target });
    saver.schedule(sampleWorld());
    target.dispatchEvent(new Event('freeze'));
    await vi.advanceTimersByTimeAsync(0);
    expect(commits).toHaveLength(1);
    saver.dispose();
  });

  it('tries a failed write again after a short wait, with no new change', async () => {
    let failing = 2;
    const states: SaveState[] = [];
    const saver = createAutosave(
      fakeStore(() => (failing-- > 0 ? new DOMException('Busy', 'UnknownError') : null)),
      { target: new Target(), onState: (s) => states.push(s), retryMs: [1000, 3000] },
    );
    saver.schedule(sampleWorld({ title: 'Kept' }), { art: [sampleArt()] });
    await saver.flush();
    expect(states).toEqual(['error']);
    await vi.advanceTimersByTimeAsync(1000);
    expect(states).toEqual(['error', 'error']);
    expect(commits).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(3000);
    expect(commits).toHaveLength(1);
    expect(commits[0].worlds?.[0].title).toBe('Kept');
    expect(commits[0].art).toHaveLength(1);
    expect(states).toEqual(['error', 'error', 'saved']);
    expect(saver.pending()).toBe(false);
    saver.dispose();
  });

  it('asks to keep the data after the first save only', async () => {
    const first = vi.fn();
    const saver = createAutosave(fakeStore(), { target: new Target(), onFirstSave: first });
    saver.schedule(sampleWorld());
    await saver.flush();
    saver.schedule(sampleWorld({ title: 'Again' }));
    await saver.flush();
    expect(commits).toHaveLength(2);
    expect(first).toHaveBeenCalledTimes(1);
    saver.dispose();
  });

  it('keeps the newest version of each world and merges what goes with them', () => {
    const merged = mergeExtra({ art: [sampleArt({ name: 'Old' })], clearDrafts: ['a_1'] }, { art: [sampleArt({ name: 'New' })], clearDrafts: ['a_1', 'a_2'] });
    expect(merged.art?.map((a) => a.name)).toEqual(['New']);
    expect(merged.clearDrafts).toEqual(['a_1', 'a_2']);
  });

  it('stops listening when disposed', async () => {
    const target = new Target();
    const saver = createAutosave(fakeStore(), { target });
    saver.schedule(sampleWorld());
    saver.dispose();
    target.dispatchEvent(new Event('pagehide'));
    await vi.advanceTimersByTimeAsync(5000);
    expect(commits).toHaveLength(0);
    expect(saver.pending()).toBe(true);
    await saver.flush();
    expect(commits).toHaveLength(1);
  });
});
