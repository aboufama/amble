/** Moon King (Boss fight): a boss fight on the moon in three phases. */
import type { StarterMeta } from '../types';
import game from './game.js?raw';
import moves from './moves.js?raw';

export const moonKing: StarterMeta = {
  id: 'moon-king',
  ns: 'moonKing',
  heroKey: 'hero',
  yourTurn: 'grumble',
  spare: ['bubbles'],
  tags: ['boss', 'fight', 'giant', 'king', 'queen', 'monster', 'dragon', 'shoot', 'space', 'moon', 'alien', 'robot army'],
  cast: [
    { key: 'hero', name: 'Pip', kind: 'character', rig: 'biped', role: 'hero', facing: 'right', state: 'drawn', script: 'pip' },
    { key: 'moonKing', name: 'The Moon King', kind: 'character', rig: 'blob', role: 'boss', facing: 'left', state: 'drawn', script: 'moon-king' },
    { key: 'grumble', name: 'Grumble', kind: 'character', rig: 'blob', role: 'enemy', facing: 'viewer', state: 'yourTurn' },
    { key: 'star', name: 'Star shard', kind: 'item', rig: 'none', role: 'item', facing: 'viewer', state: 'drawn', script: 'star-shard' },
    { key: 'sky', name: 'Moon sky', kind: 'background', rig: 'none', role: 'background', facing: 'viewer', state: 'drawn', script: 'moon-sky' },
    { key: 'bubbles', name: 'Bubbles', kind: 'character', rig: 'flyer', role: 'npc', facing: 'right', state: 'spare' },
    { key: 'ledge', name: 'Moon rock', kind: 'terrain', rig: 'none', role: 'terrain', facing: 'viewer', state: 'bones' },
    { key: 'shot', name: 'Star shot', kind: 'projectile', rig: 'none', role: 'projectile', facing: 'right', state: 'bones' },
    { key: 'orb', name: 'Moon orb', kind: 'projectile', rig: 'none', role: 'enemyShot', facing: 'viewer', state: 'bones' },
  ],
  files: [
    { path: 'moves.js', source: moves },
    { path: 'game.js', source: game },
  ],
  scripts: {
    hero: () => import('./art/hero.art').then((m) => m.default),
    moonKing: () => import('./art/moonKing.art').then((m) => m.default),
    star: () => import('./art/star.art').then((m) => m.default),
    sky: () => import('./art/sky.art').then((m) => m.default),
  },
};
