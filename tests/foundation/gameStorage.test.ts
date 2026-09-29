/**
 * A game's saved localStorage stays inside its budget (§4.8: 64 KB of a world's 200 KB), whatever the game
 * posts: the player's `storage` message allows 200 entries of 10,000 characters, about 2 MB.
 */
import { describe, expect, it } from 'vitest';
import { keepGameStorage } from '../../src/model/gameStorage';
import { KEEP } from '../../src/model/limits';
import { parseFromPlayer } from '../../src/play/protocol';

const size = (d: Record<string, string>) => Object.entries(d).reduce((n, [k, v]) => n + k.length + v.length, 0);

describe('keepGameStorage', () => {
  it('keeps small saves as they are', () => {
    expect(keepGameStorage({ best: '12', name: 'Pip' })).toEqual({ best: '12', name: 'Pip' });
  });

  it('keeps the biggest message a game can send inside the budget', () => {
    const data: Record<string, string> = {};
    for (let i = 0; i < 300; i++) data[`score${i}`] = 'x'.repeat(20_000);
    const msg = parseFromPlayer({ type: 'storage', data });
    expect(msg?.type).toBe('storage');
    if (msg?.type !== 'storage') return;
    expect(size(msg.data)).toBeGreaterThan(1_000_000);
    const kept = keepGameStorage(msg.data);
    expect(size(kept)).toBeLessThanOrEqual(KEEP.gameStorageBytes);
    expect(Object.keys(kept)).toEqual(['score0', 'score1', 'score2', 'score3', 'score4', 'score5']);
  });

  it('stops at the first entry that does not fit, and never keeps anything but strings', () => {
    const kept = keepGameStorage({ a: 'x'.repeat(10), big: 'y'.repeat(KEEP.gameStorageBytes), c: 'z', n: 5 as unknown as string });
    expect(kept).toEqual({ a: 'x'.repeat(10) });
  });
});
