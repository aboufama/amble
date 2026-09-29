/**
 * The app's AI helper as it starts (§5, §8.4). Ready at boot: its status (the AI chip), the local safety
 * floor (`checkText`) and local steering (`steer`), all synchronous and offline. The pipeline itself
 * (prompts, the AMBLE PATCH parser, the validator and acorn, the transport) is not part of the first load:
 * it loads with the first job and builds on the same core, so status, locks and robot summaries are one.
 */
import { checkText } from '../cores/ai';
import { createAiCore, type AiCore, type AiEnv } from './core';
import type { AmbleAi } from './service';
import { steer } from './steer';

/** What the pipeline's module hands the helper when it loads (./pipeline.ts). */
export interface Pipeline {
  createAiService(env: AiEnv, core: AiCore): AmbleAi;
  transportFor: AiEnv['transport'];
}

export function createLazyAi(env: Omit<AiEnv, 'transport'>, load: () => Promise<Pipeline>): AmbleAi {
  const core = createAiCore(env);
  let full: Promise<AmbleAi> | null = null;
  const pipeline = (): Promise<AmbleAi> => {
    if (!full) {
      const loading = load().then((m) => m.createAiService({ ...env, transport: (c) => m.transportFor(c) }, core));
      // A load that failed (the connection dropped before the files were cached) is tried again next time.
      loading.catch(() => {
        if (full === loading) full = null;
      });
      full = loading;
    }
    return full;
  };
  return {
    status: core.status,
    onStatus: core.onStatus,
    checkText: (text, level) => checkText(text, level),
    steer: (text, world, manifest) => steer(text, world, manifest),
    plan: async (idea, o) => (await pipeline()).plan(idea, o),
    build: async (world, plan, o) => (await pipeline()).build(world, plan, o),
    change: async (world, request, o) => (await pipeline()).change(world, request, o),
    fix: async (world, problems, o) => (await pipeline()).fix(world, problems, o),
    explain: async (world, q, o) => (await pipeline()).explain(world, q, o),
    rigHints: async (outline, kind, o) => (await pipeline()).rigHints(outline, kind, o),
    levelFor: core.levelFor,
    host: core.host,
    retry: () => core.setSticky(null),
    busy: (world) => core.locks.isBusy(world),
    lastRobot: (world) => core.robots.get(world) ?? null,
    district: core.district,
  };
}
