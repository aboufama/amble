/**
 * Parade (hidden): every drawn cast member walks a lit path under a lantern, one after another, with its
 * name. Old-Amble imports and characters without a world of their own land here. Its keys are fixed:
 * `hero`, then `pal1` to `pal7` (PARADE_KEYS).
 */
import type { StarterMeta } from '../types';
import game from './game.js?raw';

export const PARADE_KEYS = ['hero', 'pal1', 'pal2', 'pal3', 'pal4', 'pal5', 'pal6', 'pal7'] as const;

export const parade: StarterMeta = {
  id: 'parade',
  ns: 'parade',
  heroKey: 'hero',
  yourTurn: null,
  spare: [],
  tags: [],
  cast: PARADE_KEYS.map((key, i) => ({
    key,
    name: i === 0 ? 'Star of the parade' : `Walker ${i}`,
    kind: 'character' as const,
    rig: 'biped' as const,
    role: i === 0 ? ('hero' as const) : ('npc' as const),
    facing: 'right' as const,
    // The walkers are declared `spare` in static art (never asked for), and walk only once drawn.
    state: 'bones' as const,
  })),
  files: [{ path: 'game.js', source: game }],
  scripts: {},
};
