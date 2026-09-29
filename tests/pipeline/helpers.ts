/** Shared helpers for the pipeline tests: the e2e AI fixtures, a world around them, a fake chat and robot. */
import { parsePatch } from '../../src/cores/ai';
import type { CodeFile, PlanReply, World } from '../../src/model/types';
import type { ChatCall, ChatReply, JobDeps } from '../../src/pipeline/jobs';
import type { RobotOutcome } from '../../src/pipeline/robot';

const FIXTURES = import.meta.glob<string>('/e2e/fixtures/ai/*', { query: '?raw', import: 'default', eager: true });

export function fixture(name: string): string {
  const text = FIXTURES[`/e2e/fixtures/ai/${name}`];
  if (text === undefined) throw new Error(`no fixture ${name}`);
  return text;
}

export function fixtureNames(): string[] {
  return Object.keys(FIXTURES).map((k) => k.slice('/e2e/fixtures/ai/'.length));
}

/** The Moon King game from build-moon-king.patch (a valid kit game). */
export const MOON_KING = (() => {
  const op = parsePatch(fixture('build-moon-king.patch')).ops.find((o) => o.path === 'game.js');
  if (!op || op.action === 'edit' || op.action === 'delete') throw new Error('bad fixture');
  return op.content;
})();

export const PLAN_SNAIL = JSON.parse(fixture('plan-snail.json')) as PlanReply;

export function code(path: string, source: string, author: 'starter' | 'ai' | 'student' = 'starter'): CodeFile {
  return { path, source, authors: [[author, source.split('\n').length]], locked: [] };
}

export function world(over: Partial<World> = {}): World {
  return {
    format: 'amble-world',
    version: 1,
    id: 'w_test000001',
    title: 'Pop the Moon',
    pitch: '',
    level: 'middle',
    createdAt: 1,
    updatedAt: 1,
    openedAt: 1,
    origin: { kind: 'starter', starter: 'moon-king', withArt: false },
    code: [code('game.js', MOON_KING)],
    cast: {
      hero: { key: 'hero', art: 'a_hero000001', madeBy: 'student', extra: null, laterUntil: 0 },
      boss: { key: 'boss', art: null, madeBy: null, extra: null, laterUntil: 0 },
    },
    sounds: {},
    dials: { jump: 780 },
    twists: ['moonGravity'],
    controls: {},
    gameStorage: {},
    steps: [{ id: 's_start00001', at: 1, by: 'student', kind: 'start', text: 'You started it.' }],
    head: 's_start00001',
    assignment: null,
    handIn: { fileName: null, savedAt: null, method: null, turnedInAt: null },
    credits: { madeBy: 'AB' },
    plan: null,
    ...over,
  };
}

export type FakeReply = string | { text: string; truncated?: boolean } | Error | ((call: ChatCall) => Promise<ChatReply>);

/** A chat that answers from a queue, streaming each reply in 300-character pieces. */
export function fakeChat(replies: FakeReply[]) {
  const calls: ChatCall[] = [];
  const queue = [...replies];
  const chat = async (call: ChatCall): Promise<ChatReply> => {
    calls.push(call);
    const r = queue.shift();
    if (r === undefined) throw new Error(`no reply left for call ${calls.length} (${call.task})`);
    if (r instanceof Error) throw r;
    if (typeof r === 'function') return r(call);
    const text = typeof r === 'string' ? r : r.text;
    let sent = '';
    for (let i = 0; i < text.length; i += 300) {
      const piece = text.slice(i, i + 300);
      sent += piece;
      call.onDelta(piece, sent);
    }
    return { text, truncated: typeof r === 'string' ? false : Boolean(r.truncated) };
  };
  return { calls, chat, left: () => queue.length };
}

export const PASS: RobotOutcome = { pass: true, reasons: [], errors: [], warnings: [], summary: 'passed · 6 s · hero moved · no errors' };

export function robotFail(file: string, line: number, message: string): RobotOutcome {
  return { pass: false, reasons: [message], errors: [{ file, line, column: 5, phase: 'update', message, count: 12 }], warnings: ['a warning'], summary: 'failed · 6 s · hero moved · 1 error' };
}

/** A robot that answers from a queue (PASS when it runs out). */
export function fakeRobot(outcomes: Array<RobotOutcome | null | ((signal: AbortSignal) => Promise<RobotOutcome | null>)> = []) {
  const runs: Array<readonly CodeFile[]> = [];
  const robot = async (files: readonly CodeFile[], o: { signal: AbortSignal; seed: number }) => {
    runs.push(files);
    const next = outcomes.shift();
    if (typeof next === 'function') return next(o.signal);
    return next === undefined ? PASS : next;
  };
  return { runs, robot };
}

export function deps(chat: JobDeps['chat'], robot: JobDeps['robot'] = fakeRobot().robot, screen: JobDeps['screen'] = async () => ({ ok: true, flagged: [] })): JobDeps {
  return { chat, robot, screen, seed: 7 };
}

/** A promise that never settles until `signal` aborts (then rejects like a stopped fetch). */
export function hangs<T>(signal: AbortSignal): Promise<T> {
  return new Promise((_, reject) => signal.addEventListener('abort', () => reject(new DOMException('Stopped', 'AbortError')), { once: true }));
}
