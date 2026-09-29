/**
 * File names from the AI helper are outside input: a world keeps only names of the §4.2 form
 * (`/^[a-z][a-z0-9-]{0,23}\.js$/`), and the .amble reader refuses any other, so a name the AI core let
 * through would make the student's saved world (and the copy they hand in) impossible to open. The patch
 * applier turns the names models like to write (camelCase, snake_case, a folder) into that form; kit files
 * never import each other by name, so the rename is safe.
 */
import { describe, expect, it } from 'vitest';
import { applyPatch, isSafeGamePath, validateGame } from '../../src/ai';
import { collectWorld, packAmble, readAmble } from '../../src/files/amble';
import { CODE_PATH_RE } from '../../src/model/ids';
import type { CodeFile } from '../../src/model/types';
import { MemoryStore } from '../../src/store/memory';
import { seedWorld } from '../files/fixtures';
import { PROBE_MANIFEST } from './fixtures/probeManifest';

const GAME = 'class Game extends Amble.Scene { create() {} }';

describe('file names the AI helper writes', () => {
  it('become names a world can keep', () => {
    const r = applyPatch(
      [{ path: 'game.js', content: GAME }],
      [
        { action: 'create', path: 'bossFight.js', content: 'const a = 1;' },
        { action: 'create', path: 'enemy_waves2.js', content: 'const b = 1;' },
        { action: 'create', path: 'levels/one.js', content: 'const c = 1;' },
        { action: 'edit', path: 'bossFight.js', edits: [{ find: 'const a = 1;', replace: 'const a = 2;' }], malformed: [] },
      ],
    );
    expect(r.failures).toEqual([]);
    expect(r.files.map((f) => f.path)).toEqual(['boss-fight.js', 'enemy-waves2.js', 'levels-one.js', 'game.js']);
    expect(r.files[0].content).toBe('const a = 2;');
    for (const f of r.files) expect(f.path).toMatch(CODE_PATH_RE);
  });

  it('keep a name the world already has, exactly', () => {
    const r = applyPatch([{ path: 'game.js', content: GAME }, { path: 'boss.js', content: 'const a = 1;' }], [{ action: 'replace', path: 'boss.js', content: 'const a = 3;' }]);
    expect(r.files.map((f) => f.path)).toEqual(['boss.js', 'game.js']);
  });

  it('follow one rule: what the AI core accepts is what a world keeps', () => {
    for (const p of ['game.js', 'boss.js', 'a-b.js', `${'x'.repeat(24)}.js`, 'Boss.js', 'boss_fight.js', 'levels/one.js', `${'x'.repeat(25)}.js`, '1boss.js', '-a.js']) {
      expect(isSafeGamePath(p), p).toBe(CODE_PATH_RE.test(p));
    }
    const v = validateGame([{ path: 'game.js', content: GAME }, { path: 'Boss_Fight.js', content: 'const a = 1;' }], { manifest: PROBE_MANIFEST });
    expect(v.errors.some((i) => i.rule === 'bad-path')).toBe(true);
  });

  it('a world with the AI helper files opens again from its .amble file', async () => {
    const store = new MemoryStore();
    const seed = await seedWorld(store);
    const r = applyPatch(
      seed.world.code.map((f) => ({ path: f.path, content: f.source })),
      [{ action: 'create', path: 'bossFight.js', content: 'const boss = 1;' }],
    );
    const code: CodeFile[] = r.files.map((f) => ({ path: f.path, source: f.content, authors: [['ai', f.content.split('\n').length]], locked: [] }));
    const world = { ...seed.world, code };
    await store.commit({ worlds: [world] });
    const opened = await readAmble(await packAmble(await collectWorld(store, world, 'world')));
    expect(opened.world?.code.map((f) => f.path)).toEqual(code.map((f) => f.path));
  });
});

describe('art keys the game declares', () => {
  const withArt = (key: string) =>
    `class Game extends Amble.Scene {\n  static art = { ${key}: { kind: 'character', rig: 'biped', role: 'hero', name: 'Pip', w: 40, h: 64 } };\n  create() {}\n}\n`;

  it('never borrow a name every object already has', () => {
    for (const key of ['constructor', 'prototype', 'toString', 'valueOf', 'hasOwnProperty']) {
      const v = validateGame([{ path: 'game.js', content: withArt(key) }], { manifest: PROBE_MANIFEST });
      expect(v.errors.some((i) => i.rule === 'art-manifest' && i.message.includes(key)), key).toBe(true);
    }
    const ok = validateGame([{ path: 'game.js', content: withArt('hero') }], { manifest: PROBE_MANIFEST });
    expect(ok.errors.filter((i) => i.rule === 'art-manifest')).toEqual([]);
  });

  it('a drawn member keyed like that could not be opened again from the world file', async () => {
    const store = new MemoryStore();
    const seed = await seedWorld(store);
    const world = { ...seed.world, cast: { ...seed.world.cast, constructor: { key: 'constructor', art: null, madeBy: null, extra: null, laterUntil: 0 } } };
    await store.commit({ worlds: [world] });
    await expect(readAmble(await packAmble(await collectWorld(store, world, 'world')))).rejects.toMatchObject({ kind: 'damaged' });
  });
});
