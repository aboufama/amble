import { describe, expect, it } from 'vitest';
import { BLOCKS, BLOCK_BY_TYPE, labelFields } from '../src/blocks/spec';
import {
  DELETE_VARIABLE,
  KEY_OPTIONS,
  NEW_MESSAGE,
  RECORD_SOUND,
  RENAME_VARIABLE,
  SEPARATOR,
  applyRename,
  deleteVariableDeclaration,
  forEachBlock,
  globalVariables,
  menuDefault,
  menuOptions,
  procedureNames,
  renameVariableDeclaration,
  variablesFor,
  type MenuContext,
  type MenuOption,
} from '../src/blocks/menus';
import { serializeBlocks } from '../src/compiler/serialize';
import { buildUserPrompt, classNames, systemPrompt } from '../src/compiler/prompt';
import { block, newProject, workspace } from '../src/project/defaults';
import { coinHills, starCatcher } from '../src/project/examples';
import type { ImageAsset, Project, SoundAsset } from '../src/project/types';

const image = (name: string): ImageAsset => ({
  id: name,
  name,
  kind: 'image',
  dataUrl: 'data:image/svg+xml;base64,AAAA',
  mime: 'image/svg+xml',
  width: 10,
  height: 10,
  resolution: 1,
  centerX: 5,
  centerY: 5,
});
const sound = (name: string): SoundAsset => ({ id: name, name, kind: 'sound', dataUrl: 'data:audio/wav;base64,AAAA', mime: 'audio/wav', duration: 1 });

/** A project with a stage, a cat and a dog. */
function project(): Project {
  const p = newProject('2d');
  p.variables = ['score'];
  p.stage.costumes = [image('day'), image('night')];
  const cat = p.sprites[0];
  cat.name = 'Cat';
  cat.costumes = [image('cat-a'), image('cat-b'), image('cat-c')];
  cat.sounds = [sound('meow'), sound('purr')];
  cat.variables = ['speed'];
  cat.blocks = workspace(
    [block('ev_receive', { MESSAGE: 'start' }), block('lo_costume', { COSTUME: 'cat-b' }), block('lo_backdrop', { BACKDROP: 'night' })],
    [block('pr_define', { NAME: 'jump' }), block('so_play', { SOUND: 'meow' })],
    [block('ev_start'), block('co_create_clone', { WHAT: 'Dog' }), block('va_set', { VARIABLE: 'speed', VALUE: '4' })],
  );
  const dog = { ...structuredClone(cat), id: 'dog', name: 'Dog', variables: [] as string[] };
  dog.blocks = workspace([block('ev_start'), block('ev_broadcast', { MESSAGE: 'go' }), block('lo_costume', { COSTUME: 'cat-b' }), block('co_create_clone', { WHAT: 'Cat' })]);
  p.sprites.push(dog);
  p.stage.blocks = workspace([block('ev_backdrop', { BACKDROP: 'night' }), block('va_change', { VARIABLE: 'score', AMOUNT: '1' })]);
  return p;
}

const ctx = (p: Project, targetId: string): MenuContext => ({ project: p, target: [p.stage, ...p.sprites].find((t) => t.id === targetId) ?? null });
const values = (options: MenuOption[]) => options.filter((o) => o !== SEPARATOR).map((o) => (o as [string, string])[1]);
const fieldsOf = (p: Project, targetId: string, type: string, field: string) => {
  const out: string[] = [];
  forEachBlock([p.stage, ...p.sprites].find((t) => t.id === targetId)!.blocks, (b) => {
    if (b.type === type) out.push(String(b.fields?.[field]));
  });
  return out;
};

describe('block spec', () => {
  it('describes every dropdown in the label and gives it a default', () => {
    for (const spec of BLOCKS) {
      const fields = labelFields(spec.label);
      for (const name of Object.keys(spec.menus ?? {})) {
        expect(fields, `${spec.type}.${name}`).toContain(name);
        expect(spec.fields?.[name], `${spec.type}.${name}`).toBeTruthy();
      }
      for (const name of fields) expect(spec.fields?.[name], `${spec.type}.${name}`).toBeDefined();
    }
  });

  it('uses fixed-choice defaults that are options', () => {
    for (const spec of BLOCKS) {
      for (const [name, menu] of Object.entries(spec.menus ?? {})) {
        if (!['key', 'stop', 'rotation', 'layer', 'effect'].includes(menu.kind)) continue;
        expect(values(menuOptions(menu.kind, null)), `${spec.type}.${name}`).toContain(spec.fields![name]);
      }
    }
  });
});

describe('dropdown options', () => {
  const p = project();
  const cat = p.sprites[0];

  it('lists the edited sprite’s costumes and sounds', () => {
    expect(values(menuOptions('costume', ctx(p, cat.id)))).toEqual(['cat-a', 'cat-b', 'cat-c']);
    // Then Scratch's "record...", which opens the recorder.
    expect(menuOptions('sound', ctx(p, cat.id))).toEqual([['meow', 'meow'], ['purr', 'purr'], ['record...', RECORD_SOUND]]);
    // The stage's "costumes" are its backdrops.
    expect(values(menuOptions('costume', ctx(p, p.stage.id)))).toEqual(['day', 'night']);
  });

  it('lists backdrops, with next/previous/random for "switch backdrop to"', () => {
    expect(values(menuOptions('backdrop', ctx(p, cat.id)))).toEqual(['day', 'night']);
    expect(values(menuOptions('switchBackdrop', ctx(p, cat.id)))).toEqual(['day', 'night', 'next backdrop', 'previous backdrop', 'random backdrop']);
  });

  it('offers Scratch’s keys', () => {
    const keys = values(menuOptions('key', null));
    expect(keys.slice(0, 6)).toEqual(['space', 'up arrow', 'down arrow', 'right arrow', 'left arrow', 'any']);
    expect(keys).toContain('a');
    expect(keys).toContain('z');
    expect(keys).toContain('0');
    expect(keys).toContain('9');
    expect(keys).toEqual(KEY_OPTIONS);
  });

  it('clones myself or another sprite (the stage has no "myself")', () => {
    expect(values(menuOptions('clone', ctx(p, cat.id)))).toEqual(['myself', 'Dog']);
    expect(values(menuOptions('clone', ctx(p, p.stage.id)))).toEqual(['Cat', 'Dog']);
  });

  it('has Scratch’s fixed choices', () => {
    expect(values(menuOptions('stop', ctx(p, cat.id)))).toEqual(['all', 'this script', 'other scripts in sprite']);
    expect(values(menuOptions('stop', ctx(p, p.stage.id)))).toEqual(['all', 'this script', 'other scripts in stage']);
    expect(values(menuOptions('rotation', null))).toEqual(['left-right', "don't rotate", 'all around']);
    expect(values(menuOptions('layer', null))).toEqual(['front', 'back']);
    expect(values(menuOptions('effect', null))).toEqual(['color', 'fisheye', 'whirl', 'pixelate', 'mosaic', 'brightness', 'ghost']);
  });

  it('collects messages from every sprite, then "New message"', () => {
    expect(menuOptions('message', ctx(p, cat.id))).toEqual([['go', 'go'], ['start', 'start'], ['New message', NEW_MESSAGE]]);
    // The editor's unsaved blocks count, and so do messages made with "New message".
    const live = { ...ctx(p, cat.id), liveBlocks: workspace([block('ev_broadcast', { MESSAGE: 'boom' })]), newMessages: ['zap'] };
    expect(values(menuOptions('message', live))).toEqual(['boom', 'go', 'zap', NEW_MESSAGE]);
    const empty = newProject('2d');
    expect(values(menuOptions('message', ctx(empty, empty.sprites[0].id)))).toEqual(['message1', NEW_MESSAGE]);
  });

  it('lists variables for all sprites plus the sprite’s own, then rename and delete', () => {
    expect(menuOptions('variable', ctx(p, cat.id), 'speed')).toEqual([
      ['score', 'score'],
      ['speed', 'speed'],
      ['Rename variable', RENAME_VARIABLE],
      ['Delete the "speed" variable', DELETE_VARIABLE],
    ]);
    expect(values(menuOptions('variable', ctx(p, p.stage.id)))).toEqual(['score', RENAME_VARIABLE, DELETE_VARIABLE]);
  });

  it('lists the custom blocks defined in the edited sprite', () => {
    expect(procedureNames(ctx(p, cat.id))).toEqual(['jump']);
    expect(values(menuOptions('procedure', ctx(p, cat.id)))).toEqual(['jump']);
  });

  it('never offers an empty menu', () => {
    const bare = newProject('3d');
    bare.sprites[0].sounds = [];
    expect(values(menuOptions('sound', ctx(bare, bare.sprites[0].id), 'boing'))).toEqual(['boing', RECORD_SOUND]);
    expect(values(menuOptions('backdrop', ctx(bare, bare.sprites[0].id)))).toEqual(['backdrop1']);
  });
});

describe('palette defaults', () => {
  it('match Scratch (second costume and backdrop, last sound, myself)', () => {
    const p = project();
    const c = ctx(p, p.sprites[0].id);
    expect(menuDefault('costume', c, 'x')).toBe('cat-b');
    expect(menuDefault('switchBackdrop', c, 'x')).toBe('night');
    expect(menuDefault('sound', c, 'x')).toBe('purr');
    expect(menuDefault('clone', c, 'x')).toBe('myself');
    expect(menuDefault('message', c, 'x')).toBe('go');
    expect(menuDefault('variable', c, 'x')).toBe('score');
    expect(menuDefault('stop', c, 'x')).toBe('all');
  });
});

describe('renaming', () => {
  it('renames a costume only in its own sprite', () => {
    const p = project();
    const [cat, dog] = p.sprites;
    applyRename(p, { kind: 'costume', targetId: cat.id, from: 'cat-b', to: 'cat-jump' });
    expect(fieldsOf(p, cat.id, 'lo_costume', 'COSTUME')).toEqual(['cat-jump']);
    expect(fieldsOf(p, dog.id, 'lo_costume', 'COSTUME')).toEqual(['cat-b']);
  });

  it('renames a backdrop everywhere it is used', () => {
    const p = project();
    applyRename(p, { kind: 'costume', targetId: p.stage.id, from: 'night', to: 'midnight' });
    expect(fieldsOf(p, p.sprites[0].id, 'lo_backdrop', 'BACKDROP')).toEqual(['midnight']);
    expect(fieldsOf(p, p.stage.id, 'ev_backdrop', 'BACKDROP')).toEqual(['midnight']);
  });

  it('renames sounds in their sprite and sprites in clone blocks', () => {
    const p = project();
    applyRename(p, { kind: 'sound', targetId: p.sprites[0].id, from: 'meow', to: 'miaow' });
    expect(fieldsOf(p, p.sprites[0].id, 'so_play', 'SOUND')).toEqual(['miaow']);
    applyRename(p, { kind: 'sprite', targetId: 'dog', from: 'Dog', to: 'Puppy' });
    expect(fieldsOf(p, p.sprites[0].id, 'co_create_clone', 'WHAT')).toEqual(['Puppy']);
    expect(fieldsOf(p, 'dog', 'co_create_clone', 'WHAT')).toEqual(['Cat']);
  });

  it('renames and deletes variables for all sprites or one sprite', () => {
    const p = project();
    const cat = p.sprites[0];
    applyRename(p, renameVariableDeclaration(p, p.stage.id, 'score', 'points'));
    expect(p.variables).toEqual(['points']);
    expect(fieldsOf(p, p.stage.id, 'va_change', 'VARIABLE')).toEqual(['points']);
    applyRename(p, renameVariableDeclaration(p, cat.id, 'speed', 'pace'));
    expect(cat.variables).toEqual(['pace']);
    expect(fieldsOf(p, cat.id, 'va_set', 'VARIABLE')).toEqual(['pace']);
    deleteVariableDeclaration(p, cat.id, 'pace');
    expect(variablesFor(p, cat)).toEqual(['points']);
  });

  it('finds the variables of projects saved before variables were declared', () => {
    const p = project();
    delete p.variables;
    expect(globalVariables(p)).toEqual(['score']);
  });
});

describe('dropdowns for the compiler', () => {
  it('marks picked values so the AI knows they are exact names', () => {
    const p = project();
    const { text } = serializeBlocks(p.sprites[0].blocks);
    expect(text).toContain('when I receive [start ▾]');
    expect(text).toContain('switch costume to [cat-b ▾]');
    expect(text).toContain('switch backdrop to [night ▾]');
    expect(text).toContain('start sound [meow ▾]');
    expect(text).toContain('create clone of [Dog ▾]');
    expect(text).toContain('set [speed ▾] to [4]');
    expect(text).toContain('define [jump]');
  });

  it('keeps values that are no longer options (old projects)', () => {
    const { text } = serializeBlocks(workspace([block('ev_start'), block('co_stop', { WHAT: 'the game' }), block('so_play', { SOUND: 'a sound I never made' })]));
    expect(text).toContain('stop [the game ▾]');
  });

  it('explains dropdown values and lists variables', () => {
    expect(systemPrompt('2d')).toContain('like [costume2 ▾], was picked from a dropdown menu');
    const p = project();
    const prompt = buildUserPrompt(p, classNames(p));
    expect(prompt).toContain('Variables for all sprites: "score"');
    expect(prompt).toContain('Variables for this sprite only: "speed"');
  });
});

describe('starter projects', () => {
  it('only use dropdown values that are options', () => {
    for (const p of [newProject('2d'), newProject('3d'), starCatcher(), coinHills()]) {
      for (const t of [p.stage, ...p.sprites]) {
        forEachBlock(t.blocks, (b) => {
          for (const [field, menu] of Object.entries(BLOCK_BY_TYPE.get(b.type)?.menus ?? {})) {
            const options = values(menuOptions(menu.kind, { project: p, target: t }));
            expect(options, `${p.title} ${t.name} ${b.type}.${field}`).toContain(b.fields?.[field]);
          }
        });
      }
    }
  });
});
