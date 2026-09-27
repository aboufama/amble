import { describe, expect, it } from 'vitest';
import { BLOCKS, BLOCK_BY_TYPE, CHARACTER_SPECIAL_LABELS, MENU_CHOICES, labelInputs } from '../src/blocks/spec';
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
  namedFields,
  procedureNames,
  renameVariableDeclaration,
  variablesFor,
  type MenuContext,
  type MenuOption,
} from '../src/blocks/menus';
import { serializeBlocks } from '../src/compiler/serialize';
import { block, character, newProject, variable, workspace } from '../src/project/defaults';
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
    [block('ev_start'), block('cp_make', { WHO: character('Dog') }), block('mem_set', { VARIABLE: 'speed', VALUE: '4' }), block('mv_goto', { WHO: 'Dog' })],
  );
  const dog = { ...structuredClone(cat), id: 'dog', name: 'Dog', variables: [] as string[] };
  dog.blocks = workspace([block('ev_start'), block('ev_broadcast', { MESSAGE: 'go' }), block('lo_costume', { COSTUME: 'cat-b' }), block('mv_point', { WHO: character('Cat') })]);
  p.sprites.push(dog);
  p.stage.blocks = workspace([block('ev_start'), block('mem_change', { VARIABLE: 'score', AMOUNT: 1 }), block('lk_say', { TEXT: variable('score') })]);
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

describe('block language', () => {
  it('describes every input in the label, with a default', () => {
    for (const spec of BLOCKS) {
      expect(labelInputs(spec.label).sort(), spec.type).toEqual(Object.keys(spec.inputs ?? {}).sort());
      for (const [name, input] of Object.entries(spec.inputs ?? {})) {
        if (input.kind !== 'condition') expect(input.default, `${spec.type}.${name}`).toBeDefined();
        if (input.kind === 'menu') expect(input.menu, `${spec.type}.${name}`).toBeDefined();
        if (input.kind === 'character') expect(input.specials?.length, `${spec.type}.${name}`).toBeGreaterThan(0);
      }
      if (spec.shape === 'reporter') expect(spec.output, spec.type).toBeDefined();
    }
  });

  it('uses fixed-choice defaults that are options', () => {
    for (const spec of BLOCKS) {
      for (const [name, input] of Object.entries(spec.inputs ?? {})) {
        if (input.kind === 'menu' && (MENU_CHOICES[input.menu!] || input.menu === 'key')) {
          expect(values(menuOptions(input.menu!, null)), `${spec.type}.${name}`).toContain(input.default);
        }
        if (input.kind === 'character') expect(input.specials, `${spec.type}.${name}`).toContain(input.default);
      }
    }
  });

  it('knows which fields name things, for renames', () => {
    expect(namedFields('mem_set')).toEqual([['VARIABLE', 'variable']]);
    expect(namedFields('char_ref')).toEqual([['NAME', 'character']]);
    expect(namedFields('char_menu')).toEqual([['NAME', 'character']]);
    expect(namedFields('mem_var')).toEqual([['VARIABLE', 'variable']]);
    expect(namedFields('ga_do')).toEqual([]);
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

  it('lists backdrops, then next / previous / random', () => {
    expect(values(menuOptions('switchBackdrop', ctx(p, cat.id)))).toEqual(['day', 'night', 'next backdrop', 'previous backdrop', 'random backdrop']);
  });

  it('offers Scratch’s keys', () => {
    const keys = values(menuOptions('key', null));
    expect(keys.slice(0, 6)).toEqual(['space', 'up arrow', 'down arrow', 'right arrow', 'left arrow', 'any']);
    expect(keys).toEqual(KEY_OPTIONS);
  });

  it('lists the characters a slot allows: its specials, then the other sprites', () => {
    expect(menuOptions('character', ctx(p, cat.id), '', ['random', 'mouse', 'center'])).toEqual([
      ['a random spot', 'random'],
      ['the mouse', 'mouse'],
      ['the center', 'center'],
      ['Dog', 'Dog'],
    ]);
    // The stage isn't a character: no "me" there.
    expect(values(menuOptions('character', ctx(p, p.stage.id), '', ['me']))).toEqual(['Cat', 'Dog']);
    // Characters the compiler added can be named too.
    const withCompiled = structuredClone(p);
    withCompiled.compiled = { createdAt: 0, model: '', mode: '2d', inputHash: '', summary: '', howToPlay: '', warnings: [], code: [], assets: [], sprites: [{ id: 'c', name: 'Moon', description: '', x: 0, y: 0, z: 0, size: 100, direction: 0, visible: true, rotationStyle: 'all around' }] };
    expect(values(menuOptions('character', ctx(withCompiled, cat.id), '', ['me']))).toEqual(['me', 'Dog', 'Moon']);
    expect(CHARACTER_SPECIAL_LABELS.anyone).toBe('anyone');
  });

  it('has fixed choices for directions, controls, comparisons and more', () => {
    expect(values(menuOptions('direction', null))).toEqual(['right', 'left', 'up', 'down', 'forward', 'backward']);
    expect(values(menuOptions('controls', null))).toEqual(['arrow keys', 'left and right arrows', 'WASD', 'A and D', 'the mouse']);
    expect(values(menuOptions('compare', null))).toEqual(['>', '<', '=']);
    expect(values(menuOptions('math', null))).toEqual(['+', '-', '×', '÷']);
    expect(values(menuOptions('layer', null))).toEqual(['front', 'back']);
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

  it('lists the skills made in the edited sprite', () => {
    expect(procedureNames(ctx(p, cat.id))).toEqual(['jump']);
    expect(values(menuOptions('procedure', ctx(p, cat.id)))).toEqual(['jump']);
  });

  it('never offers an empty menu', () => {
    const bare = newProject('3d');
    bare.sprites[0].sounds = [];
    expect(values(menuOptions('sound', ctx(bare, bare.sprites[0].id), 'boing'))).toEqual(['boing', RECORD_SOUND]);
    expect(values(menuOptions('costume', ctx(bare, bare.stage.id)))).toEqual(['costume1']);
  });
});

describe('palette defaults', () => {
  it('match Scratch (second costume and backdrop, last sound)', () => {
    const p = project();
    const c = ctx(p, p.sprites[0].id);
    expect(menuDefault('costume', c, 'x')).toBe('cat-b');
    expect(menuDefault('switchBackdrop', c, 'x')).toBe('night');
    expect(menuDefault('sound', c, 'x')).toBe('purr');
    expect(menuDefault('message', c, 'x')).toBe('go');
    expect(menuDefault('variable', c, 'x')).toBe('score');
    expect(menuDefault('direction', c, '')).toBe('right');
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
  });

  it('renames sounds in their sprite, and sprites on every character block', () => {
    const p = project();
    applyRename(p, { kind: 'sound', targetId: p.sprites[0].id, from: 'meow', to: 'miaow' });
    expect(fieldsOf(p, p.sprites[0].id, 'so_play', 'SOUND')).toEqual(['miaow']);
    applyRename(p, { kind: 'sprite', targetId: 'dog', from: 'Dog', to: 'Puppy' });
    // Dropped character blocks and picked characters both follow.
    expect(fieldsOf(p, p.sprites[0].id, 'char_ref', 'NAME')).toEqual(['Puppy']);
    expect(fieldsOf(p, p.sprites[0].id, 'char_menu', 'NAME')).toEqual(['me', 'Puppy']);
    expect(fieldsOf(p, 'dog', 'char_ref', 'NAME')).toEqual(['Cat']);
  });

  it('renames and deletes variables for all sprites or one sprite', () => {
    const p = project();
    const cat = p.sprites[0];
    applyRename(p, renameVariableDeclaration(p, p.stage.id, 'score', 'points'));
    expect(p.variables).toEqual(['points']);
    expect(fieldsOf(p, p.stage.id, 'mem_change', 'VARIABLE')).toEqual(['points']);
    // Variable blocks dropped in slots follow too.
    expect(fieldsOf(p, p.stage.id, 'mem_var', 'VARIABLE')).toEqual(['points']);
    applyRename(p, renameVariableDeclaration(p, cat.id, 'speed', 'pace'));
    expect(cat.variables).toEqual(['pace']);
    expect(fieldsOf(p, cat.id, 'mem_set', 'VARIABLE')).toEqual(['pace']);
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
  it('marks picked values as exact names', () => {
    const p = project();
    const { text } = serializeBlocks(p.sprites[0].blocks);
    expect(text).toContain('when I hear [start ▾]');
    expect(text).toContain('switch costume to [cat-b ▾]');
    expect(text).toContain('switch backdrop to [night ▾]');
    expect(text).toContain('play sound [meow ▾]');
    expect(text).toContain('make a copy of (Dog)');
    expect(text).toContain('set [speed ▾] to "4"');
    expect(text).toContain('skill [jump]');
    expect(text).toContain('go to (Dog)');
  });

  it('keeps values that are no longer options (old projects)', () => {
    const { text } = serializeBlocks(workspace([block('ev_start'), block('so_play', { SOUND: 'a sound I never made' })]));
    expect(text).toContain('play sound [a sound I never made ▾]');
  });
});

describe('starter projects', () => {
  it('only use dropdown values that are options', () => {
    for (const p of [newProject('2d'), newProject('3d'), starCatcher(), coinHills()]) {
      for (const t of [p.stage, ...p.sprites]) {
        forEachBlock(t.blocks, (b) => {
          for (const [field, input] of Object.entries(BLOCK_BY_TYPE.get(b.type)?.inputs ?? {})) {
            if (input.kind !== 'menu') continue;
            const options = values(menuOptions(input.menu!, { project: p, target: t }));
            expect(options, `${p.title} ${t.name} ${b.type}.${field}`).toContain(b.fields?.[field]);
          }
        });
      }
    }
  });
});

describe('character menus', () => {
  it('are never empty (the stage, with no sprites to name)', () => {
    const p = newProject('2d');
    p.sprites = [];
    expect(menuOptions('character', { project: p, target: p.stage }, 'me', ['me'])).toEqual([['me', 'me']]);
  });
});
