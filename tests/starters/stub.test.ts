/** M8's starting point (FOUNDATION-STUB test; M8 replaces it): the stub catalog and its fixture game. */
import { describe, expect, it } from 'vitest';
import { kitManifest, sourceFilesOf, validateGame } from '../../src/cores/ai';
import { isWorld } from '../../src/model/guards';
import { createStarterStub } from '../../src/starters/api';

describe('starters (stub)', () => {
  const catalog = createStarterStub();

  it('lists the five starters in Trail order, with real words', () => {
    const list = catalog.list();
    expect(list.map((s) => s.id)).toEqual(['moon-king', 'sky-run', 'wobble-tower', 'lantern-maze', 'clanks-climb']);
    for (const s of list) {
      expect(s.title).not.toMatch(/^starters\./);
      expect(s.genre).not.toMatch(/^starters\./);
      expect(s.blurb).not.toMatch(/^starters\./);
      expect(s.teaches).not.toMatch(/^starters\./);
    }
    expect(catalog.info('parade').hidden).toBe(true);
  });

  it('opens a valid new world whose game validates', async () => {
    const { world } = await catalog.open('moon-king', { withArt: false, hero: 'a_hero000001' });
    expect(isWorld(world)).toBe(true);
    expect(world.cast.hero.art).toBe('a_hero000001');
    expect(world.steps).toHaveLength(1);
    expect(world.head).toBe(world.steps[0].id);
    const result = validateGame(sourceFilesOf(world.code), { manifest: kitManifest(), fix: false });
    expect(result.errors).toEqual([]);
    expect(result.art.declared.length).toBeGreaterThanOrEqual(8);
  });

  it('matches ideas by tags', () => {
    expect(catalog.matchIdea('a giant dragon boss')).toBe('moon-king');
    expect(catalog.matchIdea('escape a dark maze full of ghosts')).toBe('lantern-maze');
    expect(catalog.matchIdea('something else entirely')).toBe('moon-king');
  });
});
