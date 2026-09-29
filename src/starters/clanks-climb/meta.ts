/** Clank's Climb (Platformer): climb a tower while the goo rises, and reach the rocket. */
import type { StarterMeta } from '../types';
import game from './game.js?raw';
import tower from './tower.js?raw';

export const clanksClimb: StarterMeta = {
  id: 'clanks-climb',
  ns: 'clanksClimb',
  heroKey: 'hero',
  yourTurn: 'spiky',
  spare: ['buddy'],
  tags: ['climb', 'jump', 'platform', 'lava', 'rise', 'goo', 'robot', 'reach', 'top', 'rocket'],
  cast: [
    { key: 'hero', name: 'Clank', kind: 'character', rig: 'biped', role: 'hero', facing: 'right', state: 'drawn', script: 'clank' },
    { key: 'spiky', name: 'Spiky', kind: 'character', rig: 'quadruped', role: 'enemy', facing: 'right', state: 'yourTurn' },
    { key: 'gear', name: 'Gear', kind: 'item', rig: 'none', role: 'item', facing: 'viewer', state: 'drawn', script: 'gear' },
    { key: 'rocket', name: 'Rocket', kind: 'prop', rig: 'none', role: 'prop', facing: 'viewer', state: 'drawn', script: 'rocket' },
    { key: 'goo', name: 'Goo', kind: 'terrain', rig: 'none', role: 'hazard', facing: 'viewer', state: 'drawn', script: 'goo' },
    { key: 'buddy', name: 'Buddy bot', kind: 'character', rig: 'biped', role: 'npc', facing: 'right', state: 'spare' },
    { key: 'girder', name: 'Girder', kind: 'terrain', rig: 'none', role: 'terrain', facing: 'viewer', state: 'bones' },
  ],
  files: [
    { path: 'tower.js', source: tower },
    { path: 'game.js', source: game },
  ],
  scripts: {
    hero: () => import('./art/hero.art').then((m) => m.default),
    gear: () => import('./art/gear.art').then((m) => m.default),
    rocket: () => import('./art/rocket.art').then((m) => m.default),
    goo: () => import('./art/goo.art').then((m) => m.default),
  },
};
