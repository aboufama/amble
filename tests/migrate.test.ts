import { describe, expect, it } from 'vitest';
import { migrateProject } from '../src/project/migrate';
import { serializeBlocks } from '../src/compiler/serialize';
import { newProject, newSprite } from '../src/project/defaults';
import type { JsonBlock } from '../src/project/defaults';
import type { Project } from '../src/project/types';

/** A project saved with the old, Scratch-style blocks (free-text fields). */
function oldProject(): Project {
  const p = newProject('2d');
  p.sprites.push(newSprite('Coin', '2d'));
  const old = (type: string, fields: Record<string, string> = {}, extra: Partial<JsonBlock> & Record<string, unknown> = {}) => ({ type, id: `id-${type}`, fields, ...extra }) as JsonBlock;
  const chain = (...blocks: JsonBlock[]) => {
    for (let i = blocks.length - 2; i >= 0; i--) blocks[i].next = { block: blocks[i + 1] };
    return blocks[0];
  };
  p.sprites[0].blocks = {
    blocks: {
      languageVersion: 0,
      blocks: [
        {
          ...chain(
            old('ev_start'),
            old('mo_move', { HOW: '10 steps' }),
            old('mo_glide', { HOW: 'to the top over 1 second' }),
            old('co_repeat', { TIMES: '3 times' }, { inputs: { SUBSTACK: { block: chain(old('mo_turn', { HOW: 'left 90 degrees' }), old('co_wait', { TIME: 'a moment' })) } } }),
            old('co_if', { CONDITION: 'I touch a coin' }, { inputs: { SUBSTACK: { block: old('va_change', { VARIABLE: 'score', AMOUNT: '1' }) } } }),
            old('mo_goto', { WHERE: 'coin' }),
            old('lo_say_for', { TEXT: 'Yay', TIME: '2 seconds' }),
            old('co_create_clone', { WHAT: 'myself' }),
          ),
          x: 40,
          y: 60,
          icons: { comment: { text: 'the main loop' } },
        } as JsonBlock,
        { ...old('ev_when', { EVENT: 'the score reaches 10' }), x: 300, y: 20, next: { block: old('co_stop', { WHAT: 'all' }) } } as JsonBlock,
        { ...old('lo_hide'), x: 10, y: 400 } as JsonBlock,
      ],
    },
  };
  return p;
}

describe('migrateProject', () => {
  it('turns old blocks into the closest new ones, keeping every word', () => {
    const p = migrateProject(oldProject());
    expect(serializeBlocks(p.sprites[0].blocks).text).toBe(
      [
        'Script 1:',
        '  when ⚑ clicked',
        '    # note: the main loop',
        '    move [forward ▾] (10) steps',
        '    do [glide to the top] for (1) seconds',
        '    repeat (3) times',
        '      turn [left ▾] (90) degrees',
        '      wait ([a moment]) seconds',
        '    if <[I touch a coin]> then',
        '      change [score ▾] by (1)',
        '    go to (Coin)',
        '    say "Yay" for (2) seconds',
        '    make a copy of (me)',
        'Script 2:',
        '  when <[the score reaches 10]>',
        '    do [stop the whole game]',
      ].join('\n'),
    );
  });

  it('keeps ids, positions, comments and loose blocks', () => {
    const p = migrateProject(oldProject());
    const tops = (p.sprites[0].blocks!.blocks as { blocks: Array<JsonBlock & { x: number; y: number }> }).blocks;
    expect(tops.map((b) => [b.type, b.id, b.x, b.y])).toEqual([
      ['ev_start', 'id-ev_start', 40, 60],
      ['ev_when', 'id-ev_when', 300, 20],
      ['lo_hide', 'id-lo_hide', 10, 400],
    ]);
    expect(tops[0].next!.block.id).toBe('id-mo_move');
  });

  it('leaves new projects alone', () => {
    const p = newProject('3d');
    expect(migrateProject(p)).toBe(p);
    const migrated = migrateProject(oldProject());
    expect(migrateProject(migrated)).toBe(migrated);
  });
});
