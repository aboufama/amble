/**
 * The AI helper (§5, §8.4; M5 owns). FOUNDATION-STUB: status 'off'; every job answers `unavailable`, the
 * safety check allows (the core's floor filter is a stub too), and nothing is ever sent.
 */
import { checkText as coreCheckText } from '../cores/ai';
import { t } from '../i18n';
import type { CharacterKind, JointHints } from '../cores/rig';
import type {
  AiOutcome,
  AiProgress,
  AiStatus,
  ArtKind,
  ArtNeed,
  CastKey,
  ExplainOutcome,
  GameManifest,
  Level,
  LocalSteer,
  PlanOutcome,
  PlanReply,
  PlayerError,
  RigKind,
  SafetyVerdict,
  World,
} from '../model/types';

export interface JobOptions {
  signal: AbortSignal;
  onProgress(p: AiProgress): void;
  /** New cast members as soon as the streamed `static art` closes. */
  onArt?(specs: ArtNeed[]): void;
}

export interface AiService {
  status(): AiStatus;
  onStatus(fn: (s: AiStatus) => void): () => void;
  /** Local, instant, offline. */
  checkText(text: string, level: Level): SafetyVerdict;
  /** The local dial/twist matcher (§5.10). */
  steer(text: string, world: World, manifest: GameManifest): LocalSteer | null;
  plan(
    idea: string,
    o: { level: Level; hero: { name: string; kind: ArtKind; rig: RigKind } | null; signal: AbortSignal; onProgress(p: AiProgress): void },
  ): Promise<PlanOutcome>;
  build(world: World, plan: PlanReply, o: JobOptions): Promise<AiOutcome>;
  change(world: World, request: string, o: JobOptions & { scope?: CastKey }): Promise<AiOutcome>;
  fix(world: World, problems: PlayerError[], o: JobOptions): Promise<AiOutcome>;
  explain(world: World, q: { path: string; from: number; to: number; question: string }, o: { signal: AbortSignal }): Promise<ExplainOutcome>;
  rigHints(outline: Blob, kind: CharacterKind, o: { signal: AbortSignal }): Promise<JointHints | null>;
}

export function createAiStub(): AiService {
  const off = { kind: 'unavailable', status: 'off', message: t('common.aiOff') } as const;
  return {
    status: () => 'off',
    onStatus: () => () => undefined,
    checkText: (text, level) => coreCheckText(text, level),
    steer: () => null,
    plan: () => Promise.resolve({ kind: 'cancelled' }),
    build: () => Promise.resolve(off),
    change: () => Promise.resolve(off),
    fix: () => Promise.resolve(off),
    explain: () => Promise.resolve(off),
    rigHints: () => Promise.resolve(null),
  };
}
