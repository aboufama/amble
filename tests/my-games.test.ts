import { describe, expect, it } from 'vitest';
import { gameLike, whenChanged } from '../src/project/myGames';
import { newProject } from '../src/project/defaults';

describe('My games', () => {
  it("doesn't count the way the editor writes blocks back as a change", () => {
    const game = newProject();
    const raw = structuredClone(game);
    raw.stage.blocks = { blocks: { languageVersion: 0, blocks: [{ type: 'ev_start', id: 'a', next: { block: { type: 'mv_goto_xy', id: 'b', inputs: { X: { shadow: { type: 'sh_num', id: 'c', fields: { NUM: '0' } } } } } } }] } };
    const written = structuredClone(raw);
    const top = (written.stage.blocks as { blocks: { blocks: Array<Record<string, unknown>> } }).blocks.blocks[0];
    Object.assign(top, { x: 24, y: 24 });
    ((top.next as { block: { inputs: { X: { shadow: { fields: { NUM: unknown } } } } } }).block.inputs.X.shadow.fields as { NUM: unknown }).NUM = 0;
    expect(JSON.stringify(written)).not.toBe(JSON.stringify(raw));
    expect(gameLike(written)).toBe(gameLike(raw));
    // A sprite moved on the stage, or a number changed, is a change.
    const moved = structuredClone(written);
    moved.sprites[0].x += 10;
    expect(gameLike(moved)).not.toBe(gameLike(raw));
    const renumbered = structuredClone(raw);
    ((renumbered.stage.blocks as { blocks: { blocks: Array<{ next: { block: { inputs: { X: { shadow: { fields: { NUM: unknown } } } } } } }> } }).blocks.blocks[0].next.block.inputs.X.shadow.fields).NUM = '5';
    expect(gameLike(renumbered)).not.toBe(gameLike(raw));
  });

  it('says when a game changed in a few words', () => {
    const now = new Date('2026-11-20T12:00:00').getTime();
    expect(whenChanged(now - 20_000, now)).toBe('just now');
    expect(whenChanged(now - 60_000, now)).toBe('1 minute ago');
    expect(whenChanged(now - 5 * 60_000, now)).toBe('5 minutes ago');
    expect(whenChanged(now - 3 * 3_600_000, now)).toBe('3 hours ago');
    expect(whenChanged(now - 26 * 3_600_000, now)).toBe('yesterday');
    expect(whenChanged(now - 4 * 86_400_000, now)).toBe('4 days ago');
  });
});
