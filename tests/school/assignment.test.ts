/**
 * Assignments (§2.14, §4.2): the cast a starter offers (names and roles as the kit reads them), which
 * members a teacher can require, the goal menu, assignment files, and the Hand in file name.
 */
import { describe, expect, it } from 'vitest';
import { t } from '../../src/i18n';
import {
  AUTO_GOALS,
  assignmentFileName,
  assignmentWorld,
  autoGoalAvailable,
  castFromCode,
  drawableCast,
  fitsInLink,
  makeAutoGoal,
  makeTeacherGoal,
  menuIdOf,
  nameFromKey,
  newAssignment,
} from '../../src/school/assignment';
import { tn } from '../../src/school/count';
import { cleanInitials, suggestedFileName, withAmbleExtension } from '../../src/school/handin';
import { fixtureWorld } from './fixtures';

const cast = castFromCode(fixtureWorld().code);

describe('the cast', () => {
  it('reads names, roles and what the kit needs drawn', () => {
    expect(cast.map((c) => [c.key, c.name, c.role, c.required])).toEqual([
      ['hero', 'Pip', 'hero', true],
      ['boss', 'Moon King', 'boss', true],
      ['minion', 'Grumble', 'enemy', true],
      ['ground', 'Ground', 'terrain', false],
      ['ledge', 'Ledge', 'terrain', false],
      ['shot', 'Shot', 'projectile', false],
      ['orb', 'Orb', 'enemyShot', false],
      ['bomb', 'Bomb', 'enemyShot', false],
    ]);
  });

  it('offers the characters and things to draw, hero first, not tiles or shots', () => {
    expect(drawableCast(cast).map((c) => c.key)).toEqual(['hero', 'boss', 'minion']);
  });

  it('names a key when the game gives no name', () => {
    expect(nameFromKey('moonKing')).toBe('Moon King');
    expect(nameFromKey('ground')).toBe('Ground');
    expect(nameFromKey('big_rock')).toBe('Big Rock');
  });

  it('has nothing to offer for code it can’t read', () => {
    expect(castFromCode([{ path: 'game.js', source: 'class {', authors: [['student', 1]], locked: [] }])).toEqual([]);
  });
});

describe('the goal menu', () => {
  it('offers boss goals only when there is a boss', () => {
    expect(AUTO_GOALS.filter((id) => autoGoalAvailable(id, cast))).toEqual(AUTO_GOALS);
    const noBoss = cast.filter((c) => c.role !== 'boss');
    expect(AUTO_GOALS.filter((id) => !autoGoalAvailable(id, noBoss))).toEqual(['boss', 'bossAttacks']);
  });

  it('turns menu items into checks and back', () => {
    const boss = makeAutoGoal('boss', cast);
    expect(boss).toMatchObject({ kind: 'auto', label: 'Boss drawn by the student', check: { type: 'drawn', key: 'boss' } });
    expect(menuIdOf(boss!, cast)).toBe('boss');
    expect(menuIdOf(makeAutoGoal('hero', cast)!, cast)).toBe('hero');
    expect(makeAutoGoal('bossAttacks', cast)).toMatchObject({ kind: 'auto', check: { type: 'boss-attacks', min: 2 } });
    expect(menuIdOf(makeTeacherGoal('A creative twist'), cast)).toBeNull();
    expect(makeTeacherGoal('x'.repeat(300)).label.length).toBe(120);
  });
});

describe('assignment files', () => {
  it('carries the assignment, the locked lines and a fresh hand-in', () => {
    const asg = { ...newAssignment('moon-king'), title: 'Boss Battle Week', locked: { 'game.js': [[1, 3]] as Array<[number, number]> } };
    const world = assignmentWorld(fixtureWorld(), asg, 5);
    expect(world.title).toBe('Boss Battle Week');
    expect(world.assignment).toBe(asg);
    expect(world.code[0].locked).toEqual([[1, 3]]);
    expect(world.origin).toEqual({ kind: 'assignment', assignmentId: asg.id, starter: 'moon-king' });
    expect(world.handIn).toEqual({ fileName: null, savedAt: null, method: null, turnedInAt: null });
    expect(world.credits.madeBy).toBe('');
    expect(world.updatedAt).toBe(5);
  });

  it('names the file after the assignment, safely', () => {
    expect(assignmentFileName({ ...newAssignment(), title: 'Boss: Week 3?' })).toBe(`Boss Week 3 (${t('school.staff_asgFileSuffix')}).amble`);
    expect(assignmentFileName(newAssignment())).toBe(`${t('school.staff_asgUntitled')} (${t('school.staff_asgFileSuffix')}).amble`);
  });

  it('puts only built-in starters in a class link', () => {
    expect(fitsInLink(newAssignment('moon-king'))).toBe(true);
    expect(fitsInLink(newAssignment(null))).toBe(false);
  });
});

describe('the Hand in file name', () => {
  it('uses initials, never a full name prompt, and a safe name', () => {
    expect(cleanInitials('  J.R. <b>!! ')).toBe('J.R. b');
    expect(cleanInitials('Ana-Lucía M.')).toBe('Ana-Lucía M.');
    expect(suggestedFileName(fixtureWorld({ title: 'Moon: King?' }), 'AB')).toBe('Moon King - AB.amble');
    expect(suggestedFileName(fixtureWorld(), '')).toBe('Moon King.amble');
    expect(withAmbleExtension('My game')).toBe('My game.amble');
    expect(withAmbleExtension('My game.amble')).toBe('My game.amble');
    expect(withAmbleExtension('a/b\\c')).toBe('a b c.amble');
  });
});

describe('counted words', () => {
  it('reads right for one and for many', () => {
    expect(tn('school.staff_aiChanges', 1)).toBe('1 AI change');
    expect(tn('school.staff_aiChanges', 3)).toBe('3 AI changes');
    expect(tn('school.staff_sessions', 1, { time: '5 min' })).toBe('1 session · 5 min');
    expect(t('school.honesty', { drawings: tn('school.countDrawings', 1), ai: tn('school.countAi', 0), code: tn('school.countCode', 2) })).toContain('1 drawing, 0 wishes, 2 code edits of your own.');
  });
});
