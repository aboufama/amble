/**
 * Look inside's logic (§2.12): Run it (checks, provenance, the footstep, a failed or replaced load), the
 * validator's kid words and fixes, whole-line edits, teacher locks, the live provenance gutter, and kit
 * docs. CodeMirror's state runs in Node; no view is created.
 */
import { EditorState } from '@codemirror/state';
import { describe, expect, it, vi } from 'vitest';
import { createHistory } from '../../src/history/api';
import type { World } from '../../src/model/types';
import { liveAuthors, provenanceExtension, setBaseline } from '../../src/screens/code/cm/gutter';
import { kitDocsInRange, kitIndex, kitRefAt } from '../../src/screens/code/cm/kitDocs';
import { lineChanges, nearLine } from '../../src/screens/code/cm/lineEdits';
import { kidText, lintSources } from '../../src/screens/code/cm/lint';
import { lockBypass, lockedField, lockedLines, setLocked } from '../../src/screens/code/cm/locked';
import { checkRun, runIt, unkindWords, type RunDeps } from '../../src/screens/code/run';
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
    const check = checkRun(world, { 'game.js': { source: broken, locked: [] } }, createHistory().attribute, 'middle');
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
    const deps: RunDeps = { history, play: async (w) => void played.push(w), setWorld: (w) => (shown = w), level: 'middle' };
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
    const out = await runIt(world, { 'game.js': { source: FIXTURE_GAME, locked: [] } }, { history: createHistory(), play: async (w) => void played.push(w), setWorld: () => undefined, level: 'middle' });
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
      level: 'middle',
    };
    expect((await runIt(world, { 'game.js': { source, locked: [] } }, failing)).kind).toBe('failed');
    expect(played).toEqual([source, FIXTURE_GAME]);
    const replaced: RunDeps = { ...failing, play: async () => Promise.reject(new DOMException('replaced', 'AbortError')) };
    expect((await runIt(world, { 'game.js': { source, locked: [] } }, replaced)).kind).toBe('superseded');
  });
});

describe('Run it: the words a student types (§5.13)', () => {
  const rot13 = (s: string) => s.replace(/[a-z]/g, (c) => String.fromCharCode(((c.charCodeAt(0) - 97 + 13) % 26) + 97));
  const WIN = "this.boss.on('die', () => this.win('MOON KING DEFEATED!'));";
  const winLine = FIXTURE_GAME.split('\n').findIndex((l) => l.includes(WIN)) + 1;
  const saying = (words: string, base = FIXTURE_GAME) => base.replace("this.win('MOON KING DEFEATED!')", `this.win('${words}')`);

  function tracked(level: RunDeps['level']) {
    const played: World[] = [];
    const recorded: World[] = [];
    const history = createHistory();
    const deps: RunDeps = {
      history: { attribute: history.attribute, record: async (w) => (recorded.push(w), w) },
      play: async (w) => void played.push(w),
      setWorld: () => undefined,
      level,
    };
    return { deps, played, recorded };
  }

  it("won't run new words that aren't OK for school, and says which line, on the Chromebook alone", async () => {
    expect(winLine).toBeGreaterThan(0);
    const rude = `Moon King, you ${rot13('fuvg')}!`;
    const run = tracked('high');
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    try {
      const out = await runIt(fixtureWorld(), { 'game.js': { source: saying(rude), locked: [] } }, run.deps);
      expect(out).toEqual({ kind: 'words', file: 'game.js', line: winLine });
    } finally {
      vi.unstubAllGlobals();
    }
    expect(fetch).not.toHaveBeenCalled();
    expect(run.played).toEqual([]);
    expect(run.recorded).toEqual([]);
  });

  it('reads the words at the student\'s level: insults stop a grades 3-5 world only', async () => {
    const words = 'You beat him, you stupid slime!';
    const low = tracked('elementary');
    expect(await runIt(fixtureWorld(), { 'game.js': { source: saying(words), locked: [] } }, low.deps)).toEqual({ kind: 'words', file: 'game.js', line: winLine });
    const mid = tracked('middle');
    expect((await runIt(fixtureWorld(), { 'game.js': { source: saying(words), locked: [] } }, mid.deps)).kind).toBe('ran');
    expect(mid.played).toHaveLength(1);
  });

  it('never reads again the words the world already shows, and runs kind words', async () => {
    // The running version already says it (a world from before this check, say); a number change still runs.
    const before = saying('You stupid slime!');
    const world = sampleWorld({ code: [{ path: 'game.js', source: before, authors: [['starter', LINES]], locked: [] }], cast: {}, dials: {}, twists: [] });
    const run = tracked('elementary');
    expect((await runIt(world, { 'game.js': { source: before.replace('gravity: 1500', 'gravity: 1200'), locked: [] } }, run.deps)).kind).toBe('ran');
    const kind = tracked('elementary');
    expect((await runIt(fixtureWorld(), { 'game.js': { source: saying('You saved the moon! Great jumping!'), locked: [] } }, kind.deps)).kind).toBe('ran');
    expect(kind.recorded).toHaveLength(1);
  });

  it("finds the words in any file, where the game shows them, and leaves code's own names alone", () => {
    const helper = (said: string) => `// Cheers from the crowd.\nfunction cheer(boss) {\n  boss.say('${said}');\n}\n`;
    const code = [
      { path: 'game.js', source: FIXTURE_GAME, authors: [['starter', LINES]] as World['code'][number]['authors'], locked: [] },
      { path: 'cheer.js', source: helper('Go, go, go!'), authors: [['starter', 4]] as World['code'][number]['authors'], locked: [] },
    ];
    expect(unkindWords(code, [code[0], { ...code[1], source: helper('you are such an idiot') }], 'elementary')).toEqual({ file: 'cheer.js', line: 3 });
    expect(unkindWords(code, [code[0], { ...code[1], source: helper('you are such an idiot') }], 'high')).toBeNull();
    // Code is never read as words: a function named for what it does in the game is fine.
    const names = FIXTURE_GAME.replace("this.boss.on('die'", 'const stupidSlimeKiller = 1; this.boss.on(\'die\'');
    expect(unkindWords(code, [{ ...code[0], source: names }, code[1]], 'elementary')).toBeNull();
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
