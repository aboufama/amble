/**
 * The AI helper (§5, §8.4; M5 owns): the interface every screen uses, and the service main.tsx creates.
 * `createAiStub` keeps the name services.ts calls; it now returns the real helper (`createAiService`
 * over the app's config, store, player and starters). With no AI configured its status is 'off' and
 * nothing is ever sent.
 */
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
import { setAiStatus } from '../state/ai';
import { appEnv } from './env';
import { createAiService, type AmbleAi } from './service';

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
  /** Joint hints in the outline image's pixels (scale them to the drawing), or null. */
  rigHints(outline: Blob, kind: CharacterKind, o: { signal: AbortSignal }): Promise<JointHints | null>;
}

export { createAiService, type AmbleAi };

/** The app's AI helper, wired to the store (its status feeds the AI chip). */
export function createAppAi(): AmbleAi {
  return createAiService(appEnv(setAiStatus));
}

/** The name services.ts uses; it returns the real helper now. */
export function createAiStub(): AiService {
  return createAppAi();
}

/** The helper's richer interface, when the app's service is ours (it always is, outside tests). */
export function asAmbleAi(ai: AiService): AmbleAi | null {
  return 'levelFor' in ai && 'host' in ai ? (ai as AmbleAi) : null;
}
