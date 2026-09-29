/**
 * The game's localStorage inside the sandbox is in memory; changes go to the editor, which keeps them with
 * the world and hands them to the next run. Games often save every frame (the best score, the level), so a
 * save that waits for the writes to stop would never come while the game runs, and a code change or a
 * crash would lose it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStorage } from '../../src/runtime/shell/storage';

describe('the game storage shim', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('window', globalThis);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('saves a game that writes every frame while it keeps running', () => {
    const saved: Array<Record<string, string>> = [];
    const ls = createStorage({}, (d) => saved.push(d));
    for (let frame = 1; frame <= 60 * 5; frame++) {
      ls.setItem('best', String(frame));
      vi.advanceTimersByTime(16);
    }
    expect(saved.length).toBeGreaterThanOrEqual(3);
    expect(Number(saved.at(-1)!.best)).toBeGreaterThan(200);
  });

  it('still saves a burst of writes once, after it', () => {
    const saved: Array<Record<string, string>> = [];
    const ls = createStorage({ level: '1' }, (d) => saved.push(d));
    for (let i = 0; i < 20; i++) ls.setItem('coins', String(i));
    ls.setItem('level', '2');
    expect(saved).toEqual([]);
    vi.advanceTimersByTime(300);
    expect(saved).toEqual([{ level: '2', coins: '19' }]);
    vi.advanceTimersByTime(5000);
    expect(saved.length).toBe(1);
  });
});
