/**
 * An accepted AI change lands on the world as it is now (§2.8): code the student ran in Look inside while the
 * AI helper worked stays. A file only one side changed takes that side, a file both changed is merged line by
 * line, and where both changed the same lines the student's file stays and they are told the AI's change to it
 * was left out. Footsteps and line authors follow what actually went in.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getServices, setServices, type Services } from '../../src/app/services';
import { EMPTY_MANIFEST, type GameManifest } from '../../src/cores/play';
import { createHistory } from '../../src/history/api';
import { setSessionWorld } from '../../src/history/live';
import type { AiOutcome, CodeFile, World } from '../../src/model/types';
import { leftOutText, startChange } from '../../src/state/ai';
import { applyAcceptedChange, closeWorld, flushWorld, openWorld, patchSession } from '../../src/state/session';
import { getState, resetState } from '../../src/state/store';
import { createStarterCatalog } from '../../src/starters/api';
import { MemoryStore } from '../../src/store/memory';
import { sampleWorld } from '../foundation/samples';

const GAME = [
  'class Game extends Amble.Scene {',
  '  static art = {',
  "    hero: { kind: 'character', rig: 'biped', role: 'hero' },",
  "    boss: { kind: 'character', rig: 'blob', role: 'boss' },",
  '  };',
  '  create() {',
  '    this.speed = 200;',
  '    this.lives = 3;',
  '  }',
  '  update() {',
  '    this.move();',
  '  }',
  '}',
].join('\n');
const BOSS = ['export const boss = {', '  hp: 10,', '  phase: 1,', '};'].join('\n');

/** The AI's change: a pizza to draw, and the boss throws it. */
const AI_GAME = GAME.replace("    boss: { kind: 'character', rig: 'blob', role: 'boss' },", "    boss: { kind: 'character', rig: 'blob', role: 'boss' },\n    pizza: { kind: 'item', role: 'item' },").replace(
  '    this.move();',
  '    this.move();\n    this.throwPizza();',
);

const MANIFEST: GameManifest = { ...EMPTY_MANIFEST, title: 'Moon King', kit: true };

function fakePlayer() {
  const noop = () => undefined;
  return {
    attach: vi.fn(() => noop),
    load: vi.fn(async () => MANIFEST),
    robot: vi.fn(),
    promote: vi.fn(async () => undefined),
    manifest: vi.fn(() => MANIFEST),
    swapArt: vi.fn(),
    clearArt: vi.fn(),
    dial: vi.fn(),
    twist: vi.fn(),
    prefs: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    restartLevel: vi.fn(),
    setMode: vi.fn(),
    select: vi.fn(),
    celebrate: vi.fn(),
    step: vi.fn(),
    snapshot: vi.fn(async () => null),
    key: vi.fn(),
    releaseKeys: vi.fn(),
    focus: vi.fn(),
    fullscreen: vi.fn(),
    setTitle: vi.fn(),
    on: vi.fn(() => noop),
    onObjects: vi.fn(() => noop),
  };
}

const lines = (s: string) => s.split('\n').length;
const code = (game: string, boss = BOSS): CodeFile[] => [
  { path: 'boss.js', source: boss, authors: [['starter', lines(boss)]], locked: [] },
  { path: 'game.js', source: game, authors: [['starter', lines(game)]], locked: [] },
];

/** The job's result: its files are the job's starting code with the AI's change in (`base` → `files`). */
function accepted(files: CodeFile[], o: Partial<Extract<AiOutcome, { kind: 'accepted' }>> = {}): Extract<AiOutcome, { kind: 'accepted' }> {
  const pizza = { key: 'pizza', name: 'Pizza', kind: 'item', rig: 'none', role: 'item', shape: 'coin', w: 24, h: 24, color: '#f2cf5e', ask: '', about: '', pronoun: 'it', facing: 'viewer', priority: 3, required: false, spare: false, declared: true, used: false, drawn: false } as GameManifest['art'][number];
  return {
    kind: 'accepted',
    files,
    manifest: { ...MANIFEST, art: [pizza] },
    summary: 'the boss throws pizza.',
    play: '',
    next: [],
    safety: { kind: 'ok', note: '' },
    repairs: 0,
    tested: true,
    handEditsTouched: false,
    newArt: ['pizza'],
    ...o,
  };
}

/** Look inside's Run it: the student's lines, credited to them, a footstep, and the session takes it. */
async function studentRuns(path: string, source: string): Promise<World> {
  const { history } = getServices();
  const w = getState().session.world!;
  const next = w.code.map((f) => (f.path === path ? { ...f, source } : f));
  const recorded = await history.record({ ...w, code: history.attribute(w.code, next, 'student') }, { kind: 'code', by: 'student', text: `You changed ${path}`, files: [path] });
  setSessionWorld(recorded);
  return recorded;
}

/** A change job whose answer the test gives (after the student has changed things). */
function pendingChange(): { answer(o: AiOutcome): void } {
  let answer: (o: AiOutcome) => void = () => undefined;
  (getServices() as unknown as { ai: { change: () => Promise<AiOutcome> } }).ai = { change: () => new Promise<AiOutcome>((resolve) => (answer = resolve)) };
  return { answer: (o) => answer(o) };
}

const file = (w: World | null | undefined, path: string) => w?.code.find((f) => f.path === path);

let store: MemoryStore;
let world: World;

beforeEach(async () => {
  resetState();
  closeWorld();
  store = new MemoryStore();
  setServices({ store, player: fakePlayer(), history: createHistory(), starters: createStarterCatalog() } as unknown as Services);
  world = sampleWorld({ id: 'w_merge00001', code: code(GAME), cast: {}, dials: {}, twists: [] });
  await store.commit({ worlds: [world] });
  await openWorld(world.id);
  patchSession({ manifest: structuredClone(MANIFEST) });
  await getServices().history.ensureHead(world);
});

afterEach(async () => {
  await flushWorld();
});

describe('an AI change that lands after the student ran code', () => {
  it('keeps a file only the student changed, and puts in the file only the AI changed', async () => {
    const job = pendingChange();
    const run = startChange(getState().session.world!, 'make the boss throw pizza');
    const mine = BOSS.replace('hp: 10', 'hp: 25');
    await studentRuns('boss.js', mine);
    job.answer(accepted(code(AI_GAME)));
    await run;

    const w = getState().session.world!;
    expect(file(w, 'boss.js')?.source).toBe(mine);
    expect(file(w, 'boss.js')?.authors).toEqual([['starter', 1], ['student', 1], ['starter', 2]]);
    expect(file(w, 'game.js')?.source).toBe(AI_GAME);
    // Footsteps: the student's run, then the AI's change to the one file it changed.
    expect(w.steps.map((s) => [s.by, s.kind])).toEqual([
      ['student', 'start'],
      ['student', 'code'],
      ['ai', 'ask'],
    ]);
    expect(w.steps.at(-1)).toMatchObject({ files: ['game.js'], request: 'make the boss throw pizza', text: 'the boss throws pizza.' });
    expect(w.cast.pizza).toMatchObject({ key: 'pizza', art: null });
    expect(getState().session.fresh).toEqual(['pizza']);
    expect(getState().ai.changed).toEqual({ worldId: world.id, files: ['game.js'], handFile: null, leftOut: [] });

    await flushWorld();
    const stored = await store.worlds.get(world.id);
    expect(file(stored, 'boss.js')?.source).toBe(mine);
    expect(file(stored, 'game.js')?.source).toBe(AI_GAME);
  });

  it('merges a file both changed in different lines, crediting each line to who wrote it', async () => {
    const job = pendingChange();
    const run = startChange(getState().session.world!, 'make the boss throw pizza');
    await studentRuns('game.js', GAME.replace('this.speed = 200;', 'this.speed = 320;'));
    job.answer(accepted(code(AI_GAME)));
    await run;

    const g = file(getState().session.world, 'game.js')!;
    expect(g.source).toBe(AI_GAME.replace('this.speed = 200;', 'this.speed = 320;'));
    const authorOf = (text: string) => {
      const at = g.source.split('\n').findIndex((l) => l.includes(text));
      let line = 0;
      for (const [who, n] of g.authors) {
        if (at < line + n) return who;
        line += n;
      }
      return null;
    };
    expect(authorOf('this.speed = 320;')).toBe('student');
    expect(authorOf("pizza: { kind: 'item'")).toBe('ai');
    expect(authorOf('this.throwPizza();')).toBe('ai');
    expect(authorOf('this.lives = 3;')).toBe('starter');
    expect(getState().ai.changed?.leftOut).toEqual([]);
    expect(getState().session.world?.steps.at(-1)).toMatchObject({ by: 'ai', kind: 'ask', files: ['game.js'] });
  });

  it("keeps the student's file on a conflict, says the AI's change to it was left out, and records nothing", async () => {
    const job = pendingChange();
    const run = startChange(getState().session.world!, 'make the boss throw pizza');
    const mine = GAME.replace('    this.move();', '    this.move();\n    this.jumpAround();');
    await studentRuns('game.js', mine);
    const stepsBefore = getState().session.world!.steps.length;
    job.answer(accepted(code(AI_GAME)));
    await run;

    const w = getState().session.world!;
    expect(file(w, 'game.js')?.source).toBe(mine);
    expect(w.steps.length).toBe(stepsBefore);
    expect(w.cast.pizza).toBeUndefined();
    expect(getState().session.fresh).toEqual([]);
    expect(getState().ai.changed).toEqual({ worldId: world.id, files: [], handFile: null, leftOut: ['game.js'] });
    const text = leftOutText(['game.js']);
    expect(text).toBe("You changed game.js while the AI helper was working, so its change to that file was left out. Ask again to try once more.");
    expect(getState().app.toasts.map((x) => x.text)).toContain(text);
    expect(getState().app.toasts.map((x) => x.text)).not.toContain('Amble changed your world: the boss throws pizza.');
  });

  it('puts in the files without a conflict and leaves out the one with it', async () => {
    const job = pendingChange();
    const run = startChange(getState().session.world!, 'make the boss throw pizza');
    const mine = GAME.replace('    this.move();', '    this.move();\n    this.jumpAround();');
    await studentRuns('game.js', mine);
    job.answer(accepted(code(AI_GAME, BOSS.replace('phase: 1', 'phase: 2'))));
    await run;

    const w = getState().session.world!;
    expect(file(w, 'game.js')?.source).toBe(mine);
    expect(file(w, 'boss.js')?.source).toContain('phase: 2');
    expect(w.steps.at(-1)).toMatchObject({ by: 'ai', files: ['boss.js'] });
    // The pizza was declared in the file that was left out: it is not in the world.
    expect(w.cast.pizza).toBeUndefined();
    expect(getState().ai.changed).toMatchObject({ files: ['boss.js'], leftOut: ['game.js'] });
  });

  it('notes when the change rewrote lines the student wrote before it started', async () => {
    await studentRuns('game.js', GAME.replace('this.lives = 3;', 'this.lives = 9;'));
    const job = pendingChange();
    const run = startChange(getState().session.world!, 'fewer lives');
    const base = getState().session.world!.code;
    const theirs = base.map((f) => (f.path === 'game.js' ? { ...f, source: f.source.replace('this.lives = 9;', 'this.lives = 1;') } : f));
    job.answer(accepted(theirs, { handEditsTouched: true, newArt: [] }));
    await run;

    expect(getState().ai.changed).toMatchObject({ files: ['game.js'], handFile: 'game.js', leftOut: [] });
    expect(getState().session.world?.steps.at(-1)).toMatchObject({ kind: 'ask', handEdits: true });
  });

  it('applies the job result as it is when the student changed nothing', async () => {
    const r = await applyAcceptedChange(accepted(code(AI_GAME)), { base: world.code });
    expect(r.files).toEqual(['game.js']);
    expect(r.leftOut).toEqual([]);
    expect(file(r.world, 'game.js')?.source).toBe(AI_GAME);
  });
});

describe('an AI change that lands while the world is not open', () => {
  it('merges into the stored world the student left after running code', async () => {
    const job = pendingChange();
    const run = startChange(getState().session.world!, 'make the boss throw pizza');
    const mine = BOSS.replace('hp: 10', 'hp: 25');
    await studentRuns('boss.js', mine);
    // Back to the Trail: the world is saved and the session closes.
    await flushWorld();
    closeWorld();
    job.answer(accepted(code(AI_GAME)));
    await run;

    const stored = await store.worlds.get(world.id);
    expect(file(stored, 'boss.js')?.source).toBe(mine);
    expect(file(stored, 'game.js')?.source).toBe(AI_GAME);
    expect(stored?.steps.at(-1)).toMatchObject({ by: 'ai', kind: 'ask', files: ['game.js'] });
  });

  it('leaves the stored world alone when the only file the AI changed was left out', async () => {
    const job = pendingChange();
    const run = startChange(getState().session.world!, 'make the boss throw pizza');
    const mine = GAME.replace('    this.move();', '    this.move();\n    this.jumpAround();');
    await studentRuns('game.js', mine);
    await flushWorld();
    closeWorld();
    const before = await store.worlds.get(world.id);
    job.answer(accepted(code(AI_GAME)));
    await run;

    const stored = await store.worlds.get(world.id);
    expect(file(stored, 'game.js')?.source).toBe(mine);
    expect(stored?.steps.length).toBe(before?.steps.length);
    expect(getState().ai.changed).toMatchObject({ files: [], leftOut: ['game.js'] });
  });
});
