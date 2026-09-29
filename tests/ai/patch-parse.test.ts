import { describe, expect, it } from 'vitest';
import { parsePatch, PatchParser } from '../../src/ai/patch/parse';
import type { FileOp, PatchEvent } from '../../src/ai/patch/types';
import { peekStaticLiteral } from '../../src/ai/validate/statics';

const GAME = `class Game extends Amble.Scene {
  static art = { hero: { kind: 'character', ask: 'Draw Rae' }, boss: { kind: 'character', ask: 'Draw the Moon King' } };
  create() {
    this.hero = this.spawnHero(140, 420, 'hero');
  }
}`;

const FULL = [
  'Sure! Here is the change:',
  '```text',
  '@@amble-patch 1',
  '@@summary The Moon King now splits into three baby moons.',
  '@@play Arrows move, Space jumps.',
  '@@next Add a shield | Make it night | A second boss',
  '@@safety toned-down: I made the swords foam swords.',
  '@@file game.js create',
  GAME,
  '',
  '@@file boss.js edit',
  '@@find',
  '  split() {',
  '    return 1;',
  '@@replace',
  '  split() {',
  '    return 3;',
  '@@done',
  '@@find',
  '  const hp = 100;',
  '@@replace',
  '  const hp = 150;',
  '@@done',
  '@@file old.js delete',
  '@@end',
  '```',
  'Have fun!',
].join('\n');

const EXPECTED_OPS: FileOp[] = [
  { action: 'create', path: 'game.js', content: `${GAME}\n` },
  {
    action: 'edit',
    path: 'boss.js',
    edits: [
      { find: '  split() {\n    return 1;', replace: '  split() {\n    return 3;' },
      { find: '  const hp = 100;', replace: '  const hp = 150;' },
    ],
    malformed: [],
  },
  { action: 'delete', path: 'old.js' },
];

describe('parsing a whole reply', () => {
  it('reads headers and file blocks, ignoring prose and fences around the envelope', () => {
    const p = parsePatch(FULL);
    expect(p).toMatchObject({
      version: 1,
      summary: 'The Moon King now splits into three baby moons.',
      play: 'Arrows move, Space jumps.',
      next: ['Add a shield', 'Make it night', 'A second boss'],
      safety: { status: 'toned-down', note: 'I made the swords foam swords.' },
      complete: true,
      truncatedIn: null,
      warnings: [],
    });
    expect(p.ops).toEqual(EXPECTED_OPS);
  });

  it('gives the same result whatever the chunk size, CRLF included', () => {
    for (const text of [FULL, FULL.replace(/\n/g, '\r\n')]) {
      for (const size of [1, 2, 3, 7, 64, 4096]) {
        const parser = new PatchParser();
        for (let i = 0; i < text.length; i += size) parser.feed(text.slice(i, i + size));
        expect(parser.end().ops, `chunk ${size}`).toEqual(EXPECTED_OPS);
      }
    }
  });

  it('reports progress events as blocks arrive', () => {
    const parser = new PatchParser();
    const events: PatchEvent[] = [];
    for (const line of FULL.split('\n')) events.push(...parser.feed(`${line}\n`));
    parser.end();
    const kinds = events.map((e) => (e.type === 'file' ? `file:${e.path}:${e.action}` : e.type === 'fileDone' ? `done:${e.op.path}` : e.type === 'header' ? `header:${e.name}` : e.type));
    expect(kinds.filter((k) => k !== 'lines')).toEqual([
      'start',
      'header:summary',
      'header:play',
      'header:next',
      'header:safety',
      'file:game.js:create',
      'done:game.js',
      'file:boss.js:edit',
      'file:old.js:delete',
      'done:old.js',
      'done:boss.js',
      'end',
    ].sort((a, b) => kinds.indexOf(a) - kinds.indexOf(b)));
    const gameLines = events.filter((e): e is Extract<PatchEvent, { type: 'lines' }> => e.type === 'lines' && e.path === 'game.js');
    expect(gameLines.at(-1)?.count).toBe(GAME.split('\n').length + 1);
  });

  it('lets the art manifest be read before the file is finished', () => {
    const parser = new PatchParser();
    const head = FULL.slice(0, FULL.indexOf('  create()'));
    parser.feed(head);
    const open = parser.openBlock();
    expect(open).toMatchObject({ path: 'game.js', action: 'create' });
    expect(Object.keys((peekStaticLiteral(open?.text ?? '', 'art') ?? {}) as object)).toEqual(['hero', 'boss']);
  });
});

describe('truncation', () => {
  it('keeps exactly the complete blocks, at every cut point, and never throws', () => {
    const full = parsePatch(FULL);
    const endAt = FULL.indexOf('@@end');
    for (let cut = 0; cut < FULL.length; cut++) {
      const p = parsePatch(FULL.slice(0, cut));
      // What was kept is always a prefix of the real ops, each op complete.
      expect(full.ops.slice(0, p.ops.length), `cut ${cut}`).toEqual(p.ops);
      if (cut <= endAt + 4) expect(p.complete, `cut ${cut}`).toBe(false);
    }
    expect(parsePatch(FULL.slice(0, FULL.indexOf('@@end') + 5)).complete).toBe(true);
  });

  it('names the block that was cut off', () => {
    const cut = parsePatch(FULL.slice(0, FULL.indexOf('return 3;')));
    expect(cut).toMatchObject({ complete: false, truncatedIn: 'boss.js' });
    expect(cut.ops.map((o) => o.path)).toEqual(['game.js']);
    expect(cut.warnings.at(-1)).toBe('The reply stopped inside boss.js.');

    const inGame = parsePatch(FULL.slice(0, FULL.indexOf('create() {')));
    expect(inGame).toMatchObject({ truncatedIn: 'game.js', ops: [] });

    const betweenBlocks = parsePatch(FULL.slice(0, FULL.indexOf('@@file old.js')));
    expect(betweenBlocks).toMatchObject({ complete: false, truncatedIn: 'boss.js' });
    const afterDelete = parsePatch(FULL.slice(0, FULL.indexOf('@@end')));
    expect(afterDelete).toMatchObject({ complete: false, truncatedIn: null });
    expect(afterDelete.ops).toEqual(EXPECTED_OPS);
  });

  it('keeps nothing from a reply with no envelope at all', () => {
    const p = parsePatch("I can't do that, but here's an idea: make the enemies bounce!");
    expect(p).toMatchObject({ version: null, ops: [], complete: false, truncatedIn: null });
    expect(p.warnings).toEqual(['No AMBLE PATCH was found in the reply.']);
  });
});

describe('what models get wrong', () => {
  it('accepts a missing header and a missing @@done', () => {
    const p = parsePatch(['@@file boss.js edit', '@@find', 'a', '@@replace', 'b', '@@find', 'c', '@@replace', 'd', '@@end'].join('\n'));
    expect(p.ops).toEqual([{ action: 'edit', path: 'boss.js', edits: [{ find: 'a', replace: 'b' }, { find: 'c', replace: 'd' }], malformed: [] }]);
    expect(p.complete).toBe(true);
    expect(p.warnings.join('\n')).toMatch(/header is missing[\s\S]*@@done missing/);
  });

  it('strips a code fence around a file body, and blank lines at its end', () => {
    const p = parsePatch(['@@amble-patch 1', '@@file game.js replace', '```js', 'const a = 1;', '```', '', '', '@@end'].join('\n'));
    expect(p.ops).toEqual([{ action: 'replace', path: 'game.js', content: 'const a = 1;\n' }]);
  });

  it('reads a block mislabeled create that holds edits', () => {
    const p = parsePatch(['@@amble-patch 1', '@@file game.js create', '@@find', 'x', '@@replace', 'y', '@@done', '@@end'].join('\n'));
    expect(p.ops).toEqual([{ action: 'edit', path: 'game.js', edits: [{ find: 'x', replace: 'y' }], malformed: [] }]);
  });

  it('marks a find without a replace as malformed', () => {
    const p = parsePatch(['@@amble-patch 1', '@@file game.js edit', '@@find', 'x', '@@done', '@@end'].join('\n'));
    expect(p.ops).toEqual([{ action: 'edit', path: 'game.js', edits: [], malformed: ['a @@find without @@replace'] }]);
  });

  it('understands action synonyms, quoted names and a missing action', () => {
    const p = parsePatch(['@@amble-patch 1', '@@file "a.js" rewrite', 'x', '@@file b.js (remove)', '@@file c.js', 'y', '@@file: d.js new', 'z', '@@end'].join('\n'));
    expect(p.ops.map((o) => `${o.path}:${o.action}`)).toEqual(['a.js:replace', 'b.js:delete', 'c.js:create', 'd.js:create']);
  });

  it('warns about unknown directives and ends the block there', () => {
    const p = parsePatch(['@@amble-patch 1', '@@file a.js create', 'x', '@@oops', 'not code', '@@end'].join('\n'));
    expect(p.ops).toEqual([{ action: 'create', path: 'a.js', content: 'x\n' }]);
    expect(p.warnings[0]).toMatch(/Unknown directive/);
  });

  it('ignores everything after @@end', () => {
    const p = parsePatch(['@@amble-patch 1', '@@end', '@@file a.js create', 'x'].join('\n'));
    expect(p.ops).toEqual([]);
    expect(p.complete).toBe(true);
  });
});

describe('safety lines', () => {
  it('drops the files of a refusal or a crisis', () => {
    const refused = parsePatch(['@@amble-patch 1', "@@safety refused: How about a water-balloon fight instead?", '@@file game.js create', 'x', '@@end'].join('\n'));
    expect(refused.safety).toEqual({ status: 'refused', note: 'How about a water-balloon fight instead?' });
    expect(refused.ops).toEqual([]);
    const crisis = parsePatch(['@@amble-patch 1', '@@safety crisis', '@@end'].join('\n'));
    expect(crisis.safety.status).toBe('crisis');
  });

  it('reads variants and warns about nonsense', () => {
    expect(parsePatch('@@amble-patch 1\n@@safety tone-down: bubbles, not bullets\n@@end').safety).toEqual({ status: 'toned-down', note: 'bubbles, not bullets' });
    expect(parsePatch('@@amble-patch 1\n@@safety OK\n@@end').safety.status).toBe('ok');
    const odd = parsePatch('@@amble-patch 1\n@@safety maybe\n@@end');
    expect(odd.safety.status).toBe('ok');
    expect(odd.warnings[0]).toMatch(/Unknown safety value/);
  });
});
