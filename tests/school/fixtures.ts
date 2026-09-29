/**
 * A world on the fixture boss game (keys hero, boss, minion; dials jump, orbSpeed, bossHealth) with two
 * work sessions of Footsteps, and a tiny PNG for thumbnails.
 */
import type { AuthorRun, World } from '../../src/model/types';
import { FIXTURE_GAME } from '../../src/starters/fixtureGame';
import { sampleArt, sampleAssignment, sampleWorld } from '../foundation/samples';

export const T0 = Date.UTC(2026, 8, 14, 13, 0);
const MIN = 60_000;
const DAY = 24 * 60 * MIN;

export function fixtureWorld(over: Partial<World> = {}): World {
  const lines = FIXTURE_GAME.split('\n').length;
  return sampleWorld({
    id: 'w_fixture001',
    title: 'Moon King',
    code: [{ path: 'game.js', source: FIXTURE_GAME, authors: [['starter', lines] as AuthorRun], locked: [] }],
    cast: {
      hero: { key: 'hero', art: 'a_hero000001', madeBy: 'student', extra: null, laterUntil: 0 },
      boss: { key: 'boss', art: null, madeBy: null, extra: null, laterUntil: 0 },
      minion: { key: 'minion', art: 'a_minion0001', madeBy: 'example', extra: null, laterUntil: 0 },
    },
    sounds: {},
    steps: [
      { id: 's_start00001', at: T0, by: 'student', kind: 'start', text: 'You started Moon King.' },
      { id: 's_ask0000001', at: T0 + 10 * MIN, by: 'ai', kind: 'ask', text: 'The boss moves faster.', request: 'make the boss faster' },
      { id: 's_code000001', at: T0 + 20 * MIN, by: 'student', kind: 'code', text: 'You changed the code.' },
      { id: 's_fix0000001', at: T0 + DAY, by: 'ai', kind: 'fix', text: 'Amble fixed a problem.' },
      { id: 's_code000002', at: T0 + DAY + 5 * MIN, by: 'student', kind: 'code', text: 'You changed the code.' },
      { id: 's_ask0000002', at: T0 + DAY + 15 * MIN, by: 'ai', kind: 'ask', text: 'A second phase.', request: 'add a second phase' },
    ],
    head: 's_ask0000002',
    assignment: sampleAssignment({
      require: ['hero', 'boss'],
      goals: [
        { id: 'g_hero', label: 'Hero drawn by the student', kind: 'auto', check: { type: 'drawn', key: 'hero' } },
        { id: 'g_attacks', label: 'Boss has 2+ attacks', kind: 'auto', check: { type: 'boss-attacks', min: 2 } },
        { id: 'g_runs', label: 'Runs without errors', kind: 'auto', check: { type: 'runs-clean' } },
        { id: 'g_twist', label: 'A creative twist', kind: 'teacher' },
      ],
    }),
    credits: { madeBy: 'J.R.' },
    ...over,
  });
}

/** The drawings the fixture world's cast points at: the hero by the student, the minion from the example set. */
export const FIXTURE_ART = [sampleArt({ id: 'a_hero000001', name: 'Pip', madeBy: 'student', mode: 'bones' }), sampleArt({ id: 'a_minion0001', name: 'Grumble', role: 'enemy', madeBy: 'example' })];

const PNG_1x1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

export function png(): Blob {
  return new Blob([Uint8Array.from(atob(PNG_1x1), (c) => c.charCodeAt(0))], { type: 'image/png' });
}
