/** Sky Run (Runner): an endless run over the clouds at dusk. */
import type { StarterMeta } from '../types';

export const skyRun: StarterMeta = {
  id: 'sky-run',
  ns: 'skyRun',
  heroKey: 'hero',
  yourTurn: 'bloop',
  spare: ['kite'],
  tags: ['run', 'runner', 'race', 'fast', 'endless', 'dash', 'sky', 'fly', 'jump over', 'chase'],
  cast: [
    { key: 'hero', name: 'Dash', kind: 'character', rig: 'biped', role: 'hero', facing: 'right', state: 'drawn', script: 'dash' },
    { key: 'bloop', name: 'Bloop', kind: 'character', rig: 'blob', role: 'enemy', facing: 'viewer', state: 'yourTurn' },
    { key: 'glim', name: 'Glim', kind: 'item', rig: 'none', role: 'item', facing: 'viewer', state: 'drawn', script: 'glim' },
    { key: 'portal', name: 'Flip portal', kind: 'prop', rig: 'none', role: 'prop', facing: 'viewer', state: 'drawn', script: 'flip-portal' },
    { key: 'sky', name: 'Dusk sky', kind: 'background', rig: 'none', role: 'background', facing: 'viewer', state: 'drawn', script: 'dusk-sky' },
    { key: 'kite', name: 'Kite', kind: 'character', rig: 'flyer', role: 'npc', facing: 'right', state: 'spare' },
    { key: 'cloud', name: 'Cloud', kind: 'terrain', rig: 'none', role: 'terrain', facing: 'viewer', state: 'bones' },
  ],
  // The game's files load with a world, never with the app's first page.
  files: async () => {
    const [chunks, game] = await Promise.all([import('./chunks.js?raw'), import('./game.js?raw')]);
    return [
      { path: 'chunks.js', source: chunks.default },
      { path: 'game.js', source: game.default },
    ];
  },
  scripts: {
    hero: () => import('./art/hero.art').then((m) => m.default),
    glim: () => import('./art/glim.art').then((m) => m.default),
    portal: () => import('./art/portal.art').then((m) => m.default),
    sky: () => import('./art/sky.art').then((m) => m.default),
  },
};
