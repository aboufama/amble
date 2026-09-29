/** M5's starting point (FOUNDATION-STUB test; M5 replaces it): the AI service stub is off and safe. */
import { describe, expect, it } from 'vitest';
import { createAiStub } from '../../src/pipeline/api';
import { EMPTY_MANIFEST } from '../../src/cores/play';
import { sampleWorld } from '../foundation/samples';

describe('pipeline (stub)', () => {
  it('reports off and answers every job with "unavailable" or "cancelled"', async () => {
    const ai = createAiStub();
    expect(ai.status()).toBe('off');
    const signal = new AbortController().signal;
    const outcome = await ai.change(sampleWorld(), 'make the jump floatier', { signal, onProgress: () => undefined });
    expect(outcome.kind).toBe('unavailable');
    const plan = await ai.plan('a snail boss fight', { level: 'middle', hero: null, signal, onProgress: () => undefined });
    expect(plan.kind).toBe('cancelled');
    expect(ai.steer('make the jump floatier', sampleWorld(), EMPTY_MANIFEST)).toBeNull();
  });

  it('checks student text locally', () => {
    const ai = createAiStub();
    expect(ai.checkText('make the boss bigger', 'middle').kind).toBe('allow');
  });
});
