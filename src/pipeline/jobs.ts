/**
 * One build, change or fix job (§5.8): a state machine with the transport, the robot and the output
 * check injected, so it runs the same in the app and in tests.
 *
 *   writing (stream + parse; one `continue` if the reply was cut off) → applying (one `resend` per file whose
 *   @@find missed) → validating ─errors→ fixing (static, round n) → writing …
 *   → output check (one regeneration) → testing (robot) ─fail→ fixing (runtime, round n) → writing …
 *   └pass→ swapping → accepted.  At most 2 repair rounds, static and runtime together; then failed.
 *
 * Nothing here touches the world: the result is the accepted file set, or why there is none.
 */
import type { AppliedFix, FileOp, Patch, SourceFile } from '../cores/ai';
import type { AiProgress, CastKey, CodeFile, Level, PlanReply, StarterId, World } from '../model/types';
import { applyOps, editsText, mergeOps, ordered, toSource, type Applied } from './apply';
import { artNeedOf, type Spec } from './manifest';
import { createPatchStream } from './patchStream';
import { errorsFromIssues, fixPart } from './repair';
import type { RobotOutcome, RobotRunner } from './robot';
import { buildUserMessage, describeWorld, includedOf, planCastLines, type CodeTask, type FixError, type UserMessageInput } from './userMessage';
import { check, kidIssue, worldFacts, type Checked } from './validate';
import type { ArtNeed } from '../cores/play';

export const MAX_REPAIRS = 2;

export interface ChatCall {
  task: CodeTask;
  user: string;
  /** What the request carries, in plain words (for What Amble sends). */
  included: string[];
  signal: AbortSignal;
  onDelta(delta: string, text: string): void;
  /** The transport is waiting before a retry (429 with Retry-After, 5xx, network). */
  onWaiting(ms: number, reason: 'rate-limited' | 'server' | 'network'): void;
}

export interface ChatReply {
  text: string;
  truncated: boolean;
}

export interface JobDeps {
  chat(call: ChatCall): Promise<ChatReply>;
  robot: RobotRunner | null;
  /** The output check on the text the game will show (floor filter, then moderation when configured). */
  screen(strings: readonly string[], signal: AbortSignal): Promise<{ ok: boolean; flagged: string[] }>;
  /** Seeds the robot's random numbers (the job number). */
  seed: number;
}

export interface CodeJob {
  task: 'build' | 'change' | 'fix';
  world: World;
  /** The student's words ("Fix the bug" from the problem card). */
  words: string;
  level: Level;
  scope?: CastKey | null;
  toneNotes?: string;
  lastRobot?: string | null;
  build?: { plan: PlanReply; starter: StarterId; baseFiles: readonly CodeFile[] };
  /** A fix from the problem card: the errors the running game reported. */
  problems?: readonly FixError[];
  warnings?: readonly string[];
}

export interface PatchMeta {
  summary: string;
  play: string;
  next: string[];
  safety: { status: 'ok' | 'toned-down'; note: string };
}

export type JobResult =
  | { kind: 'accepted'; files: SourceFile[]; meta: PatchMeta; repairs: 0 | 1 | 2; tested: boolean; robot: RobotOutcome | null; checked: Checked; fixes: AppliedFix[] }
  | { kind: 'refused'; note: string }
  | { kind: 'crisis' }
  | { kind: 'failed'; reason: 'validation' | 'runtime' | 'truncated' | 'mismatch' | 'shape' | 'safety'; details: string[] }
  | { kind: 'cancelled' };

type Failed = Extract<JobResult, { kind: 'failed' }>;

export interface JobEvents {
  onProgress(p: AiProgress): void;
  /** New cast members, as soon as a streamed game.js declares them. */
  onArt?(needs: ArtNeed[]): void;
}

class Stopped extends Error {}

/** The first reply's headers are what the student reads; a repair's only fill what is missing. */
function metaOf(prev: PatchMeta | null, patch: Patch): PatchMeta {
  if (prev?.summary) return prev;
  return {
    summary: patch.summary || prev?.summary || '',
    play: patch.play || prev?.play || '',
    next: patch.next.length ? patch.next : (prev?.next ?? []),
    safety: patch.safety.status === 'toned-down' ? { status: 'toned-down', note: patch.safety.note } : (prev?.safety ?? { status: 'ok', note: '' }),
  };
}

const WRITE_TICK_MS = 200;

export async function runCodeJob(job: CodeJob, deps: JobDeps, events: JobEvents, signal: AbortSignal): Promise<JobResult> {
  try {
    return await run(job, deps, events, signal);
  } catch (err) {
    if (err instanceof Stopped || signal.aborted) return { kind: 'cancelled' };
    throw err;
  }
}

async function run(job: CodeJob, deps: JobDeps, events: JobEvents, signal: AbortSignal): Promise<JobResult> {
  const stop = () => {
    if (signal.aborted) throw new Stopped();
  };
  const facts = worldFacts(job.world, { plan: job.build?.plan });
  const world = describeWorld(job.world);
  const baseInput: Omit<UserMessageInput, 'task' | 'files'> = {
    level: job.level,
    words: job.words,
    scope: job.scope ?? null,
    title: job.world.title,
    physics: world.physics,
    cast: world.cast.length || !job.build ? world.cast : planCastLines(job.build.plan, job.world),
    dials: world.dials,
    twistsOn: world.twistsOn,
    groups: world.groups,
    studentEdits: world.studentEdits,
    locked: world.locked,
    lastRobot: job.lastRobot ?? null,
    toneNotes: job.toneNotes,
    build: job.build ? { plan: job.build.plan, starter: job.build.starter, baseFiles: job.build.baseFiles, artKeys: job.build.plan.cast.map((c) => c.key) } : undefined,
  };
  const asCode = (files: readonly SourceFile[]): CodeFile[] => files.map((f) => ({ path: f.path, source: f.content, authors: [], locked: [] }));
  /** A request about `files`, described from those files (their cast and dials). */
  const input = (task: CodeTask, files: readonly SourceFile[], extra: Partial<UserMessageInput> = {}): UserMessageInput => {
    if (!files.length) return { ...baseInput, task, files: [], ...extra };
    const d = describeWorld({ ...job.world, code: asCode(files) });
    return { ...baseInput, task, files: asCode(files), physics: d.physics, cast: d.cast, dials: d.dials, groups: d.groups, ...extra };
  };

  const startBase: SourceFile[] = job.task === 'build' ? toSource(job.build?.baseFiles ?? []) : toSource(job.world.code);
  let base = startBase;
  let request: UserMessageInput =
    job.task === 'build'
      ? input('build', [])
      : job.task === 'fix'
        ? input('fix', base, { fix: fixPart(base, job.problems ?? [], job.warnings ?? []) })
        : input('change', base);
  let isFirstBuild = job.task === 'build';
  let repairs = 0;
  let regenerated = false;
  let meta: PatchMeta | null = null;
  let robot: RobotOutcome | null = null;
  const fixes: AppliedFix[] = [];

  // ---------------------------------------------------------------- one model call, streamed and parsed

  const call = async (req: UserMessageInput): Promise<{ patch: Patch; truncated: boolean }> => {
    stop();
    events.onProgress({ phase: 'writing', chars: 0 });
    let last = 0;
    let file: string | undefined;
    let lines = 0;
    const tick = (force: boolean, chars: number) => {
      const now = Date.now();
      if (!force && now - last < WRITE_TICK_MS) return;
      last = now;
      events.onProgress({ phase: 'writing', file, lines, chars });
    };
    const stream = createPatchStream({
      onFile: (path) => {
        file = path;
        lines = 0;
        tick(true, stream.text.length);
      },
      onLines: (path, n) => {
        file = path;
        lines = n;
      },
      onArt: (art: Record<string, Spec>) => events.onArt?.(Object.entries(art).map(([k, spec], i) => artNeedOf(k, spec, i))),
    });
    const reply = await deps.chat({
      task: req.task,
      user: buildUserMessage(req),
      included: includedOf(req),
      signal,
      onDelta: (delta, text) => {
        stream.feed(delta);
        tick(false, text.length);
      },
      onWaiting: (ms) => events.onProgress({ phase: 'queued', waitMs: ms }),
    });
    stop();
    // A proxy that answered a stream request with plain JSON may deliver everything at the end.
    if (reply.text.length > stream.text.length && reply.text.startsWith(stream.text)) stream.feed(reply.text.slice(stream.text.length));
    return { patch: stream.end(), truncated: reply.truncated };
  };

  /** A reply, with one `continue` when it was cut off. */
  const write = async (req: UserMessageInput, on: readonly SourceFile[]): Promise<{ patch: Patch; ops: FileOp[] } | Failed> => {
    const r1 = await call(req);
    const p1 = r1.patch;
    const cut = !p1.complete && p1.version !== null && (r1.truncated || p1.truncatedIn !== null);
    if (!cut || p1.safety.status === 'refused' || p1.safety.status === 'crisis') return { patch: p1, ops: p1.ops };
    const kept = applyOps(on, p1.ops, { build: req.task === 'build' });
    const received = p1.ops.map((op) => `${op.path} (${op.action})`);
    const r2 = await call({ ...req, task: 'continue', files: asCode(kept.files), continueFrom: { stoppedIn: p1.truncatedIn, received } });
    const p2 = r2.patch;
    if (p2.safety.status === 'refused' || p2.safety.status === 'crisis') return { patch: p2, ops: [] };
    if (!p2.complete && (r2.truncated || p2.truncatedIn !== null)) return { kind: 'failed', reason: 'truncated', details: [p2.truncatedIn ? `The reply stopped inside ${p2.truncatedIn} twice.` : 'The reply stopped twice.'] };
    const patch: Patch = { ...p1, summary: p1.summary || p2.summary, play: p1.play || p2.play, next: p1.next.length ? p1.next : p2.next, complete: true, truncatedIn: null, ops: mergeOps(p1.ops, p2.ops) };
    return { patch, ops: patch.ops };
  };

  const repair = (errors: FixError[], files: SourceFile[], warnings: readonly string[] = []): void => {
    repairs++;
    events.onProgress({ phase: 'fixing', round: repairs as 1 | 2 });
    base = files;
    isFirstBuild = false;
    request = input('fix', files, { fix: fixPart(files, errors, warnings) });
  };

  for (;;) {
    const requestBase = base;
    const reply = await write(request, base);
    if ('kind' in reply) return reply;
    const { patch } = reply;
    if (patch.safety.status === 'refused') return { kind: 'refused', note: patch.safety.note };
    if (patch.safety.status === 'crisis') return { kind: 'crisis' };
    meta = metaOf(meta, patch);
    stop();

    // ---------------------------------------------------------------- applying
    events.onProgress({ phase: 'validating' });
    let applied: Applied = applyOps(base, reply.ops, { build: isFirstBuild });
    // One resend per file whose edits missed; the other files' changes stay.
    for (const failure of [...applied.failures]) {
      const r2 = await write(input('resend', applied.files, { resend: { path: failure.path, edits: editsText(reply.ops, failure.path) } }), applied.files);
      if ('kind' in r2) return r2;
      if (r2.patch.safety.status === 'refused') return { kind: 'refused', note: r2.patch.safety.note };
      if (r2.patch.safety.status === 'crisis') return { kind: 'crisis' };
      const ops = r2.ops.filter((op) => op.path === failure.path);
      const again = ops.length ? applyOps(applied.files, ops) : null;
      if (!again || again.failures.length) return { kind: 'failed', reason: 'mismatch', details: [again?.failures[0]?.message ?? failure.message] };
      applied = { ...again, failures: [] };
    }
    stop();

    // ---------------------------------------------------------------- validating
    const noChange = !reply.ops.length || (applied.files.length === base.length && applied.files.every((f) => base.some((b) => b.path === f.path && b.content === f.content)) && !isFirstBuild);
    if (patch.version === null || noChange) {
      const message = patch.version === null ? 'Your reply was not an AMBLE PATCH. Reply with @@amble-patch 1, the headers, the file blocks and @@end.' : 'Your reply changed no files. Make the change the student asked for.';
      if (repairs >= MAX_REPAIRS) return { kind: 'failed', reason: 'shape', details: [message] };
      repair([{ file: 'game.js', line: 0, column: 0, phase: 'reply', message, count: 1 }], requestBase);
      continue;
    }
    const checked = check(ordered(applied.files), facts);
    fixes.push(...checked.fixes);
    if (!checked.ok) {
      if (repairs >= MAX_REPAIRS) return { kind: 'failed', reason: 'validation', details: checked.errors.slice(0, 5).map(kidIssue) };
      repair(errorsFromIssues(checked.errors), checked.files);
      continue;
    }

    // ---------------------------------------------------------------- the words the game will show
    const screen = await deps.screen(checked.strings.map((s) => s.text), signal);
    stop();
    if (!screen.ok) {
      if (regenerated) return { kind: 'failed', reason: 'safety', details: screen.flagged };
      regenerated = true;
      base = requestBase;
      request = { ...request, notAllowed: screen.flagged };
      continue;
    }

    // ---------------------------------------------------------------- testing
    let tested = false;
    if (deps.robot) {
      events.onProgress({ phase: 'testing' });
      const r = await deps.robot(checked.files.map((f) => ({ path: f.path, source: f.content, authors: [], locked: [] })), { signal, seed: deps.seed });
      stop();
      if (r) {
        robot = r;
        baseInput.lastRobot = r.summary;
        if (!r.pass) {
          if (repairs >= MAX_REPAIRS) return { kind: 'failed', reason: 'runtime', details: r.errors.slice(0, 5).map((e) => `${e.file}${e.line ? ` line ${e.line}` : ''}: ${e.message}`) };
          repair(r.errors, checked.files, r.warnings);
          continue;
        }
        tested = true;
      }
    }

    events.onProgress({ phase: 'swapping' });
    return { kind: 'accepted', files: checked.files, meta: meta ?? { summary: '', play: '', next: [], safety: { status: 'ok', note: '' } }, repairs: repairs as 0 | 1 | 2, tested, robot, checked, fixes };
  }
}
