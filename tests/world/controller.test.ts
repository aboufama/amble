/**
 * The world screen's controller (§2.6): a world that is not in the store (a discarded starter copy
 * reached with the browser's Back button, an old address) is reported, so the screen can go to the Trail
 * instead of showing a loading picture forever.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setServices, type Services } from '../../src/app/services';
import { EMPTY_MANIFEST } from '../../src/cores/play';
import { createHistory } from '../../src/history/api';
import { closeWorld } from '../../src/state/session';
import { resetState } from '../../src/state/store';
import { createStarterCatalog } from '../../src/starters/api';
import { MemoryStore } from '../../src/store/memory';
import { WorldController } from '../../src/world/controller';
import { sampleWorld } from '../foundation/samples';

const g = globalThis as { document?: unknown };
let hadDocument = false;

beforeEach(async () => {
  resetState();
  closeWorld();
  hadDocument = 'document' in g;
  if (!hadDocument) g.document = { addEventListener: () => undefined, removeEventListener: () => undefined, visibilityState: 'visible', documentElement: { dataset: {} } };
  const noop = () => undefined;
  const player = { load: vi.fn(async () => EMPTY_MANIFEST), manifest: () => EMPTY_MANIFEST, snapshot: async () => null, setTitle: noop, setMode: noop, on: () => noop, onObjects: () => noop };
  const store = new MemoryStore();
  await store.commit({ worlds: [sampleWorld({ id: 'w_here000001' })] });
  setServices({ store, player, history: createHistory(), starters: createStarterCatalog() } as unknown as Services);
});

afterEach(() => {
  if (!hadDocument) delete g.document;
});

describe('WorldController', () => {
  it('says when the world is not there', async () => {
    const onMissing = vi.fn();
    const c = new WorldController('w_gone000001', { onLift: vi.fn(), onEscape: vi.fn(), onMissing });
    await c.start();
    c.stop();
    expect(onMissing).toHaveBeenCalledTimes(1);
  });

  it('opens a world that is there', async () => {
    const onMissing = vi.fn();
    const c = new WorldController('w_here000001', { onLift: vi.fn(), onEscape: vi.fn(), onMissing });
    await c.start();
    c.stop();
    expect(onMissing).not.toHaveBeenCalled();
  });
});
