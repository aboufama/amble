/** Wobble Tower (Physics toy): build the tallest tower before the wobble wind knocks it down. */
import type { StarterMeta } from '../types';

export const wobbleTower: StarterMeta = {
  id: 'wobble-tower',
  ns: 'wobbleTower',
  heroKey: 'wobbles',
  yourTurn: 'crate',
  spare: ['boulder'],
  tags: ['tower', 'stack', 'blocks', 'crash', 'smash', 'physics', 'topple', 'build', 'explode', 'wobble'],
  cast: [
    { key: 'wobbles', name: 'Wobbles', kind: 'character', rig: 'blob', role: 'hero', facing: 'viewer', state: 'drawn', script: 'wobbles' },
    { key: 'dummy', name: 'Stickman', kind: 'character', rig: 'biped', role: 'npc', facing: 'viewer', state: 'drawn', script: 'stickman' },
    { key: 'crate', name: 'Crate', kind: 'prop', rig: 'object', role: 'prop', facing: 'viewer', state: 'yourTurn' },
    { key: 'ball', name: 'Ball', kind: 'prop', rig: 'none', role: 'prop', facing: 'viewer', state: 'drawn', script: 'ball' },
    { key: 'city', name: 'City at night', kind: 'background', rig: 'none', role: 'background', facing: 'viewer', state: 'drawn', script: 'city-night' },
    { key: 'boulder', name: 'Boulder', kind: 'prop', rig: 'none', role: 'prop', facing: 'viewer', state: 'spare' },
  ],
  // The game's files load with a world, never with the app's first page.
  files: async () => {
    const [builders, game] = await Promise.all([import('./builders.js?raw'), import('./game.js?raw')]);
    return [
      { path: 'builders.js', source: builders.default },
      { path: 'game.js', source: game.default },
    ];
  },
  scripts: {
    wobbles: () => import('./art/wobbles.art').then((m) => m.default),
    dummy: () => import('./art/dummy.art').then((m) => m.default),
    ball: () => import('./art/ball.art').then((m) => m.default),
    city: () => import('./art/city.art').then((m) => m.default),
  },
};
