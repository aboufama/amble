/**
 * Asks the world screen sends itself (§2.6: Ask Amble to fix it, Add someone, Ask Amble to add them) run as
 * the AI slice's jobs, like any Ask: the Ask card's Stop stops them, and their outcome (a failure, a
 * refusal, the crisis card) shows in the Ask card.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setServices, type Services } from '../../src/app/services';
import { EMPTY_MANIFEST } from '../../src/cores/play';
import { createHistory } from '../../src/history/api';
import type { AiOutcome, World } from '../../src/model/types';
import { stopJob } from '../../src/state/ai';
import { closeWorld, flushWorld, openWorld } from '../../src/state/session';
import { getState, resetState } from '../../src/state/store';
import { createStarterCatalog } from '../../src/starters/api';
import { MemoryStore } from '../../src/store/memory';
import { runAsk } from '../../src/world/ask';
import { sampleWorld } from '../foundation/samples';

function waitForAbort(signal: AbortSignal | undefined): Promise<AiOutcome> {
  return new Promise((resolve) => {
    signal?.addEventListener('abort', () => resolve({ kind: 'cancelled' }));
  });
}

let world: World;
let ai: { change: ReturnType<typeof vi.fn>; fix: ReturnType<typeof vi.fn> };

beforeEach(async () => {
  resetState();
  closeWorld();
  const store = new MemoryStore();
  ai = { change: vi.fn(), fix: vi.fn() };
  const noop = () => undefined;
  const player = { load: vi.fn(async () => EMPTY_MANIFEST), setTitle: noop, setMode: noop, on: () => noop, onObjects: () => noop };
  setServices({ store, ai, player, history: createHistory(), starters: createStarterCatalog() } as unknown as Services);
  world = sampleWorld({ id: 'w_asking0001' });
  await store.commit({ worlds: [world] });
  await openWorld(world.id);
});

afterEach(async () => {
  await flushWorld();
});

describe("the world screen's own asks", () => {
  it('stop when the Ask card says Stop', async () => {
    ai.fix.mockImplementation((_w: World, _p: unknown, o: { signal?: AbortSignal }) => waitForAbort(o.signal));
    const job = runAsk('fix', 'Ask Amble to fix it', { problems: [] });
    await vi.waitFor(() => expect(getState().ai.job?.worldId).toBe(world.id));
    stopJob(world.id);
    const outcome = await Promise.race([job, new Promise<null>((r) => setTimeout(() => r(null), 500))]);
    expect(outcome?.kind).toBe('cancelled');
    expect(getState().ai.job).toBeNull();
  });

  it('show their outcome in the Ask card (the crisis card, a failure)', async () => {
    ai.change.mockResolvedValue({ kind: 'crisis' });
    await runAsk('change', 'Add Bubbles, a friend: something worrying');
    expect(getState().ai.outcomeFor).toMatchObject({ worldId: world.id, task: 'change' });
    expect(getState().ai.lastOutcome?.kind).toBe('crisis');
    // A refusal prints its footstep (the category only, never the words).
    await vi.waitFor(() => expect(getState().session.world?.steps.at(-1)?.kind).toBe('refused'));
  });
});
