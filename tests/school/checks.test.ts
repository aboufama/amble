/**
 * Assignment checks with evidence (§2.13, §2.14) on the fixture boss game: what Amble finds in the code
 * (attacks inside the boss's brain, dials read, win and lose including the kit's own ending), who drew what,
 * the robot run, and the words students and teachers see.
 */
import { describe, expect, it } from 'vitest';
import type { ArtId, CodeFile, Goal } from '../../src/model/types';
import { castFromCode } from '../../src/school/assignment';
import { goalsFor, runChecks, studentEvidence, studentLabel, teacherEvidence, toCheckResults, type ArtFacts, type RobotRun } from '../../src/school/checks';
import { codeFacts } from '../../src/school/codeFacts';
import { t } from '../../src/i18n';
import { FIXTURE_ART, fixtureWorld } from './fixtures';

const file = (source: string, path = 'game.js'): CodeFile => ({ path, source, authors: [['student', source.split('\n').length]], locked: [] });

function check(goals: Goal[], robot: RobotRun = { errors: 0, seconds: 6 }, world = fixtureWorld()) {
  const cast = castFromCode(world.code);
  const art = new Map<ArtId, ArtFacts>(FIXTURE_ART.map((a) => [a.id, { madeBy: a.madeBy, onBones: a.mode === 'bones' }]));
  return runChecks(goals, { world, cast, art: (id) => art.get(id) ?? null, facts: codeFacts(world.code), robot });
}

const auto = (id: string, check: Extract<Goal, { kind: 'auto' }>['check']): Goal => ({ id, label: id, kind: 'auto', check });

describe('what Amble reads in the code', () => {
  it('finds the boss’s attacks, brain states, dials, and a win and a lose', () => {
    const facts = codeFacts(fixtureWorld().code);
    expect(facts.attacks).toEqual(['pattern.laser', 'pattern.ring', 'pattern.spiral', 'pattern.spread']);
    expect(facts.brainStates).toBe(5);
    expect(facts.dials).toEqual(['jump', 'orbSpeed', 'bossHealth']);
    expect(facts.dialsRead).toEqual(['bossHealth', 'jump', 'orbSpeed']);
    expect(facts.win).toBe(true);
    // No lose() call: the kit ends the game when the hero dies.
    expect(facts.lose).toBe(true);
    expect(facts.unreadable).toEqual([]);
  });

  it('counts only attacks inside a brain when there is one', () => {
    const src = `class Game extends Amble.Scene {
      create() {
        this.pattern.spread(this, 0, {});
        this.brain(this.boss, { a: { enter: (b) => this.pattern.ring(b, {}) }, b: { enter: (b) => this.shoot(b, { key: 'orb' }) } });
      }
    }`;
    expect(codeFacts([file(src)]).attacks).toEqual(['pattern.ring', 'shoot:orb']);
  });

  it('sees the kit’s endings: a boss that dies wins, a hero that dies loses', () => {
    const neither = codeFacts([file('class Game extends Amble.Scene { create() { this.spawn(1, 2, "rock"); } }')]);
    expect([neither.win, neither.lose]).toEqual([false, false]);
    const boss = codeFacts([file('class Game extends Amble.Scene { create() { this.spawnEnemy(1, 2, "blob", { boss: true }); } }')]);
    expect(boss.win).toBe(true);
    const explicit = codeFacts([file('class Game extends Amble.Scene { update() { if (this.timeUp) this.lose("Too slow"); } }')]);
    expect(explicit.lose).toBe(true);
  });

  it('skips a file that doesn’t parse and still reads the rest', () => {
    const facts = codeFacts([...fixtureWorld().code, file('const a = ;', 'oops.js')]);
    expect(facts.unreadable).toEqual(['oops.js']);
    expect(facts.attacks.length).toBe(4);
  });
});

describe('goals and evidence', () => {
  it('adds the drawings an assignment requires as goals', () => {
    const world = fixtureWorld();
    const goals = goalsFor(world, castFromCode(world.code));
    expect(goals.map((g) => g.id)).toEqual(['g_hero', 'g_attacks', 'g_runs', 'g_twist', 'require-boss']);
    expect(goals.at(-1)).toMatchObject({ label: 'Moon King', check: { type: 'drawn', key: 'boss' } });
  });

  it('checks a world without an assignment for a drawn hero and a clean run', () => {
    const world = fixtureWorld({ assignment: null });
    expect(goalsFor(world, castFromCode(world.code)).map((g) => g.id)).toEqual(['default-hero', 'default-runs']);
  });

  it('passes and fails with what Amble found', () => {
    const [hero, boss, minion, attacks, dials, winLose, captions, runs, twist] = check([
      auto('hero', { type: 'drawn', key: 'hero' }),
      auto('boss', { type: 'drawn', key: 'boss' }),
      auto('minion', { type: 'drawn', key: 'minion' }),
      auto('attacks', { type: 'boss-attacks', min: 2 }),
      auto('dials', { type: 'uses-dials', min: 1 }),
      auto('winlose', { type: 'has-win-and-lose' }),
      auto('captions', { type: 'captions' }),
      auto('runs', { type: 'runs-clean' }),
      { id: 'twist', label: 'A creative twist', kind: 'teacher' },
    ]);
    expect(hero).toMatchObject({ pass: true, evidence: { kind: 'drawn', onBones: true }, fix: null });
    expect(boss).toMatchObject({ pass: false, evidence: { kind: 'justBones', role: 'boss' }, fix: { kind: 'draw', key: 'boss' } });
    expect(minion).toMatchObject({ pass: false, evidence: { kind: 'notTheirs', name: 'Grumble' } });
    expect(attacks).toMatchObject({ pass: true, evidence: { kind: 'found', what: 'attacks', n: 4, min: 2 } });
    expect(dials).toMatchObject({ pass: true, evidence: { kind: 'found', what: 'dials', n: 3 } });
    expect(winLose.pass).toBe(true);
    expect(captions).toMatchObject({ pass: true, evidence: { kind: 'captions', total: 0, missing: 0 } });
    expect(runs).toMatchObject({ pass: true, evidence: { kind: 'clean', seconds: 6 } });
    expect(twist).toMatchObject({ pass: null, evidence: { kind: 'teacher' } });

    expect(studentEvidence(attacks.evidence)).toBe('Amble found 4 in your code');
    expect(teacherEvidence(attacks.evidence)).toBe('4 found in code');
    expect(studentEvidence(boss.evidence)).toBe(t('school.evBossBones'));
    expect(teacherEvidence(runs.evidence)).toBe(t('school.staff_evTestPlay', { n: 6 }));
  });

  it('says how many more attacks are needed', () => {
    const [few] = check([auto('attacks', { type: 'boss-attacks', min: 6 })]);
    expect(few.pass).toBe(false);
    expect(studentEvidence(few.evidence)).toBe('Amble found 4 in your code. Add 2 more.');
  });

  it('reports the robot run: untested, one problem, several', () => {
    const goal = [auto('runs', { type: 'runs-clean' })];
    expect(check(goal, null)[0]).toMatchObject({ pass: false, evidence: { kind: 'untested' }, fix: { kind: 'retest' } });
    expect(studentEvidence(check(goal, { errors: 1, seconds: 6 })[0].evidence)).toBe('Amble found 1 problem when it tested your world.');
    expect(studentEvidence(check(goal, { errors: 3, seconds: 6 })[0].evidence)).toBe('Amble found 3 problems when it tested your world.');
  });

  it('counts captions on the student’s own sounds', () => {
    const world = fixtureWorld({
      sounds: {
        roar: { name: 'roar', source: { kind: 'preset', preset: 'roar', variation: 1 }, effects: [], caption: '[boss roars]', madeBy: 'student' },
        zap: { name: 'zap', source: { kind: 'preset', preset: 'zap', variation: 1 }, effects: [], caption: ' ', madeBy: 'student' },
      },
    });
    const [captions] = check([auto('captions', { type: 'captions' })], null, world);
    expect(captions).toMatchObject({ pass: false, evidence: { kind: 'captions', total: 2, missing: 1 } });
    expect(studentEvidence(captions.evidence)).toBe('1 still needs a caption');
  });

  it('speaks to the student about their hero and boss', () => {
    const cast = castFromCode(fixtureWorld().code);
    expect(studentLabel(auto('h', { type: 'drawn', key: 'hero' }), cast)).toBe(t('school.goalHeroDrawn'));
    expect(studentLabel(auto('b', { type: 'drawn', key: 'boss' }), cast)).toBe(t('school.goalBossDrawn'));
    expect(studentLabel(auto('m', { type: 'drawn', key: 'minion' }), cast)).toBe('Grumble is drawn');
    expect(studentLabel(auto('d', { type: 'min-drawings', n: 1 }), cast)).toBe('You made a drawing');
  });

  it('gives SchoolApi.check its results: teacher goals never count as passed by Amble', () => {
    const results = toCheckResults(check([auto('hero', { type: 'drawn', key: 'hero' }), { id: 'twist', label: 'A twist', kind: 'teacher' }]));
    expect(results).toEqual([
      { goal: 'hero', pass: true, evidence: t('school.evDrawnBones') },
      { goal: 'twist', pass: false, evidence: t('school.evTeacher') },
    ]);
  });
});
