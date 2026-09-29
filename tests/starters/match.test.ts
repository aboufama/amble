/** The ladder's local idea match (§5.9, §9): tag words pick the closest starter; ties go to Moon King. */
import { describe, expect, it } from 'vitest';
import { matchIdea, tagScore, wordsOf } from '../../src/starters/match';

describe('matchIdea', () => {
  it.each([
    ['a boss fight against a giant dragon', 'moon-king'],
    ['shoot aliens on the moon', 'moon-king'],
    ['a robot army attacks', 'moon-king'],
    ['an endless runner in the sky', 'sky-run'],
    ['race fast and dash past everything', 'sky-run'],
    ['stack blocks into a tower and smash it', 'wobble-tower'],
    ['things explode and topple over with physics', 'wobble-tower'],
    ['escape a dark maze full of ghosts', 'lantern-maze'],
    ['sneak around and collect all the keys', 'lantern-maze'],
    ['climb away from the rising lava', 'clanks-climb'],
    ['reach the rocket at the top', 'clanks-climb'],
    ['a robot who climbs', 'clanks-climb'],
  ])('"%s" is %s', (idea, id) => {
    expect(matchIdea(idea)).toBe(id);
  });

  it('gives Moon King when nothing matches, and when Moon King ties', () => {
    expect(matchIdea('')).toBe('moon-king');
    expect(matchIdea('a quiet afternoon painting flowers')).toBe('moon-king');
    // "monster" (Moon King) and "maze" (Lantern Maze): one each.
    expect(matchIdea('a monster in a maze')).toBe('moon-king');
  });

  it('counts plurals and -ing forms, and phrases as a whole', () => {
    expect(wordsOf('Ghosts stacking towers')).toEqual(expect.arrayContaining(['ghost', 'stack', 'tower']));
    expect(tagScore('I want to jump over spikes', ['jump over'])).toBe(1);
    expect(tagScore('jump and then go over', ['jump over'])).toBe(0);
    expect(tagScore('KEYS keys Keys', ['keys'])).toBe(1);
  });
});
