/** Lantern Maze (Maze): collect lanterns in a hedge maze at night; lanterns scare the ghosts. */
import type { StarterMeta } from '../types';
import ghosts from './ghosts.js?raw';
import game from './game.js?raw';

export const lanternMaze: StarterMeta = {
  id: 'lantern-maze',
  ns: 'lanternMaze',
  heroKey: 'hero',
  yourTurn: 'boo',
  spare: ['pal'],
  tags: ['maze', 'ghost', 'dungeon', 'sneak', 'collect', 'find', 'escape', 'hide', 'dark', 'keys'],
  cast: [
    { key: 'hero', name: 'Biscuit', kind: 'character', rig: 'quadruped', role: 'hero', facing: 'right', state: 'drawn', script: 'biscuit' },
    { key: 'boo', name: 'Boo', kind: 'character', rig: 'blob', role: 'enemy', facing: 'viewer', state: 'yourTurn' },
    { key: 'lantern', name: 'Lantern', kind: 'item', rig: 'none', role: 'item', facing: 'viewer', state: 'drawn', script: 'lantern' },
    { key: 'key', name: 'Key', kind: 'item', rig: 'none', role: 'item', facing: 'viewer', state: 'drawn', script: 'key' },
    { key: 'wall', name: 'Hedge', kind: 'terrain', rig: 'none', role: 'terrain', facing: 'viewer', state: 'drawn', script: 'hedge' },
    { key: 'pal', name: 'Pal', kind: 'character', rig: 'biped', role: 'npc', facing: 'right', state: 'spare' },
  ],
  files: [
    { path: 'ghosts.js', source: ghosts },
    { path: 'game.js', source: game },
  ],
  scripts: {
    hero: () => import('./art/hero.art').then((m) => m.default),
    lantern: () => import('./art/lantern.art').then((m) => m.default),
    key: () => import('./art/key.art').then((m) => m.default),
    wall: () => import('./art/wall.art').then((m) => m.default),
  },
};
