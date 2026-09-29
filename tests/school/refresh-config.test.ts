/**
 * Reading the configuration again (after Join, Leave, or Settings): overlapping reads can finish out of order
 * (Join, then Leave at once), and the newest one always wins. An older read never writes over a newer one.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AiConfig } from '../../src/cores/ai';
import { refreshConfig } from '../../src/state/config';
import { getState, resetState } from '../../src/state/store';

const resolveAiConfig = vi.hoisted(() => vi.fn<() => Promise<unknown>>());
vi.mock('../../src/cores/ai', async (importOriginal) => ({ ...(await importOriginal<object>()), resolveAiConfig }));

const joined = { enabled: true, baseUrl: 'https://ai.class.test/v1', expired: false, source: 'class-link' } as unknown as AiConfig;
const left = { enabled: false, baseUrl: '', expired: false, source: 'none' } as unknown as AiConfig;

/** A read that finishes when the test says so. */
function slowRead(): { read: Promise<unknown>; finish(c: AiConfig): void } {
  let finish: (c: AiConfig) => void = () => undefined;
  const read = new Promise<unknown>((r) => (finish = r));
  return { read, finish };
}

beforeEach(() => {
  resetState();
  resolveAiConfig.mockReset();
});

describe('refreshConfig', () => {
  it('keeps the newest read when an older one finishes last (Join, then Leave at once)', async () => {
    const join = slowRead();
    const leave = slowRead();
    resolveAiConfig.mockReturnValueOnce(join.read).mockReturnValueOnce(leave.read);
    const first = refreshConfig();
    const second = refreshConfig();
    leave.finish(left);
    await second;
    expect(getState().config.ai).toEqual(left);
    join.finish(joined);
    await first;
    expect(getState().config.ai).toEqual(left);
    expect(getState().config.aiMode).toBe('off');
  });

  it('writes each read that finishes in order', async () => {
    resolveAiConfig.mockResolvedValueOnce(joined).mockResolvedValueOnce(left);
    await refreshConfig();
    expect(getState().config.ai).toEqual(joined);
    await refreshConfig();
    expect(getState().config.ai).toEqual(left);
  });

  it('still writes an older read when the newer one failed', async () => {
    const join = slowRead();
    resolveAiConfig.mockReturnValueOnce(join.read).mockRejectedValueOnce(new Error('storage blocked'));
    const first = refreshConfig();
    await expect(refreshConfig()).rejects.toThrow('storage blocked');
    join.finish(joined);
    await first;
    expect(getState().config.ai).toEqual(joined);
  });
});
