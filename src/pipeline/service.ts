/**
 * The AI helper (§5, §8.4 `AiService`): the one place the app asks an AI anything. It follows the
 * district's configuration and the class's mode and level, keeps the helper's status for the chip and
 * the Ask card, screens every request for kid safety, logs every body for What Amble sends, runs the
 * build/change/fix state machine with the robot test, and ends a failed build on the ladder.
 */
import {
  aiAvailable,
  aiStatusOf,
  chatJson,
  chatText,
  checkOutputText,
  checkText,
  isAiError,
  modelFor,
  parsePatch,
  type AiConfig,
  type AiError,
  type ChatStatus,
  type Transport,
} from '../cores/ai';
import type { CharacterKind, JointHints } from '../cores/rig';
import type { AppServicesLike } from './env';
import { t } from '../i18n';
import type {
  AiMode,
  AiOutcome,
  AiStatus,
  ClassLinkV1,
  CodeFile,
  ExplainOutcome,
  GameManifest,
  Level,
  LocalSteer,
  PlanOutcome,
  PlanReply,
  PlayerError,
  SafetyVerdict,
  StarterId,
  World,
  WorldId,
} from '../model/types';
import type { AiService, JobOptions } from './api';
import { explainReplyOf, explainUserMessage, EXPLAIN_SCHEMA, type ExplainWire } from './explain';
import { runCodeJob, type ChatCall, type ChatReply, type CodeJob, type JobResult } from './jobs';
import { ladderFiles } from './ladder';
import { createRequestLog, type RequestLog } from './log';
import { manifestOf, readStatics } from './manifest';
import { flaggedPlanStrings, normalizePlan, planUserMessage, PLAN_SCHEMA, type PlanHero, type PlanWire } from './plan';
import { EXPLAIN_PROMPT } from './prompts/explain';
import { PLAN_PROMPT } from './prompts/plan';
import { RIG_PROMPT } from './prompts/rig';
import { SYSTEM_PROMPT } from './prompts/system';
import { buildJitter, JobLocks, pause } from './queue';
import { dataUrlOf, hintsOf, rigUserText, RIG_SCHEMA, type RigWire } from './rigHints';
import { playerRobot, fixErrorOf, type RobotRunner } from './robot';
import { alternativesFor, refusalNote, screenGameText, screenWords, type WordsVerdict } from './safety';
import { steer as matchSteer } from './steer';
import { authoredRanges, type CodeTask } from './userMessage';
import { findBlock } from './blocks';

/** What the service reads from the app: the resolved config, and the class's mode and level. */
export interface AiEnvConfig {
  ai: AiConfig | null;
  aiMode: AiMode;
  level: Level;
  levelMax: Level;
  classLink: ClassLinkV1 | null;
  school: boolean;
}

export interface AiEnv {
  config(): AiEnvConfig;
  onConfig(fn: () => void): () => void;
  /** The app's services (store, player, starters, history), or null before boot and in tests. */
  services(): AppServicesLike | null;
  transport(config: AiConfig): Transport | null;
  /** Overrides the robot test (tests use a fake robot). */
  robot?: (world: World) => RobotRunner | null;
  random(): number;
  online(): boolean;
  onOnline(fn: () => void): () => void;
  /** Mirrors the status into the app's store (the AI chip reads it). */
  publish?(status: AiStatus): void;
}

/** Per-job limits (§5.1). */
export const TASK_LIMITS: Record<CodeTask, { maxTokens: number; timeoutMs: number }> = {
  build: { maxTokens: 16_000, timeoutMs: 600_000 },
  change: { maxTokens: 8_000, timeoutMs: 420_000 },
  fix: { maxTokens: 6_000, timeoutMs: 300_000 },
  resend: { maxTokens: 8_000, timeoutMs: 300_000 },
  continue: { maxTokens: 8_000, timeoutMs: 300_000 },
};
export const PLAN_LIMITS = { maxTokens: 2_000, timeoutMs: 120_000 };
export const EXPLAIN_LIMITS = { maxTokens: 1_500, timeoutMs: 90_000 };
export const RIG_LIMITS = { maxTokens: 1_000, timeoutMs: 90_000 };
/** A 429 that outlasted the retries clears itself after a minute. */
const BUSY_CLEARS_MS = 60_000;

const LEVELS: Level[] = ['elementary', 'middle', 'high'];
const lowest = (...ls: Array<Level | null | undefined>): Level => LEVELS[Math.min(...ls.filter((l): l is Level => !!l).map((l) => LEVELS.indexOf(l)))] ?? 'middle';

/** The helper as the app uses it: the spec's `AiService` plus what the AI cards need. */
export interface AmbleAi extends AiService {
  /** The level a world's requests are made at (the class's, lowered by the world's assignment). */
  levelFor(world: World | null): Level;
  /** The endpoint's host, for "Amble couldn't reach {host}". */
  host(): string;
  /** Forget a sticky error status (Try again). */
  retry(): void;
  /** A job is running for this world. */
  busy(world: WorldId): boolean;
  /** "passed · 6 s · hero moved · no errors", after a robot test in this session. */
  lastRobot(world: WorldId): string | null;
  /** The district's name for the explainer ("SAU 99"), or null. */
  district(): string | null;
}

function baseStatus(c: AiEnvConfig): AiStatus {
  const ai = c.ai;
  if (!ai) return 'off';
  if (ai.expired || ai.offReason === 'expired') return 'expired';
  if (!aiAvailable(ai)) return 'off';
  const mode: AiMode = c.classLink ? c.aiMode : c.aiMode === 'explain' ? 'explain' : 'on';
  if (mode === 'off') return 'off';
  return mode === 'explain' ? 'explain-only' : 'ready';
}

export function statusMessage(status: AiStatus, host: string): string {
  switch (status) {
    case 'off':
      return t('ai.offTitle');
    case 'offline':
      return t('ai.offline');
    case 'blocked':
      return t('ai.blocked', { host });
    case 'quota':
      return t('ai.quota');
    case 'expired':
      return t('ai.expired');
    case 'rejected':
      return t('ai.rejected');
    case 'busy':
      return t('ai.busy');
    case 'explain-only':
      return t('ai.askExplainLabel');
    case 'ready':
      return '';
  }
}

function patchSummary(text: string): string {
  const p = parsePatch(text);
  if (p.safety.status === 'refused') return t('ai.replyRefused');
  if (p.safety.status === 'crisis') return t('ai.replyCrisis');
  if (!p.complete && p.ops.length === 0) return t('ai.replyCut');
  const files = [...new Set(p.ops.map((op) => op.path))];
  const text2 = files.length ? t('ai.replyChanged', { files: files.join(', ') }) : t('ai.replyNothing');
  return p.complete ? text2 : `${text2} · ${t('ai.replyCut')}`;
}

const byteLength = (s: string) => new TextEncoder().encode(s).length;

export function createAiService(env: AiEnv): AmbleAi {
  const listeners = new Set<(s: AiStatus) => void>();
  const locks = new JobLocks();
  const robots = new Map<WorldId, string>();
  const log: RequestLog = createRequestLog(() => env.services()?.store ?? null);
  let sticky: AiStatus | null = null;
  let stickyTimer: ReturnType<typeof setTimeout> | undefined;
  let jobs = 0;

  const compute = (): AiStatus => {
    const base = baseStatus(env.config());
    if (base !== 'ready' && base !== 'explain-only') return base;
    if (!env.online()) return 'offline';
    return sticky ?? base;
  };
  let current = compute();
  const publish = () => {
    const next = compute();
    if (next === current) return;
    current = next;
    env.publish?.(next);
    for (const fn of listeners) fn(next);
  };
  env.publish?.(current);
  env.onConfig(() => {
    sticky = null;
    publish();
  });
  env.onOnline(() => publish());

  const setSticky = (s: AiStatus | null) => {
    clearTimeout(stickyTimer);
    sticky = s;
    if (s === 'busy') stickyTimer = setTimeout(() => setSticky(null), BUSY_CLEARS_MS);
    publish();
  };

  const config = () => env.config().ai;
  const host = () => {
    const c = config();
    if (!c?.baseUrl) return t('ai.hostFallback');
    try {
      return c.baseUrl.startsWith('/') ? t('ai.hostFallback') : new URL(c.baseUrl).host;
    } catch {
      return t('ai.hostFallback');
    }
  };
  const levelFor = (world: World | null): Level => {
    const c = env.config();
    return lowest(c.level, c.levelMax, world?.assignment?.level ?? null);
  };
  const models = (c: AiConfig) => {
    const main = modelFor(c, 'main');
    return { main, fast: modelFor(c, 'fast') || main, vision: modelFor(c, 'vision') };
  };

  /** Records what a failed call means for the helper's status. */
  const noteError = (err: AiError, tr: Transport): AiStatus | null => {
    const s = aiStatusOf(err.kind, tr.auth === 'dev' ? 'none' : tr.auth);
    if (s && s !== 'off') setSticky(s);
    return s;
  };
  const noteSuccess = () => {
    if (sticky) setSticky(null);
  };

  const unavailable = (status: AiStatus): Extract<AiOutcome, { kind: 'unavailable' }> => ({ kind: 'unavailable', status, message: statusMessage(status, host()) });

  /** A ready transport, or why there is none. */
  const ready = (o: { explain?: boolean } = {}): { transport: Transport; config: AiConfig } | Extract<AiOutcome, { kind: 'unavailable' }> => {
    const status = compute();
    const c = config();
    const allowed = status === 'ready' || (o.explain && status === 'explain-only');
    // A sticky error (blocked, quota...) still lets the student try again: that is how it clears.
    const retryable = status === 'blocked' || status === 'quota' || status === 'busy' || status === 'rejected';
    if (!c || !(allowed || retryable)) return unavailable(status === 'ready' ? 'off' : status);
    const tr = env.transport(c);
    return tr ? { transport: tr, config: c } : unavailable('off');
  };

  const moderationFor = (c: AiConfig, tr: Transport, included: string) => {
    const handle = log.begin({ kind: 'moderation', transport: tr, model: 'moderation', included: [included] });
    return { moderation: c.moderation, transport: handle.transport, end: () => handle.end({ status: 'ok', replySummary: t('ai.replyChecked') }) };
  };

  const screen = async (text: string, level: Level, c: AiConfig, tr: Transport, signal: AbortSignal): Promise<WordsVerdict> => {
    const m = moderationFor(c, tr, t('ai.inclWords'));
    try {
      return await screenWords(text, level, { moderation: m.moderation, transport: m.transport, signal });
    } finally {
      m.end();
    }
  };

  const refusedFrom = (v: Extract<WordsVerdict, { kind: 'refuse' }>): Extract<AiOutcome, { kind: 'refused' }> => ({ kind: 'refused', note: v.note, alternatives: v.alternatives });

  /** The streamed chat for code jobs, logged. */
  const codeChat = (tr: Transport, model: string) => async (call: ChatCall): Promise<ChatReply> => {
    const limits = TASK_LIMITS[call.task];
    const handle = log.begin({ kind: call.task, transport: tr, model, included: call.included });
    try {
      const r = await chatText(handle.transport, {
        model,
        system: SYSTEM_PROMPT,
        user: call.user,
        maxTokens: limits.maxTokens,
        reasoningEffort: 'medium',
        timeoutMs: limits.timeoutMs,
        signal: call.signal,
        onDelta: call.onDelta,
        onStatus: (s: ChatStatus) => {
          if (s.phase === 'retrying') call.onWaiting(s.delayMs, s.reason);
        },
      });
      handle.end({ status: 'ok', replySummary: patchSummary(r.text), bytesReceived: byteLength(r.text) });
      return { text: r.text, truncated: r.truncated };
    } catch (err) {
      const kind = isAiError(err) ? err.kind : 'server';
      handle.end({ status: kind === 'cancelled' ? 'cancelled' : kind === 'refused' ? 'refused' : 'failed', replySummary: t('ai.replyFailed', { why: isAiError(err) ? err.kind : 'error' }) });
      throw err;
    }
  };

  const robotFor = (world: World): RobotRunner | null => {
    if (env.robot) return env.robot(world);
    const s = env.services();
    if (!s?.player || !s.toInit) return null;
    return playerRobot(s.player, () => world, s.toInit);
  };

  /** Code files with provenance: unchanged lines keep their author, new ones are the AI's; locks follow their lines. */
  const withProvenance = (prev: readonly CodeFile[], files: ReadonlyArray<{ path: string; content: string }>): CodeFile[] => {
    const next: CodeFile[] = files.map((f) => ({ path: f.path, source: f.content, authors: [], locked: [] }));
    const hist = env.services()?.history;
    const attributed = hist ? hist.attribute([...prev], next, 'ai') : next.map((f) => ({ ...f, authors: [['ai', f.source.split('\n').length] as ['ai', number]] }));
    return attributed.map((f) => {
      const before = prev.find((p) => p.path === f.path);
      if (!before?.locked.length) return f;
      const lines = before.source.split('\n');
      const locked = before.locked.flatMap(([a, b]) => {
        const at = findBlock(f.source, lines.slice(a - 1, b));
        return at > 0 ? [[at, at + (b - a)] as [number, number]] : [];
      });
      return { ...f, locked };
    });
  };

  /** Did the change rewrite lines the student wrote? */
  const touchedHandEdits = (prev: readonly CodeFile[], next: readonly CodeFile[]): string | null => {
    for (const f of prev) {
      const ranges = authoredRanges(f, 'student');
      if (!ranges.length) continue;
      const after = next.find((n) => n.path === f.path);
      const lines = f.source.split('\n');
      for (const [a, b] of ranges) if (!after || findBlock(after.source, lines.slice(a - 1, b)) < 0) return f.path;
    }
    return null;
  };

  const accepted = (world: World, r: Extract<JobResult, { kind: 'accepted' }>): Extract<AiOutcome, { kind: 'accepted' }> => {
    const files = withProvenance(world.code, r.files);
    const before = readStatics(world.code);
    const statics = readStatics(files);
    const drawn = new Set(Object.values(world.cast).filter((s) => s.art).map((s) => s.key));
    const handFile = touchedHandEdits(world.code, files);
    return {
      kind: 'accepted',
      files,
      manifest: manifestOf(statics, { drawn, dials: world.dials }),
      summary: r.meta.summary,
      play: r.meta.play,
      next: r.meta.next.slice(0, 3),
      safety: r.meta.safety.status === 'toned-down' ? { kind: 'toned-down', note: r.meta.safety.note } : { kind: 'ok', note: '' },
      repairs: r.repairs,
      tested: r.tested,
      handEditsTouched: Boolean(handFile),
      newArt: Object.keys(statics.art).filter((k) => !before.art[k]),
    };
  };

  const fromResult = (world: World, r: JobResult, level: Level): AiOutcome => {
    switch (r.kind) {
      case 'accepted':
        return accepted(world, r);
      case 'refused':
        return { kind: 'refused', note: refusalNote('model', r.note) || t('ai.refusedDefault'), alternatives: alternativesFor('violence', level) };
      case 'crisis':
        return { kind: 'crisis' };
      case 'cancelled':
        return { kind: 'cancelled' };
      case 'failed':
        return { kind: 'failed', reason: r.reason, message: r.reason === 'truncated' ? t('ai.tooBig') : r.reason === 'safety' ? t('ai.wordsNotOk') : t('ai.failed'), details: r.details };
    }
  };

  const fromError = (err: unknown, tr: Transport | null, level: Level): AiOutcome => {
    if (!isAiError(err)) return { kind: 'failed', reason: 'transport', message: t('ai.failed'), details: [err instanceof Error ? err.message : String(err)] };
    if (err.kind === 'cancelled') return { kind: 'cancelled' };
    if (err.kind === 'refused') return { kind: 'refused', note: '', alternatives: alternativesFor('violence', level) };
    const status = tr ? noteError(err, tr) : null;
    if (status) return unavailable(status);
    return { kind: 'failed', reason: 'transport', message: err.kind === 'timeout' ? t('ai.timeout') : err.kind === 'too-long' ? t('ai.tooBig') : t('ai.failed'), details: [err.detail || err.message] };
  };

  /** Runs one code job with everything wired: safety first, the state machine, status and logs. */
  const codeJob = async (job: CodeJob, o: JobOptions, words: string | null): Promise<AiOutcome> => {
    const r = ready();
    if ('kind' in r) return r;
    const release = locks.acquire(job.world.id);
    if (!release) return { kind: 'failed', reason: 'transport', message: t('ai.askStillWorking'), details: [] };
    const { transport: tr, config: c } = r;
    try {
      if (words !== null) {
        o.onProgress({ phase: 'checking' });
        const v = await screen(words, job.level, c, tr, o.signal);
        if (v.kind === 'crisis') return { kind: 'crisis' };
        if (v.kind === 'refuse') return refusedFrom(v);
        if (v.kind === 'pii' && v.block) return { kind: 'refused', note: t('ai.piiBlocked'), alternatives: [] };
        if (v.toneNotes) job = { ...job, toneNotes: v.toneNotes };
      }
      if (o.signal.aborted) return { kind: 'cancelled' };
      const result = await runCodeJob(
        { ...job, lastRobot: robots.get(job.world.id) ?? null },
        {
          chat: codeChat(tr, models(c).main),
          robot: robotFor(job.world),
          screen: async (strings, signal) => {
            const m = moderationFor(c, tr, t('ai.inclGameWords'));
            try {
              return await screenGameText(strings, job.level, { moderation: m.moderation, transport: m.transport, signal });
            } finally {
              m.end();
            }
          },
          seed: ++jobs,
        },
        { onProgress: o.onProgress, onArt: o.onArt },
        o.signal,
      );
      if (result.kind === 'accepted' && result.robot) robots.set(job.world.id, result.robot.summary);
      if (result.kind !== 'cancelled') noteSuccess();
      return fromResult(job.world, result, job.level);
    } catch (err) {
      return fromError(err, tr, job.level);
    } finally {
      release();
    }
  };

  /** The ladder (§5.9): the plan's starter with the plan written in, robot-tested for the record. */
  const ladder = async (world: World, plan: PlanReply, base: readonly CodeFile[], o: JobOptions): Promise<AiOutcome> => {
    const { files } = ladderFiles(plan, base);
    const robot = robotFor({ ...world, code: files });
    if (robot) {
      o.onProgress({ phase: 'testing' });
      const r = await robot(files, { signal: o.signal, seed: ++jobs }).catch(() => null);
      if (r) robots.set(world.id, r.summary);
    }
    const s = env.services();
    const title = s?.starters?.info(plan.starter).title ?? plan.starter;
    return { kind: 'fallback', files, manifest: manifestOf(readStatics(files), { dials: world.dials }), message: `${t('ai.ladder', { starter: title })} ${t('ai.ladderMore')}` };
  };

  const starterFiles = async (id: StarterId): Promise<CodeFile[]> => {
    const s = env.services();
    if (!s?.starters) return [];
    const opened = await s.starters.open(id, { withArt: false });
    return opened.world.code;
  };

  const service: AmbleAi = {
    status: () => current,
    onStatus(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    checkText: (text: string, level: Level): SafetyVerdict => checkText(text, level),
    steer: (text: string, world: World, manifest: GameManifest): LocalSteer | null => matchSteer(text, world, manifest),

    async plan(idea, o): Promise<PlanOutcome> {
      const s = env.services();
      const fallback = (): PlanOutcome => {
        const starter = s?.starters?.matchIdea(idea) ?? 'moon-king';
        const info = s?.starters?.info(starter);
        return { kind: 'fallback', starter, message: t('ai.planFallback', { starter: info?.title ?? starter, type: info?.genre ?? '' }) };
      };
      const r = ready();
      if ('kind' in r) return fallback();
      const { transport: tr, config: c } = r;
      try {
        o.onProgress({ phase: 'checking' });
        const v = await screen(idea, o.level, c, tr, o.signal);
        if (v.kind === 'crisis') return { kind: 'crisis' };
        if (v.kind === 'refuse') return { kind: 'refused', note: v.note, alternatives: v.alternatives };
        if (v.kind === 'pii' && v.block) return { kind: 'refused', note: t('ai.piiBlocked'), alternatives: [] };
        o.onProgress({ phase: 'planning' });
        const hero: PlanHero | null = o.hero;
        const user = planUserMessage(idea, o.level, hero);
        const handle = log.begin({ kind: 'plan', transport: tr, model: models(c).fast, included: hero ? [t('ai.inclIdea'), t('ai.inclHero')] : [t('ai.inclIdea')] });
        let wire: PlanWire;
        try {
          const res = await chatJson<PlanWire>(handle.transport, {
            model: models(c).fast,
            system: PLAN_PROMPT,
            user: v.toneNotes ? `${user}\n${v.toneNotes}` : user,
            schema: PLAN_SCHEMA,
            schemaName: 'amble_plan',
            maxTokens: PLAN_LIMITS.maxTokens,
            reasoningEffort: 'low',
            timeoutMs: PLAN_LIMITS.timeoutMs,
            signal: o.signal,
            onStatus: (st: ChatStatus) => {
              if (st.phase === 'retrying') o.onProgress({ phase: 'queued', waitMs: st.delayMs });
              else if (st.phase === 'writing') o.onProgress({ phase: 'planning', chars: st.chars });
            },
          });
          wire = res.value;
          handle.end({ status: wire.status === 'refused' || wire.status === 'crisis' ? 'refused' : 'ok', replySummary: t('ai.replyPlan', { title: wire.title }), bytesReceived: byteLength(JSON.stringify(wire)) });
        } catch (err) {
          handle.end({ status: isAiError(err) && err.kind === 'cancelled' ? 'cancelled' : 'failed', replySummary: t('ai.replyFailed', { why: isAiError(err) ? err.kind : 'error' }) });
          throw err;
        }
        noteSuccess();
        if (wire.status === 'crisis') return { kind: 'crisis' };
        if (wire.status === 'refused') return { kind: 'refused', note: wire.safetyNote || t('ai.refusedDefault'), alternatives: alternativesFor('violence', o.level) };
        const plan = normalizePlan(wire, hero);
        if (!plan.cast.length) return fallback();
        if (flaggedPlanStrings(plan, o.level).length) return { kind: 'refused', note: t('ai.wordsNotOk'), alternatives: alternativesFor('violence', o.level) };
        return { kind: 'plan', plan };
      } catch (err) {
        if (isAiError(err)) {
          if (err.kind === 'cancelled') return { kind: 'cancelled' };
          if (err.kind === 'refused') return { kind: 'refused', note: '', alternatives: alternativesFor('violence', o.level) };
          noteError(err, tr);
        }
        return fallback();
      }
    },

    async build(world, plan, o) {
      const r = ready();
      if ('kind' in r) return r;
      const level = levelFor(world);
      o.onProgress({ phase: 'queued', waitMs: 0 });
      if (!(await pause(buildJitter(env.random), o.signal))) return { kind: 'cancelled' };
      let base: CodeFile[] = [];
      try {
        base = await starterFiles(plan.starter);
      } catch {
        base = [];
      }
      const outcome = await codeJob({ task: 'build', world, words: plan.pitch || plan.title, level, build: { plan, starter: plan.starter, baseFiles: base } }, o, null);
      if (outcome.kind === 'accepted' || outcome.kind === 'cancelled' || outcome.kind === 'crisis' || !base.length) return outcome;
      // Every other failure still ends in a playable world starring the student's drawing.
      return ladder(world, plan, base, o);
    },

    change(world, request, o) {
      return codeJob({ task: 'change', world, words: request, level: levelFor(world), scope: o.scope ?? null }, o, request);
    },

    fix(world, problems: PlayerError[], o) {
      return codeJob({ task: 'fix', world, words: t('ai.stepFixedPlain'), level: levelFor(world), problems: problems.slice(0, 5).map(fixErrorOf) }, o, null);
    },

    async explain(world, q, o): Promise<ExplainOutcome> {
      const r = ready({ explain: true });
      if ('kind' in r) return r;
      const { transport: tr, config: c } = r;
      const level = levelFor(world);
      const user = explainUserMessage(world, q, level);
      if (!user) return { kind: 'failed', reason: 'shape', message: t('ai.explainFailed'), details: [`${q.path} was not found.`] };
      try {
        if (q.question.trim()) {
          const v = await screen(q.question, level, c, tr, o.signal);
          if (v.kind === 'crisis') return { kind: 'crisis' };
          if (v.kind === 'refuse') return refusedFrom(v);
        }
        const handle = log.begin({ kind: 'explain', transport: tr, model: models(c).fast, included: [t('ai.inclLines'), t('ai.inclQuestion')] });
        try {
          const res = await chatJson<ExplainWire>(handle.transport, { model: models(c).fast, system: EXPLAIN_PROMPT, user, schema: EXPLAIN_SCHEMA, schemaName: 'amble_explain', maxTokens: EXPLAIN_LIMITS.maxTokens, reasoningEffort: 'low', timeoutMs: EXPLAIN_LIMITS.timeoutMs, signal: o.signal });
          handle.end({ status: 'ok', replySummary: t('ai.replyExplained'), bytesReceived: byteLength(JSON.stringify(res.value)) });
          noteSuccess();
          const reply = explainReplyOf(res.value, q);
          const flagged = checkOutputText([reply.answer, ...reply.lines.map((l) => l.note)], level).flagged;
          if (flagged.length) return { kind: 'failed', reason: 'safety', message: t('ai.wordsNotOk'), details: [] };
          return { kind: 'explained', reply };
        } catch (err) {
          handle.end({ status: isAiError(err) && err.kind === 'cancelled' ? 'cancelled' : 'failed', replySummary: t('ai.replyFailed', { why: isAiError(err) ? err.kind : 'error' }) });
          throw err;
        }
      } catch (err) {
        const out = fromError(err, tr, level);
        return out.kind === 'accepted' || out.kind === 'fallback' ? { kind: 'failed', reason: 'transport', message: t('ai.explainFailed'), details: [] } : out;
      }
    },

    async rigHints(outline: Blob, kind: CharacterKind, o): Promise<JointHints | null> {
      const r = ready();
      if ('kind' in r) return null;
      const { transport: tr, config: c } = r;
      const vision = models(c).vision;
      if (!c.visionAllowed || !vision || tr.caps.images === false) return null;
      const store = env.services()?.store;
      const noVision = (await store?.settings.get('noVision').catch(() => null)) ?? [];
      if (noVision.includes(c.baseUrl)) return null;
      try {
        const bitmap = await createImageBitmap(outline);
        const { width, height } = bitmap;
        bitmap.close();
        const handle = log.begin({ kind: 'rig', transport: tr, model: vision, included: [t('ai.inclOutline')] });
        try {
          const res = await chatJson<RigWire>(handle.transport, {
            model: vision,
            system: RIG_PROMPT,
            user: [
              { type: 'text', text: rigUserText(kind) },
              { type: 'image_url', image_url: { url: await dataUrlOf(outline), detail: 'low' } },
            ],
            schema: RIG_SCHEMA,
            schemaName: 'amble_rig',
            maxTokens: RIG_LIMITS.maxTokens,
            reasoningEffort: 'low',
            timeoutMs: RIG_LIMITS.timeoutMs,
            signal: o.signal,
          });
          handle.end({ status: 'ok', replySummary: t('ai.replyJoints', { n: res.value.joints.length }), bytesReceived: byteLength(JSON.stringify(res.value)) });
          if (res.imagesDropped) {
            // The endpoint can't see pictures: never ask it again, silently.
            await store?.settings.put('noVision', [...new Set([...noVision, c.baseUrl])]).catch(() => undefined);
            return null;
          }
          noteSuccess();
          return hintsOf(res.value, kind, width, height);
        } catch (err) {
          handle.end({ status: isAiError(err) && err.kind === 'cancelled' ? 'cancelled' : 'failed', replySummary: t('ai.replyFailed', { why: isAiError(err) ? err.kind : 'error' }) });
          throw err;
        }
      } catch (err) {
        if (isAiError(err) && err.kind !== 'cancelled') noteError(err, tr);
        return null;
      }
    },

    levelFor,
    host,
    retry: () => setSticky(null),
    busy: (world) => locks.isBusy(world),
    lastRobot: (world) => robots.get(world) ?? null,
    district: () => config()?.district?.name ?? env.config().classLink?.district ?? null,
  };
  return service;
}
