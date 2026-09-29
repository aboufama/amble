/**
 * Look inside's logic (§2.12): Run it (checks, provenance, the footstep, a failed or replaced load), the
 * validator's kid words and fixes, whole-line edits, teacher locks, the live provenance gutter, and kit
 * docs. CodeMirror's state runs in Node; no view is created.
 */
import { EditorState } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import { createHistory } from '../../src/history/api';
import type { World } from '../../src/model/types';
import { liveAuthors, provenanceExtension, setBaseline } from '../../src/screens/code/cm/gutter';
import { kitDocsInRange, kitIndex, kitRefAt } from '../../src/screens/code/cm/kitDocs';
import { lineChanges, nearLine } from '../../src/screens/code/cm/lineEdits';
import { kidText, lintSources } from '../../src/screens/code/cm/lint';
import { lockBypass, lockedField, lockedLines, setLocked } from '../../src/screens/code/cm/locked';
import { checkRun, runIt, type RunDeps } from '../../src/screens/code/run';
import { MemoryStore } from '../../src/store/memory';
import { FIXTURE_GAME } from '../../src/starters/fixtureGame';
import { sampleWorld } from '../foundation/samples';

const LINES = FIXTURE_GAME.split('\n').length;

function fixtureWorld(): World {
  return sampleWorld({ code: [{ path: 'game.js', source: FIXTURE_GAME, authors: [['starter', LINES]], locked: [] }], cast: {}, dials: {}, twists: [] });
}

function apply(doc: string, target: string, pick?: Parameters<typeof lineChanges>[2]): string {
  const state = EditorState.create({ doc });
  return state.update({ changes: lineChanges(state.doc, target, pick) }).state.doc.toString();
}

describe('Run it', () => {
  it('holds back code that does not parse and names the first problem', () => {
    const world = fixtureWorld();
    const broken = FIXTURE_GAME.replace('this.rage = 0;', 'this.rage = 0; )');
    const check = checkRun(world, { 'game.js': { source: broken, locked: [] } }, createHistory().attribute);
    expect(check.kind).toBe('blocked');
    if (check.kind !== 'blocked') return;
    expect(check.errors[0].line).toBe(FIXTURE_GAME.split('\n').findIndex((l) => l.includes('this.rage = 0;')) + 1);
    expect(check.errors[0].message).toMatch(/^The computer can't read this line/);
  });

  it('credits changed lines to the student and records "You changed game.js"', async () => {
    const store = new MemoryStore();
    const world = fixtureWorld();
    await store.commit({ worlds: [world] });
    const history = createHistory({ store: () => store });
    const played: World[] = [];
    let shown: World | null = null;
    const deps: RunDeps = { history, play: async (w) => void played.push(w), setWorld: (w) => (shown = w) };
    const source = FIXTURE_GAME.replace('gravity: 1500', 'gravity: 1200');
    const out = await runIt(world, { 'game.js': { source, locked: [] } }, deps);
    expect(out.kind).toBe('ran');
    if (out.kind !== 'ran') return;
    expect(out.changed).toEqual(['game.js']);
    expect(played[0].code[0].source).toBe(source);
    expect(out.world.code[0].authors).toEqual([
      ['starter', 2],
      ['student', 1],
      ['starter', LINES - 3],
    ]);
    expect(out.world.steps.at(-1)).toMatchObject({ kind: 'code', by: 'student', text: 'You changed game.js', files: ['game.js'] });
    expect(shown).toBe(out.world);
    expect((await store.worlds.get(world.id))?.code[0].source).toBe(source);
  });

  it('replays an unchanged world without a footstep', async () => {
    const world = fixtureWorld();
    const played: World[] = [];
    const out = await runIt(world, { 'game.js': { source: FIXTURE_GAME, locked: [] } }, { history: createHistory(), play: async (w) => void played.push(w), setWorld: () => undefined });
    expect(out.kind).toBe('replayed');
    expect(played).toEqual([world]);
  });

  it('puts the last version back when the new one cannot start, and records nothing when replaced', async () => {
    const world = fixtureWorld();
    const source = FIXTURE_GAME.replace('gravity: 1500', 'gravity: 1300');
    const played: string[] = [];
    const failing: RunDeps = {
      history: createHistory(),
      play: async (w) => {
        played.push(w.code[0].source);
        if (w.code[0].source === source) throw new Error('crashed');
      },
      setWorld: () => {
        throw new Error('nothing to record');
      },
    };
    expect((await runIt(world, { 'game.js': { source, locked: [] } }, failing)).kind).toBe('failed');
    expect(played).toEqual([source, FIXTURE_GAME]);
    const replaced: RunDeps = { ...failing, play: async () => Promise.reject(new DOMException('replaced', 'AbortError')) };
    expect((await runIt(world, { 'game.js': { source, locked: [] } }, replaced)).kind).toBe('superseded');
  });
});

describe('diagnostics', () => {
  it('reads like a sentence without the "Line n:" prefix', () => {
    expect(kidText({ kid: 'Line 12: the computer can\'t read this line.', message: '' })).toBe("The computer can't read this line.");
    expect(kidText({ kid: '', message: 'x is wrong' })).toBe('X is wrong');
  });

  it('offers the auto-fix for problems the validator can fix', () => {
    const source = FIXTURE_GAME.replace('class Game extends Amble.Scene', 'class Game extends Phaser.Scene');
    const report = lintSources([{ path: 'game.js', content: source }]);
    const issue = report.issues.find((i) => i.rule === 'extends-phaser-scene');
    expect(issue?.fixed).toContain('class Game extends Amble.Scene');
    const fixed = apply(source, issue!.fixed!, nearLine(EditorState.create({ doc: source }).doc, issue!.fixed!, issue!.line - 1));
    expect(fixed.split('\n')[1]).toBe('class Game extends Amble.Scene {');
  });
});

describe('whole-line edits', () => {
  it('turn any version into any other', () => {
    const cases: Array<[string, string]> = [
      ['a\nb\nc', 'a\nx\nc'],
      ['a\nb\nc', 'a\nc'],
      ['a\nb\nc', 'a\nb'],
      ['a\nb', 'a\nb\nc\nd'],
      ['a', ''],
      ['', 'a\nb'],
      ['a\nb\nc', 'x\ny\nz'],
      ['a\nb\nc\nd\ne', 'b\nc\nx\ne\nf'],
      ['a\n', 'a\nb\n'],
    ];
    for (const [a, b] of cases) expect(apply(a, b), `${JSON.stringify(a)} → ${JSON.stringify(b)}`).toBe(b);
  });

  it('can apply only the blocks near a line', () => {
    const a = 'one\ntwo\nthree\nfour\nfive\nsix\nseven\neight';
    const b = 'ONE\ntwo\nthree\nfour\nfive\nsix\nseven\nEIGHT';
    const doc = EditorState.create({ doc: a }).doc;
    expect(apply(a, b, nearLine(doc, b, 7))).toBe('one\ntwo\nthree\nfour\nfive\nsix\nseven\nEIGHT');
  });
});

describe('teacher locks', () => {
  const doc = ['line 1', 'line 2', 'locked 3', 'locked 4', 'line 5'].join('\n');
  const state = () => EditorState.create({ doc, extensions: [lockedField] }).update({ effects: setLocked.of([[3, 4]]) }).state;

  it('keeps the locked block as its lines move', () => {
    const s = state();
    expect(lockedLines(s)).toEqual([[3, 4]]);
    const moved = s.update({ changes: { from: 0, insert: 'new 0\n' } }).state;
    expect(lockedLines(moved)).toEqual([[4, 5]]);
  });

  it('refuses edits inside locked lines, and allows edits around them', async () => {
    const { lockedLinesExtension } = await import('../../src/screens/code/cm/locked');
    let refused = 0;
    const s = EditorState.create({ doc, extensions: lockedLinesExtension({ ranges: [[3, 4]], note: 'Your teacher locked these lines.', onRefused: () => refused++ }) });
    const at = (line: number) => s.doc.line(line);
    // Typing inside a locked line, joining it with a neighbour, deleting it: refused.
    expect(s.update({ changes: { from: at(3).from + 2, insert: 'x' } }).state.doc.toString()).toBe(doc);
    expect(s.update({ changes: { from: at(2).to, to: at(3).from } }).state.doc.toString()).toBe(doc);
    expect(s.update({ changes: { from: at(4).to, to: at(5).from } }).state.doc.toString()).toBe(doc);
    expect(s.update({ changes: { from: at(3).from, to: at(5).from } }).state.doc.toString()).toBe(doc);
    // New lines above and below, and edits elsewhere: fine.
    expect(s.update({ changes: { from: at(2).to, insert: '\nabove' } }).state.doc.toString()).toContain('line 2\nabove\nlocked 3');
    expect(s.update({ changes: { from: at(4).to, insert: '\nbelow' } }).state.doc.toString()).toContain('locked 4\nbelow\nline 5');
    expect(s.update({ changes: { from: at(1).from, to: at(1).to, insert: 'LINE 1' } }).state.doc.toString()).toMatch(/^LINE 1/);
    // Restoring a version on purpose may pass through.
    expect(s.update({ changes: { from: 0, to: s.doc.length, insert: 'fresh' }, annotations: lockBypass.of(true) }).state.doc.toString()).toBe('fresh');
    expect(refused).toBe(0);
  });
});

describe('the provenance gutter', () => {
  it('marks the lines the student changes while typing, measured from the running version', () => {
    const source = 'a\nb\nc';
    let s = EditorState.create({ doc: source, extensions: provenanceExtension({ source, authors: [['starter', 1], ['ai', 2]] }) });
    expect(liveAuthors(s)).toEqual(['starter', 'ai', 'ai']);
    s = s.update({ changes: { from: s.doc.line(2).from, to: s.doc.line(2).to, insert: 'B' } }).state;
    expect(liveAuthors(s)).toEqual(['starter', 'student', 'ai']);
    s = s.update({ changes: { from: s.doc.length, insert: '\nd' } }).state;
    expect(liveAuthors(s)).toEqual(['starter', 'student', 'ai', 'student']);
    s = s.update({ effects: setBaseline.of({ source: s.doc.toString(), authors: [['starter', 1], ['student', 1], ['ai', 1], ['student', 1]] }) }).state;
    expect(liveAuthors(s)).toEqual(['starter', 'student', 'ai', 'student']);
  });
});

describe('kit docs', () => {
  const index = kitIndex();
  const docOf = (code: string, word: string) => {
    const state = EditorState.create({ doc: code });
    return kitRefAt(state.doc, code.indexOf(word) + 1, index);
  };

  it('finds scene members, namespace members and character methods', () => {
    expect(docOf('this.spawnHero(1, 2)', 'spawnHero')?.ns).toBe('');
    expect(docOf('this.fx.shake(0.01)', 'shake')).toMatchObject({ ns: 'fx', member: { name: 'shake' } });
    expect(docOf('this.boss.chase(this.player)', 'chase')).toMatchObject({ ns: 'actor', member: { name: 'chase' } });
    expect(docOf('Math.floor(2)', 'floor')).toBeNull();
    expect(docOf('const shake = 1;', 'shake')).toBeNull();
    for (const ref of [docOf('this.fx.shake()', 'shake'), docOf('this.spawnHero()', 'spawnHero')]) {
      expect(ref?.member.signature.length).toBeGreaterThan(3);
      expect(ref?.member.doc.length).toBeGreaterThan(3);
    }
  });

  it('lists each kit call in a range once', () => {
    const code = 'this.fx.shake(1);\nthis.fx.shake(2);\nthis.ui.big("GO");\nfoo.bar();';
    const state = EditorState.create({ doc: code });
    expect(kitDocsInRange(state.doc, 0, code.length, index).map((d) => `${d.ns}.${d.member.name}`)).toEqual(['fx.shake', 'ui.big']);
  });
});
