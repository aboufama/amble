/**
 * M1's starting point (FOUNDATION-STUB test; M1 replaces it): the screen chunks export the components
 * App.tsx loads by name, and Home's data (the library) loads from the store.
 */
import { afterEach, describe, expect, it } from 'vitest';
import * as first from '../../src/screens/first';
import * as newworld from '../../src/screens/newworld';
import * as trail from '../../src/screens/trail';
import { refreshLibrary } from '../../src/state/library';
import { getState, resetState } from '../../src/state/store';
import { MemoryStore } from '../../src/store/memory';
import { sampleArt, sampleWorld } from '../foundation/samples';

describe('home (stub)', () => {
  afterEach(() => resetState());

  it('exports the screens App.tsx loads by name', () => {
    expect(typeof trail.Home).toBe('function');
    expect(typeof trail.Trail).toBe('function');
    expect(typeof first.FirstPage).toBe('function');
    expect(typeof newworld.NewWorldSheet).toBe('function');
    expect(typeof newworld.PlanCard).toBe('function');
    expect(typeof newworld.OpenStarter).toBe('function');
  });

  it('loads worlds and shelf characters for the Trail', async () => {
    const store = new MemoryStore();
    await store.commit({ worlds: [sampleWorld()], art: [sampleArt()] });
    await refreshLibrary(store);
    const lib = getState().library;
    expect(lib.loaded).toBe(true);
    expect(lib.worlds.map((w) => w.id)).toEqual([sampleWorld().id]);
    expect(lib.characters.map((c) => c.id)).toEqual(['a_hero000001']);
  });
});
