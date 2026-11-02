import { beforeEach, describe, expect, it } from 'vitest';
import { chatTokens, costOf, formatUsd, imageTokens, priceOf, recordPlanCall, recordUsage, resetSpend, totalCalls, totalUsd, useSpend } from '../src/compiler/spend';
import { DEFAULT_SETTINGS } from '../src/compiler/openai';
import { MODES, modeOf, modeSettings } from '../src/compiler/models';
import { upgradeSettings } from '../src/project/persistence';

describe('prices', () => {
  it('matches models and their dated snapshots by family', () => {
    expect(priceOf('gpt-6.1-terra')?.output).toBe(5);
    expect(priceOf('gpt-6.1-terra-2026-10-26')?.output).toBe(5);
    expect(priceOf('gpt-6-luna')?.input).toBe(0.1);
    expect(priceOf('gpt-6.1-sol')?.input).toBe(2);
    expect(priceOf('gpt-6-sol')?.cachedInput).toBe(0.2);
    expect(priceOf('my-local-model')).toBeNull();
  });

  it('prices a compile: uncached input, cached input, cache writes and output (reasoning included)', () => {
    const t = chatTokens({ prompt_tokens: 20_000, completion_tokens: 6_000, prompt_tokens_details: { cached_tokens: 8_000, cache_write_tokens: 2_000 }, completion_tokens_details: { reasoning_tokens: 4_000 } });
    expect(t).toEqual({ input: 20_000, cached: 8_000, cacheWrite: 2_000, output: 6_000, reasoning: 4_000, imageInput: 0 });
    // Terra: 10k × $1 + 8k × $0.05 + 2k × $1.25 + 6k × $5, per million.
    expect(costOf('gpt-6.1-terra', t)).toBeCloseTo((10_000 * 1 + 8_000 * 0.05 + 2_000 * 1.25 + 6_000 * 5) / 1e6, 10);
    // Luna: 10k × $0.10 + 8k × $0.01 + 2k × $0.125 + 6k × $0.50.
    expect(costOf('gpt-6-luna', t)).toBeCloseTo((10_000 * 0.1 + 8_000 * 0.01 + 2_000 * 0.125 + 6_000 * 0.5) / 1e6, 10);
  });

  it('bills long prompts at the long-context rates', () => {
    const t = chatTokens({ prompt_tokens: 300_000, completion_tokens: 1_000 });
    expect(costOf('gpt-6.1-terra', t)).toBeCloseTo((300_000 * 1 * 2 + 1_000 * 5 * 1.5) / 1e6, 10);
  });

  it('prices images by text and image tokens', () => {
    const t = imageTokens({ input_tokens: 100, output_tokens: 1_000, input_tokens_details: { text_tokens: 100, image_tokens: 0 } });
    expect(costOf('gpt-image-2.5-flare', t)).toBeCloseTo((100 * 5 + 1_000 * 30) / 1e6, 10);
  });

  it('formats small amounts with more digits', () => {
    expect(formatUsd(0)).toBe('$0.00');
    expect(formatUsd(0.00421)).toBe('$0.0042');
    expect(formatUsd(0.1234)).toBe('$0.123');
    expect(formatUsd(12.345)).toBe('$12.35');
  });
});

describe('the running total', () => {
  beforeEach(() => resetSpend());

  it('adds up requests by model, and counts the ones it cannot price', () => {
    recordUsage('gpt-6.1-terra', 'code', chatTokens({ prompt_tokens: 200_000, completion_tokens: 0 }));
    recordUsage('gpt-6-luna', 'art', chatTokens({ prompt_tokens: 0, completion_tokens: 1_000_000 }));
    recordUsage('gpt-6-luna', 'code', null);
    recordUsage('someone-elses-model', 'code', chatTokens({ prompt_tokens: 10, completion_tokens: 10 }));
    recordPlanCall('gpt-6-astra', 'code');
    const s = useSpend.getState();
    expect(totalUsd(s)).toBeCloseTo(0.2 + 0.5, 10);
    expect(totalCalls(s)).toBe(5);
    expect(s.byModel['gpt-6-luna']).toMatchObject({ calls: 2, output: 1_000_000, incomplete: 1 });
    expect(s.byModel['someone-elses-model']).toMatchObject({ calls: 1, usd: 0, unpriced: 1 });
    expect(s.byModel['gpt-6-astra (ChatGPT plan)']).toMatchObject({ calls: 1, usd: 0 });
    expect(s.last?.model).toBe('gpt-6-astra (ChatGPT plan)');
    resetSpend();
    expect(totalCalls(useSpend.getState())).toBe(0);
  });
});

describe('build modes', () => {
  it('starts in Best: GPT-6.1 Terra with high reasoning', () => {
    expect(modeOf(DEFAULT_SETTINGS)).toBe('best');
    expect(DEFAULT_SETTINGS).toMatchObject({ model: 'gpt-6.1-terra', reasoningEffort: 'high', assetModel: 'gpt-6.1-terra' });
  });

  it('Efficient runs GPT-6 Luna with high reasoning', () => {
    expect(modeSettings('efficient')).toEqual({ model: 'gpt-6-luna', reasoningEffort: 'high', assetModel: 'gpt-6-luna' });
    expect(modeOf({ ...DEFAULT_SETTINGS, ...modeSettings('efficient') })).toBe('efficient');
  });

  it('models picked by hand are neither mode', () => {
    expect(modeOf({ ...DEFAULT_SETTINGS, reasoningEffort: 'low' })).toBeNull();
    expect(modeOf({ ...DEFAULT_SETTINGS, model: 'gpt-6-astra' })).toBeNull();
    // An empty asset model means "same as the model".
    expect(modeOf({ ...DEFAULT_SETTINGS, ...modeSettings('efficient'), assetModel: '' })).toBe('efficient');
    expect(Object.keys(MODES)).toEqual(['best', 'efficient']);
  });

  it('moves settings saved with retired models to the default mode, and keeps the rest', () => {
    const old = upgradeSettings({ apiKey: 'sk-x', model: 'gpt-5', reasoningEffort: 'low', assetModel: 'gpt-5-mini', imageModel: 'gpt-image-1', artMode: 'image' });
    expect(old).toMatchObject({ apiKey: 'sk-x', model: 'gpt-6.1-terra', reasoningEffort: 'high', assetModel: 'gpt-6.1-terra', imageModel: 'gpt-image-2.5-flare', artMode: 'image' });
    const mine = upgradeSettings({ model: 'gpt-6-astra', reasoningEffort: 'medium', assetModel: 'gpt-5-mini' });
    expect(mine).toMatchObject({ model: 'gpt-6-astra', reasoningEffort: 'medium', assetModel: 'gpt-6.1-terra' });
    expect(upgradeSettings({})).toEqual(DEFAULT_SETTINGS);
  });
});
