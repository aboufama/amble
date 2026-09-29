/** The helper as the app starts it: status and the local checks at once, the pipeline with the first job. */
import { describe, expect, it, vi } from 'vitest';
import { checkText, mergeLayers, type AiConfig, type Transport } from '../../src/cores/ai';
import { EMPTY_MANIFEST, type GameManifest } from '../../src/cores/play';
import type { AiMode, ClassLinkV1, Level, PlanOutcome } from '../../src/model/types';
import type { AiCore, AiEnv, AiEnvConfig } from '../../src/pipeline/core';
import { createLazyAi, type Pipeline } from '../../src/pipeline/lazy';
import { dialInfoOf } from '../../src/pipeline/manifest';
import type { AmbleAi } from '../../src/pipeline/service';
import { steer } from '../../src/pipeline/steer';
import { PLAN_SNAIL, world } from './helpers';

const AI: AiConfig = mergeLayers([{ source: 'class-link', baseUrl: 'https://ai.example.org/v1', auth: { type: 'class-code', header: 'X-Amble-Class', code: 'MAPLE-7Q2K' }, model: 'main-model', moderation: 'local-only', caps: {} }]);

function env(): Omit<AiEnv, 'transport'> {
  const config: AiEnvConfig = { ai: AI, aiMode: 'on' as AiMode, level: 'middle' as Level, levelMax: 'high' as Level, classLink: null as ClassLinkV1 | null, school: true };
  return { config: () => config, onConfig: () => () => undefined, services: () => null, random: () => 0, online: () => true, onOnline: () => () => undefined };
}

const PLANNED: PlanOutcome = { kind: 'plan', plan: PLAN_SNAIL } as PlanOutcome;
const planJob = () => ({ level: 'middle' as Level, hero: null, signal: new AbortController().signal, onProgress: () => undefined });

/** A pipeline module whose service answers every plan with PLANNED. */
function fakePipeline() {
  const transport = { name: 'fake' } as unknown as Transport;
  const pipeline = {
    createAiService: vi.fn((_env: AiEnv, _core: AiCore) => ({ plan: vi.fn(async () => PLANNED) }) as unknown as AmbleAi),
    transportFor: vi.fn(() => transport),
  } satisfies Pipeline;
  return { pipeline, transport };
}

describe('the helper before its first job', () => {
  it('knows its status and checks text and steers locally without loading the pipeline', () => {
    const load = vi.fn<() => Promise<Pipeline>>();
    const ai = createLazyAi(env(), load);
    expect(ai.status()).toBe('ready');
    expect(ai.checkText('my phone is 603-555-0182', 'middle')).toEqual(checkText('my phone is 603-555-0182', 'middle'));
    const manifest: GameManifest = { ...EMPTY_MANIFEST, dials: [dialInfoOf('speed', { label: 'Speed', value: 200, min: 100, max: 400, step: 10, words: 'fast slow' })] };
    expect(ai.steer('make it faster', world(), manifest)).toEqual(steer('make it faster', world(), manifest));
    expect(ai.busy(world().id)).toBe(false);
    expect(ai.lastRobot(world().id)).toBeNull();
    expect(load).not.toHaveBeenCalled();
  });
});

describe('the pipeline', () => {
  it('loads once, with the first job, over the same status and locks', async () => {
    const { pipeline, transport } = fakePipeline();
    const load = vi.fn(async () => pipeline);
    const ai = createLazyAi(env(), load);
    const [a, b] = await Promise.all([ai.plan('a snail race', planJob()), ai.plan('a moon party', planJob())]);
    expect(a).toBe(PLANNED);
    expect(b).toBe(PLANNED);
    expect(load).toHaveBeenCalledTimes(1);
    expect(pipeline.createAiService).toHaveBeenCalledTimes(1);
    const [fullEnv, core] = pipeline.createAiService.mock.calls[0];
    // One core: the chip, the locks and the robot summaries are the same before and after the load.
    expect(core.status).toBe(ai.status);
    expect(core.onStatus).toBe(ai.onStatus);
    // The transport comes with the pipeline.
    expect(fullEnv.transport(AI)).toBe(transport);
    expect(pipeline.transportFor).toHaveBeenCalledWith(AI);
    await ai.plan('a third idea', planJob());
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('is loaded again after a load that failed', async () => {
    const { pipeline } = fakePipeline();
    const load = vi.fn<() => Promise<Pipeline>>().mockRejectedValueOnce(new TypeError('Failed to fetch dynamically imported module')).mockResolvedValue(pipeline);
    const ai = createLazyAi(env(), load);
    await expect(ai.plan('a snail race', planJob())).rejects.toThrow('dynamically imported');
    await expect(ai.plan('a snail race', planJob())).resolves.toBe(PLANNED);
    expect(load).toHaveBeenCalledTimes(2);
  });
});
