/**
 * The Trail's data (§2.4): what Home shows first, the order of the trail, Lost and found expiry,
 * "Edited 2 days ago", resting characters, the pending assignment and the trail's geometry.
 */
import { describe, expect, it } from 'vitest';
import {
  DAY_MS,
  daysLeft,
  editedText,
  expiredWorlds,
  groundTop,
  homeChoice,
  isExpired,
  latestCharacter,
  legHeight,
  LOST_DAYS,
  lostWorlds,
  pathTop,
  pendingAssignment,
  placeStops,
  restingCharacters,
  signStops,
  signTop,
  smoothPath,
  sortWorlds,
  trailStops,
  trailWorlds,
  FRAME_H,
} from '../../src/home/trailData';
import type { ArtRecordLite, StarterInfo, WorldMeta } from '../../src/model/types';
import { sampleAssignment } from '../foundation/samples';

const NOW = new Date(2026, 8, 29, 15, 0, 0).getTime();

function meta(id: string, over: Partial<WorldMeta> = {}): WorldMeta {
  return {
    id,
    title: id,
    createdAt: NOW - 10 * DAY_MS,
    updatedAt: NOW - DAY_MS,
    openedAt: NOW - DAY_MS,
    snapshot: null,
    hero: null,
    walkers: [],
    drawn: 1,
    needed: 3,
    bytes: 1000,
    origin: 'starter',
    assignment: null,
    handedIn: null,
    putAwayAt: null,
    ...over,
  };
}

function starter(id: StarterInfo['id']): StarterInfo {
  return { id, title: id, genre: 'Genre', blurb: '', teaches: '', sign: '', heroKey: 'hero', yourTurn: null, spare: [], tags: [], hidden: id === 'parade' };
}

function char(id: string, updatedAt: number): ArtRecordLite {
  return { id, name: id, kind: 'character', rig: 'blob', shelf: true, updatedAt, sticker: null };
}

const STARTERS = (['moon-king', 'sky-run', 'wobble-tower', 'lantern-maze', 'clanks-climb', 'parade'] as const).map(starter);

describe('home: First page or Trail', () => {
  it('waits for the library', () => {
    expect(homeChoice({ loaded: false, worlds: [], characters: [] }, {})).toBe('loading');
  });

  it('shows the First page on a first launch only', () => {
    expect(homeChoice({ loaded: true, worlds: [], characters: [] }, {})).toBe('first');
    expect(homeChoice({ loaded: true, worlds: [meta('w_a')], characters: [] }, {})).toBe('trail');
    expect(homeChoice({ loaded: true, worlds: [], characters: [char('a_1', NOW)] }, {})).toBe('trail');
    expect(homeChoice({ loaded: true, worlds: [], characters: [] }, { firstPage: NOW })).toBe('trail');
  });

  it('treats a trail of put-away worlds as empty', () => {
    expect(homeChoice({ loaded: true, worlds: [meta('w_a', { putAwayAt: NOW })], characters: [] }, {})).toBe('first');
  });
});

describe('trail ordering', () => {
  const worlds = [meta('w_old', { openedAt: NOW - 5 * DAY_MS }), meta('w_new', { openedAt: NOW - 1000 }), meta('w_gone', { putAwayAt: NOW - DAY_MS }), meta('w_mid', { openedAt: NOW - 2 * DAY_MS })];

  it('puts the most recently opened world first and leaves put-away worlds off', () => {
    expect(trailWorlds(worlds).map((w) => w.id)).toEqual(['w_new', 'w_mid', 'w_old']);
  });

  it("shows the student's worlds, then the Starter worlds signpost, then the starters", () => {
    const stops = trailStops({ worlds, starters: STARTERS, hasCharacters: false, resting: [] });
    expect(stops.map((s) => s.kind)).toEqual(['world', 'world', 'lamp', 'world', 'signpost', 'starter', 'starter', 'starter', 'starter', 'starter']);
    expect(signStops(stops).map((s) => s.id)).toEqual(['w_new', 'w_mid', 'w_old', 'moon-king', 'sky-run', 'wobble-tower', 'lantern-maze', 'clanks-climb']);
  });

  it('with no worlds and no characters: two starters, the lamppost, then the rest (the mockup)', () => {
    const stops = trailStops({ worlds: [], starters: STARTERS, hasCharacters: false, resting: [] });
    expect(stops.map((s) => s.id)).toEqual(['moon-king', 'sky-run', 'lamp', 'wobble-tower', 'lantern-maze', 'clanks-climb']);
  });

  it('returning students start at + New world and the lamppost', () => {
    const stops = trailStops({ worlds: worlds.slice(0, 1), starters: STARTERS, hasCharacters: true, resting: ['a_1'] });
    expect(stops.slice(0, 4).map((s) => s.kind)).toEqual(['newWorld', 'lamp', 'world', 'signpost']);
    expect(stops[0]).toMatchObject({ kind: 'newWorld', resting: ['a_1'] });
  });

  it('never shows the hidden Parade seed', () => {
    const stops = trailStops({ worlds: [], starters: STARTERS, hasCharacters: false, resting: [] });
    expect(stops.some((s) => s.id === 'parade')).toBe(false);
  });

  it('sorts the List view by name', () => {
    const named = [meta('w_1', { title: 'zebra' }), meta('w_2', { title: 'Apple' }), meta('w_3', { title: 'mango 10' }), meta('w_4', { title: 'mango 9' })];
    expect(sortWorlds(named, 'name').map((w) => w.title)).toEqual(['Apple', 'mango 9', 'mango 10', 'zebra']);
    expect(sortWorlds(named, 'recent')).toHaveLength(4);
  });
});

describe('Lost and found', () => {
  it('keeps a world 30 days', () => {
    expect(LOST_DAYS).toBe(30);
    expect(daysLeft(NOW, NOW)).toBe(30);
    expect(daysLeft(NOW - 29.5 * DAY_MS, NOW)).toBe(1);
    expect(daysLeft(NOW - 30 * DAY_MS, NOW)).toBe(0);
    expect(isExpired(NOW - 30 * DAY_MS - 1, NOW)).toBe(true);
    expect(isExpired(NOW - 29 * DAY_MS, NOW)).toBe(false);
  });

  it('lists put-away worlds newest first, with days left, and names the expired ones', () => {
    const metas = [
      meta('w_live'),
      meta('w_a', { putAwayAt: NOW - 3 * DAY_MS }),
      meta('w_b', { putAwayAt: NOW - DAY_MS }),
      meta('w_old', { putAwayAt: NOW - 31 * DAY_MS }),
    ];
    expect(lostWorlds(metas, NOW).map((l) => [l.meta.id, l.daysLeft])).toEqual([
      ['w_b', 29],
      ['w_a', 27],
    ]);
    expect(expiredWorlds(metas, NOW)).toEqual(['w_old']);
  });
});

describe('"Edited 2 days ago"', () => {
  it('reads like a person would say it', () => {
    expect(editedText(NOW - 20_000, NOW)).toEqual({ key: 'editedNow' });
    expect(editedText(NOW - 60_000, NOW)).toEqual({ key: 'editedOneMinute' });
    expect(editedText(NOW - 5 * 60_000, NOW)).toEqual({ key: 'editedMinutes', n: 5 });
    expect(editedText(NOW - 3 * 3_600_000, NOW)).toEqual({ key: 'editedHours', n: 3 });
    expect(editedText(NOW - DAY_MS, NOW)).toEqual({ key: 'editedYesterday' });
    expect(editedText(NOW - 2 * DAY_MS, NOW)).toEqual({ key: 'editedDays', n: 2 });
    expect(editedText(NOW - 40 * DAY_MS, NOW).key).toBe('editedDate');
  });
});

describe('characters on the trail', () => {
  it('stands the newest drawing under the lamppost', () => {
    expect(latestCharacter([char('a_1', 1), char('a_2', 3), char('a_3', 2)])?.id).toBe('a_2');
    expect(latestCharacter([])).toBeNull();
  });

  it('walks drawings no world uses near + New world', () => {
    const chars = [char('a_1', 1), char('a_2', 3), char('a_3', 2)];
    const metas = [meta('w_1', { hero: 'a_1' }), meta('w_2', { walkers: ['a_3'], putAwayAt: NOW })];
    expect(restingCharacters(chars, metas).map((c) => c.id)).toEqual(['a_2', 'a_3']);
  });

  it("hangs the teacher's note until the assignment has a world", () => {
    const asg = sampleAssignment();
    expect(pendingAssignment(asg, [])).toBe(asg);
    expect(pendingAssignment(asg, [meta('w_1', { origin: 'assignment', assignment: { title: asg.title, due: 'Friday' } })])).toBeNull();
    expect(pendingAssignment(null, [])).toBeNull();
  });
});

describe('trail geometry', () => {
  it('traces the mockup path and keeps rolling without jumps', () => {
    expect(pathTop(-30)).toBe(752);
    expect(pathTop(1400)).toBe(634);
    for (let x = -30; x < 4000; x += 7) expect(Math.abs(pathTop(x + 7) - pathTop(x))).toBeLessThan(4);
  });

  it('lays stops out left to right, with room for the teacher note before the lamppost', () => {
    const stops = trailStops({ worlds: [], starters: STARTERS, hasCharacters: false, resting: [] });
    const { placed, width } = placeStops(stops);
    for (let i = 1; i < placed.length; i++) expect(placed[i].x).toBeGreaterThan(placed[i - 1].x);
    expect(width).toBeGreaterThan(placed[placed.length - 1].x);
    const withNote = placeStops(stops, { noteRoom: 190 });
    const lamp = (p: typeof placed) => p.find((s) => s.stop.kind === 'lamp')!.x;
    expect(lamp(withNote.placed) - lamp(placed)).toBe(190);
  });

  it('stands signs on the ground, never above the hero copy', () => {
    const top = signTop(700, 0, 0);
    expect(top + FRAME_H + legHeight(700, top)).toBeCloseTo(groundTop(700) + 3, 0);
    expect(signTop(1400, 0, 560)).toBe(560);
    expect(legHeight(1400, 700)).toBe(10);
  });

  it('draws smooth SVG paths', () => {
    expect(smoothPath([[0, 0]])).toBe('');
    expect(smoothPath([[0, 0], [10, 5], [20, 0]])).toMatch(/^M0 0C.+C.+ 20 0$/);
  });
});
