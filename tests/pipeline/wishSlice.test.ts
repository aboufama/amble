/**
 * A wish in the open world, through the `ai` slice (MAGIC-BRIEF.md): it goes at once (nothing opens before
 * a first wish), lands as one "Done!" toast whose footstep carries the student's words, See what changed
 * asks Footsteps for that step, and Undo goes back to the step before it as a new footstep. What the AI
 * wrote in its own voice ("I made…") never reaches the footstep, the toast or the idea chips.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setServices, type Services } from '../../src/app/services';
import { EMPTY_MANIFEST, type GameManifest } from '../../src/cores/play';
import { createHistory } from '../../src/history/api';
import type { AiOutcome, World } from '../../src/model/types';
import { onSeeChange } from '../../src/screens/footsteps/seeChange';
import { dismissChangeToast, seeWish, startChange, undoWish } from '../../src/state/ai';
import { setRoute } from '../../src/state/app';
import { closeWorld, flushWorld, openWorld, patchSession } from '../../src/state/session';
import { getState, resetState } from '../../src/state/store';
import { createStarterCatalog } from '../../src/starters/api';
import { MemoryStore } from '../../src/store/memory';
import { SAMPLE_CODE, sampleWorld } from '../foundation/samples';

const MANIFEST: GameManifest = { ...EMPTY_MANIFEST, title: 'Moon King', kit: true };

function accepted(over: Partial<Extract<AiOutcome, { kind: 'accepted' }>> = {}): Extract<AiOutcome, { kind: 'accepted' }> {
  return {
    kind: 'accepted',
    files: [{ path: 'game.js', source: `${SAMPLE_CODE}\n// fireballs`, authors: [], locked: [] }],
    manifest: MANIFEST,
    summary: 'Now the Moon King throws fireballs.',
    play: '',
    next: ['Make the fireballs bigger'],
    safety: { kind: 'ok', note: '' },
    repairs: 0,
    tested: true,
    handEditsTouched: false,
    newArt: [],
    ...over,
  };
}

let store: MemoryStore;
let world: World;
let ai: { change: ReturnType<typeof vi.fn> };

beforeEach(async () => {
  resetState();
  closeWorld();
  store = new MemoryStore();
  ai = { change: vi.fn() };
  const noop = () => undefined;
  const player = { load: vi.fn(async () => MANIFEST), setTitle: noop, setMode: noop, promote: vi.fn(async () => undefined), on: () => noop, onObjects: () => noop };
  const history = createHistory();
  setServices({ store, ai, player, history, starters: createStarterCatalog() } as unknown as Services);
  world = sampleWorld({ id: 'w_wishes0001', cast: {}, dials: {}, twists: [] });
  await store.commit({ worlds: [world] });
  await openWorld(world.id);
  patchSession({ manifest: MANIFEST, ready: true });
  // Footsteps gives the first step its snapshot when the world opens.
  await history.ensureHead(getState().session.world!);
  setRoute({ name: 'world', id: world.id });
});

afterEach(async () => {
  await flushWorld();
});

describe('a wish', () => {
  it('goes at once, even on a device that has never made one', async () => {
    ai.change.mockResolvedValue(accepted());
    expect(getState().prefs.seen.aiExplainer).toBeFalsy();
    const out = await startChange(getState().session.world!, 'make the moon king throw fireballs');
    expect(ai.change).toHaveBeenCalledTimes(1);
    expect(out.kind).toBe('accepted');
  });

  it('lands with "Done!", and its footstep carries the words', async () => {
    ai.change.mockResolvedValue(accepted());
    await startChange(getState().session.world!, 'make the moon king throw fireballs');
    const step = getState().session.world!.steps.at(-1)!;
    expect(step).toMatchObject({ kind: 'ask', by: 'ai', text: 'Now the Moon King throws fireballs.', request: 'make the moon king throw fireballs' });
    expect(getState().ai.landed).toMatchObject({ worldId: world.id, stepId: step.id, text: 'Done! Now the Moon King throws fireballs.' });
    expect(getState().app.announce.polite).toBe('Done! Now the Moon King throws fireballs.');
  });

  it("never passes on the helper's own voice", async () => {
    ai.change.mockResolvedValue(accepted({ summary: 'I made the Moon King throw fireballs.', next: ['Let me add lava', 'Add falling rocks'] }));
    await startChange(getState().session.world!, 'make the moon king throw fireballs');
    const step = getState().session.world!.steps.at(-1)!;
    expect(step.text).not.toMatch(/\bI\b/);
    expect(getState().ai.landed?.text).toBe('Done! Your world changed.');
    const last = getState().ai.lastOutcome;
    expect(last?.kind === 'accepted' && last.next).toEqual(['Add falling rocks']);
  });

  it('See what changed asks Footsteps for its step, and the toast goes', async () => {
    ai.change.mockResolvedValue(accepted());
    await startChange(getState().session.world!, 'make the moon king throw fireballs');
    const stepId = getState().ai.landed?.stepId;
    const seen = vi.fn();
    const off = onSeeChange(seen);
    seeWish();
    off();
    expect(seen).toHaveBeenCalledWith(world.id, stepId);
    expect(getState().ai.landed).toBeNull();
  });

  it('Undo goes back to the step before it, as a new footstep', async () => {
    ai.change.mockResolvedValue(accepted());
    await startChange(getState().session.world!, 'make the moon king throw fireballs');
    expect(getState().session.world!.code[0].source).toContain('fireballs');
    await undoWish();
    const now = getState().session.world!;
    expect(now.code[0].source).not.toContain('fireballs');
    expect(now.steps.at(-1)?.kind).toBe('goback');
    expect(now.steps.map((s) => s.kind)).toEqual(['start', 'ask', 'goback']);
    expect(getState().ai.landed).toBeNull();
    expect(getState().app.announce.polite).toBe('Undone. Your world is back to how it was.');
  });

  it('closes its toast when Footsteps shows the change', async () => {
    ai.change.mockResolvedValue(accepted());
    await startChange(getState().session.world!, 'make the moon king throw fireballs');
    dismissChangeToast();
    expect(getState().ai.landed).toBeNull();
  });

  it("that didn't work says so plainly, and leaves no toast", async () => {
    ai.change.mockResolvedValue({ kind: 'failed', reason: 'transport', message: "That wish didn't work this time. Your world is just like before.", details: [] });
    await startChange(getState().session.world!, 'make the moon king throw fireballs');
    expect(getState().ai.landed).toBeNull();
    expect(getState().app.announce.polite).toBe("That wish didn't work this time. Your world is just like before.");
    expect(getState().session.world!.code[0].source).toBe(SAMPLE_CODE);
  });
});
