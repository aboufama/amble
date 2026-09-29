import { describe, expect, it } from 'vitest';
import { applyPatch, opsFromReply } from '../../src/ai/patch/apply';
import { applyEdits } from '../../src/ai/patch/edits';
import { parsePatch } from '../../src/ai/patch/parse';
import { validateGame } from '../../src/ai/validate/validate';
import { PROBE_MANIFEST } from './fixtures/probeManifest';

const BOSS = `class Boss {
  constructor(scene) {
    this.scene = scene;
    this.hp = 100;
  }

  attack() {
    if (this.hp < 50) {
      this.rage();
    }
  }

  rage() {
    this.speed = 2;
  }
}
`;

describe('applyEdits', () => {
  it('applies exact edits in order', () => {
    const r = applyEdits(BOSS, [
      { find: '    this.hp = 100;', replace: '    this.hp = 150;' },
      { find: '    this.speed = 2;', replace: '    this.speed = 3;\n    this.scene.fx.shake();' },
    ]);
    expect(r).toEqual({ ok: true, fuzzy: 0, content: BOSS.replace('this.hp = 100;', 'this.hp = 150;').replace('    this.speed = 2;', '    this.speed = 3;\n    this.scene.fx.shake();') });
  });

  it('matches through different indentation and re-indents the replacement', () => {
    const r = applyEdits(BOSS, [{ find: 'if (this.hp < 50) {\n  this.rage();\n}', replace: 'if (this.hp < 60) {\n  this.rage();\n  this.roar();\n}' }]);
    expect(r.ok && r.fuzzy).toBe(1);
    expect(r.ok && r.content).toContain('    if (this.hp < 60) {\n      this.rage();\n      this.roar();\n    }');
  });

  it('matches through trailing spaces and missing blank lines', () => {
    const r = applyEdits(BOSS, [{ find: '  }   \n  attack() {', replace: '  }\n\n  attack(target) {' }]);
    expect(r.ok && r.content).toContain('  attack(target) {');
    const tabs = applyEdits('function f() {\n\tif (a) {\n\t\tb();\n\t}\n}\n', [{ find: '    if (a) {\n        b();\n    }', replace: '    if (a) {\n        c();\n    }' }]);
    expect(tabs.ok && tabs.content).toBe('function f() {\n\tif (a) {\n\t\tc();\n\t}\n}\n');
  });

  it('deletes whole lines without leaving a blank line', () => {
    const r = applyEdits('a\nb\nc\n', [{ find: 'b', replace: '' }]);
    expect(r.ok && r.content).toBe('a\nc\n');
  });

  it('refuses a short find that matches more than once, and resolves a longer one by position', () => {
    const text = 'x = 1;\ny = 2;\nx = 1;\ny = 2;\n';
    expect(applyEdits(text, [{ find: 'x = 1;', replace: 'x = 5;' }])).toMatchObject({ ok: false, failure: { index: 0, reason: 'ambiguous', message: expect.stringMatching(/appears 2 times/) } });
    const r = applyEdits(text, [
      { find: 'x = 1;\ny = 2;', replace: 'first();' },
      { find: 'x = 1;\ny = 2;', replace: 'second();' },
    ]);
    expect(r.ok && r.content).toBe('first();\nsecond();\n');
  });

  it('fails clearly when a find is missing or empty', () => {
    expect(applyEdits(BOSS, [{ find: '  jump() {', replace: '' }])).toMatchObject({ ok: false, failure: { reason: 'not-found', message: 'Edit 1: the @@find text is not in the file (it starts "jump() {").' } });
    expect(applyEdits(BOSS, [{ find: '  \n', replace: 'x' }])).toMatchObject({ ok: false, failure: { reason: 'empty-find' } });
  });

  it('normalizes CRLF', () => {
    expect(applyEdits('a\r\nb\r\n', [{ find: 'a\r\nb', replace: 'c' }])).toEqual({ ok: true, content: 'c\n', fuzzy: 0 });
  });
});

describe('applyPatch', () => {
  const files = [
    { path: 'game.js', content: 'class Game extends Amble.Scene {\n  create() {}\n}\n' },
    { path: 'boss.js', content: BOSS },
    { path: 'old.js', content: 'const OLD = 1;\n' },
  ];

  it('creates, edits and deletes, keeping game.js last', () => {
    const r = applyPatch(files, parsePatch(['@@amble-patch 1', '@@file aa.js create', 'const AA = 1;', '@@file boss.js edit', '@@find', '    this.hp = 100;', '@@replace', '    this.hp = 200;', '@@done', '@@file old.js delete', '@@end'].join('\n')).ops);
    expect(r.failures).toEqual([]);
    expect(r.files.map((f) => f.path)).toEqual(['aa.js', 'boss.js', 'game.js']);
    expect(r).toMatchObject({ created: ['aa.js'], changed: ['boss.js'], deleted: ['old.js'] });
    expect(r.files[1].content).toContain('this.hp = 200;');
    // The input is untouched.
    expect(files[1].content).toBe(BOSS);
  });

  it('keeps the other files when one file does not apply, for a whole-file resend', () => {
    const r = applyPatch(files, [
      { action: 'replace', path: 'boss.js', content: 'class Boss {}\n' },
      { action: 'edit', path: 'boss.js', edits: [{ find: 'nothing like this', replace: 'x' }], malformed: [] },
      { action: 'create', path: 'new.js', content: 'const N = 1;\n' },
    ]);
    expect(r.failures).toEqual([{ path: 'boss.js', reason: 'not-found', edit: 0, message: 'boss.js: Edit 1: the @@find text is not in the file (it starts "nothing like this").' }]);
    expect(r.files.find((f) => f.path === 'boss.js')?.content).toBe(BOSS);
    expect(r.created).toEqual(['new.js']);
    expect(r.changed).toEqual([]);
  });

  it('never deletes game.js, rejects unsafe names, and explains other odd operations', () => {
    const r = applyPatch(files, [
      { action: 'delete', path: 'game.js' },
      { action: 'create', path: '../outside.js', content: 'x' },
      { action: 'create', path: 'boss.js', content: 'class Boss {}\n' },
      { action: 'replace', path: 'fresh.js', content: 'y\n' },
      { action: 'edit', path: 'ghost.js', edits: [{ find: 'a', replace: 'b' }], malformed: [] },
      { action: 'delete', path: 'gone.js' },
      { action: 'edit', path: 'old.js', edits: [], malformed: ['a @@find without @@replace'] },
    ]);
    expect(r.failures.map((f) => [f.path, f.reason])).toEqual([
      ['game.js', 'delete-entry'],
      ['../outside.js', 'bad-path'],
      ['ghost.js', 'missing-file'],
      ['old.js', 'malformed'],
    ]);
    expect(r.warnings).toEqual(['boss.js already existed; replaced it.', "fresh.js didn't exist; created it.", 'gone.js was already gone.']);
    expect(r.files.map((f) => f.path)).toEqual(['boss.js', 'fresh.js', 'old.js', 'game.js']);
  });

  it('turns strict-JSON replies into the same operations', () => {
    const ops = opsFromReply({ files: [{ path: 'game.js', content: 'x' }], edits: [{ path: 'boss.js', ops: [{ find: 'this.hp = 100;', replace: 'this.hp = 1;' }] }], deleted: ['old.js'] });
    const r = applyPatch(files, ops);
    expect(r.failures).toEqual([]);
    expect(r.files.map((f) => [f.path, f.content.slice(0, 20)])).toEqual([
      ['boss.js', 'class Boss {\n  const'],
      ['game.js', 'x\n'],
    ]);
  });
});

describe('from reply to a valid game', () => {
  it('parses a streamed patch, applies it and validates the result', () => {
    const reply = [
      '@@amble-patch 1',
      '@@summary Blobs now bounce.',
      '@@safety ok',
      '@@file game.js create',
      'class Game extends Amble.Scene {',
      "  static art = { hero: { kind: 'character', ask: 'Draw your hero' }, blob: { kind: 'character', ask: 'Draw a blob' } };",
      '  create() {',
      "    this.hero = this.spawnHero(100, 400, 'hero').platformer();",
      "    this.every(1000, () => this.spawnEnemy(this.rand(0, 900), 0, 'blob').patrol(80));",
      '  }',
      '}',
      '@@end',
    ].join('\n');
    const patch = parsePatch(reply);
    const applied = applyPatch([], patch.ops);
    const checked = validateGame(applied.files, { manifest: PROBE_MANIFEST });
    expect(checked.errors).toEqual([]);
    expect(checked.art.missing).toEqual([]);
  });
});
