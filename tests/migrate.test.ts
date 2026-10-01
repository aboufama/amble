import { describe, expect, it } from 'vitest';
import { migrateProject } from '../src/project/migrate';
import { readProjectFile, readSpriteFile } from '../src/project/persistence';
import { buildRunPackage } from '../src/player/package';
import { serializeBlocks } from '../src/compiler/serialize';
import { newProject, newSprite } from '../src/project/defaults';
import type { JsonBlock } from '../src/project/defaults';
import type { CostumeAsset, Project } from '../src/project/types';

/** A 3D model costume, as projects saved before Amble was 2D only had them. */
const oldModel = (asset: { id: string; name: string; dataUrl?: string; recipe?: unknown }) => ({ ...asset, kind: 'model' }) as unknown as CostumeAsset;

/** A project saved with the old, Scratch-style blocks (free-text fields). */
function oldProject(): Project {
  const p = newProject();
  p.sprites.push(newSprite('Coin'));
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
    const p = newProject();
    expect(migrateProject(p)).toBe(p);
    const migrated = migrateProject(oldProject());
    expect(migrateProject(migrated)).toBe(migrated);
  });
});

/** A project saved when Amble also made 3D games: positions in meters, 3D models, and a game built for 3D. */
function saved3d(): Project {
  const p = newProject();
  p.mode = '3d';
  p.stage.costumes = [];
  const amble = p.sprites[0];
  const car = oldModel({ id: 'car', name: 'car', dataUrl: 'data:model/gltf-binary;base64,Z2xURg==' });
  Object.assign(amble, { x: 1.5, y: 0, z: -2, direction: 90, rotationStyle: 'all around', costumes: [...amble.costumes, car], currentCostume: 2 });
  p.sprites.push(newSprite('Rock', [oldModel({ id: 'rock', name: 'rock', recipe: { parts: [] } })]));
  p.compiled = { createdAt: 0, model: 'm', mode: '3d', inputHash: 'x', summary: '', howToPlay: '', warnings: [], code: [], sprites: [], assets: [], pieces: [] };
  return p;
}

describe('projects saved as 3D', () => {
  it('open as 2D, keeping their image costumes', async () => {
    const saved = saved3d();
    const p = await readProjectFile(new File([JSON.stringify(saved)], 'hills.amble'));
    expect(p.mode).toBe('2d');
    const [amble, rock] = p.sprites;
    // Image costumes stay as they were; 3D models go, and a sprite left without a costume gets Amble's.
    expect(amble.costumes).toEqual(saved.sprites[0].costumes.slice(0, 2));
    expect(amble.currentCostume).toBe(0);
    expect(rock.costumes.map((c) => [c.kind, c.name])).toEqual([['image', 'amble-a'], ['image', 'amble-b']]);
    // Positions convert the way the old 2D/3D switch did: 60 pixels to a meter, and the depth becomes the height.
    expect([amble.x, amble.y, amble.z, amble.direction, amble.rotationStyle]).toEqual([90, -120, 0, 0, 'left-right']);
    // The stage gets a blank backdrop, and the game built for 3D builds again.
    expect(p.stage.costumes.map((c) => c.name)).toEqual(['backdrop1']);
    expect(p.compiled).toBeNull();
    expect(buildRunPackage(p)).toMatchObject({ mode: '2d', targets: [{ name: 'Stage' }, { name: 'Amble', x: 90, y: -120, z: 0 }, { name: 'Rock' }] });
    expect(migrateProject(p)).toBe(p);
    // A sprite exported from it comes without its 3D models too.
    const sprite = await readSpriteFile(new File([JSON.stringify({ format: 'amble-sprite', version: 1, sprite: saved.sprites[0] })], 'amble.ambsprite'));
    expect(sprite.costumes.map((c) => c.name)).toEqual(['amble-a', 'amble-b']);
  });
});
