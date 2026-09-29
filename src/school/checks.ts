/**
 * Assignment checks with evidence (§2.13, §2.14): each goal becomes pass/fail plus what Amble found, so a
 * student sees "Boss has 2+ attacks · Amble found 3 in your code" and a teacher "3 found in code". Pure: the
 * caller supplies the world, its cast, the drawings' facts, the code facts and (optionally) a robot run.
 */
import { t } from '../i18n';
import type { ArtId, CastKey, CheckResult, Goal, World } from '../model/types';
import type { CastInfo } from './assignment';
import type { CodeFacts } from './codeFacts';
import { tn } from './count';

/** What a drawing says about who made it. */
export interface ArtFacts {
  madeBy: 'student' | 'example' | 'teacher' | 'import';
  /** Drawn on the bones (part layers): "by you, on its bones". */
  onBones: boolean;
}

/** A robot run: null = not tested (yet), or couldn't be. */
export type RobotRun = { errors: number; seconds: number } | null;

export interface CheckInput {
  world: World;
  cast: readonly CastInfo[];
  art(id: ArtId): ArtFacts | null;
  facts: CodeFacts;
  robot: RobotRun;
}

export type Evidence =
  | { kind: 'drawn'; onBones: boolean }
  | { kind: 'justBones'; name: string; role: string }
  | { kind: 'notTheirs'; name: string }
  | { kind: 'drawings'; n: number; min: number }
  | { kind: 'found'; what: 'attacks' | 'dials' | 'states'; n: number; min: number }
  | { kind: 'winLose'; win: boolean; lose: boolean }
  | { kind: 'captions'; total: number; missing: number }
  | { kind: 'clean'; seconds: number }
  | { kind: 'errors'; n: number }
  | { kind: 'untested' }
  | { kind: 'teacher' };

export interface CheckOutcome {
  goal: Goal;
  /** Teacher goals are null: the teacher decides. */
  pass: boolean | null;
  evidence: Evidence;
  /** What "Fix it" opens: a cast member to draw, the code, or the world. */
  fix: { kind: 'draw'; key: CastKey } | { kind: 'code' } | { kind: 'world' } | { kind: 'retest' } | null;
}

/** The goals a world is checked against: its assignment's, or (no assignment) hero drawn and runs clean. */
export function goalsFor(world: World, cast: readonly CastInfo[]): Goal[] {
  const goals: Goal[] = [];
  if (world.assignment?.goals.length) goals.push(...world.assignment.goals);
  else {
    const hero = cast.find((c) => c.role === 'hero');
    if (hero) goals.push({ id: 'default-hero', label: t('school.staff_goalHero'), kind: 'auto', check: { type: 'drawn', key: hero.key } });
    goals.push({ id: 'default-runs', label: t('school.staff_goalRunsClean'), kind: 'auto', check: { type: 'runs-clean' } });
  }
  // Drawings the assignment requires count as goals too.
  for (const key of world.assignment?.require ?? []) {
    if (goals.some((g) => g.kind === 'auto' && g.check.type === 'drawn' && g.check.key === key)) continue;
    const member = cast.find((c) => c.key === key);
    goals.push({ id: `require-${key}`, label: member?.name ?? key, kind: 'auto', check: { type: 'drawn', key } });
  }
  return goals;
}

function drawnByStudent(world: World, art: CheckInput['art'], key: CastKey): { drawn: boolean; theirs: boolean; onBones: boolean } {
  const slot = world.cast[key];
  if (!slot?.art) return { drawn: false, theirs: false, onBones: false };
  const facts = art(slot.art);
  const madeBy = facts?.madeBy ?? slot.madeBy ?? 'student';
  return { drawn: true, theirs: madeBy === 'student', onBones: facts?.onBones ?? false };
}

function studentDrawings(world: World, art: CheckInput['art']): number {
  return Object.values(world.cast).filter((s) => s.art && (art(s.art)?.madeBy ?? s.madeBy ?? 'student') === 'student').length;
}

/** Sounds the game uses and whether each has a caption (the student's own sound wins over `static sounds`). */
function captionCounts(world: World, facts: CodeFacts): { total: number; missing: number } {
  const names = new Set([...Object.keys(facts.sounds), ...Object.keys(world.sounds)]);
  let missing = 0;
  for (const name of names) {
    const own = world.sounds[name];
    const caption = own ? own.caption.trim() : (facts.sounds[name] ?? '');
    if (!caption) missing++;
  }
  return { total: names.size, missing };
}

export function runChecks(goals: readonly Goal[], input: CheckInput): CheckOutcome[] {
  const { world, cast, facts, art, robot } = input;
  return goals.map((goal): CheckOutcome => {
    if (goal.kind === 'teacher') return { goal, pass: null, evidence: { kind: 'teacher' }, fix: null };
    const c = goal.check;
    switch (c.type) {
      case 'drawn': {
        const member = cast.find((m) => m.key === c.key);
        const d = drawnByStudent(world, art, c.key);
        const name = member?.name ?? c.key;
        if (!d.drawn) return { goal, pass: false, evidence: { kind: 'justBones', name, role: member?.role ?? '' }, fix: { kind: 'draw', key: c.key } };
        if (!d.theirs) return { goal, pass: false, evidence: { kind: 'notTheirs', name }, fix: { kind: 'draw', key: c.key } };
        return { goal, pass: true, evidence: { kind: 'drawn', onBones: d.onBones }, fix: null };
      }
      case 'min-drawings': {
        const n = studentDrawings(world, art);
        return { goal, pass: n >= c.n, evidence: { kind: 'drawings', n, min: c.n }, fix: n >= c.n ? null : { kind: 'world' } };
      }
      case 'boss-attacks': {
        const n = facts.attacks.length;
        return { goal, pass: n >= c.min, evidence: { kind: 'found', what: 'attacks', n, min: c.min }, fix: n >= c.min ? null : { kind: 'code' } };
      }
      case 'uses-dials': {
        const n = facts.dials.filter((d) => facts.dialsRead.includes(d)).length;
        return { goal, pass: n >= c.min, evidence: { kind: 'found', what: 'dials', n, min: c.min }, fix: n >= c.min ? null : { kind: 'code' } };
      }
      case 'brain-states': {
        const n = facts.brainStates;
        return { goal, pass: n >= c.min, evidence: { kind: 'found', what: 'states', n, min: c.min }, fix: n >= c.min ? null : { kind: 'code' } };
      }
      case 'has-win-and-lose': {
        const pass = facts.win && facts.lose;
        return { goal, pass, evidence: { kind: 'winLose', win: facts.win, lose: facts.lose }, fix: pass ? null : { kind: 'code' } };
      }
      case 'captions': {
        const counts = captionCounts(world, facts);
        return { goal, pass: counts.missing === 0, evidence: { kind: 'captions', ...counts }, fix: counts.missing ? { kind: 'world' } : null };
      }
      case 'runs-clean': {
        if (!robot) return { goal, pass: false, evidence: { kind: 'untested' }, fix: { kind: 'retest' } };
        if (robot.errors > 0) return { goal, pass: false, evidence: { kind: 'errors', n: robot.errors }, fix: { kind: 'world' } };
        return { goal, pass: true, evidence: { kind: 'clean', seconds: robot.seconds }, fix: null };
      }
    }
  });
}

// ------------------------------------------------------------------ words

/** The student's words for a goal ("Your boss is drawn"). Teacher goals keep the teacher's words. */
export function studentLabel(goal: Goal, cast: readonly CastInfo[]): string {
  if (goal.kind === 'teacher') return goal.label;
  const c = goal.check;
  switch (c.type) {
    case 'drawn': {
      const member = cast.find((m) => m.key === c.key);
      if (member?.role === 'hero') return t('school.goalHeroDrawn');
      if (member?.role === 'boss') return t('school.goalBossDrawn');
      return t('school.goalDrawn', { name: member?.name ?? c.key });
    }
    case 'min-drawings':
      return tn('school.goalMinDrawings', c.n);
    case 'boss-attacks':
      return t('school.goalBossAttacks', { n: c.min });
    case 'uses-dials':
      return c.min > 1 ? t('school.goalDialsMany', { n: c.min }) : t('school.goalDials');
    case 'brain-states':
      return t('school.goalBrainStates', { n: c.min });
    case 'has-win-and-lose':
      return t('school.goalWinLose');
    case 'captions':
      return t('school.goalCaptions');
    case 'runs-clean':
      return t('school.goalRunsClean');
  }
}

/** What Amble found, for the student ("Amble found 3 in your code"). */
export function studentEvidence(e: Evidence): string {
  switch (e.kind) {
    case 'drawn':
      return e.onBones ? t('school.evDrawnBones') : t('school.evDrawn');
    case 'justBones':
      return e.role === 'hero' ? t('school.evHeroBones') : e.role === 'boss' ? t('school.evBossBones') : t('school.evJustBones', { name: e.name });
    case 'notTheirs':
      return t('school.evNotTheirs');
    case 'drawings':
      return t('school.evDrawings', { n: e.n });
    case 'found':
      return e.n >= e.min ? t('school.evFound', { n: e.n }) : e.n === 0 ? t('school.evFoundNone') : t('school.evFoundFew', { n: e.n, more: e.min - e.n });
    case 'winLose':
      return e.win && e.lose ? t('school.evWinLose') : e.win ? t('school.evNoLose') : e.lose ? t('school.evNoWin') : t('school.evNeither');
    case 'captions':
      return e.total === 0 ? t('school.evNoSounds') : e.missing === 0 ? tn('school.evCaptions', e.total) : tn('school.evCaptionsMissing', e.missing);
    case 'clean':
      return t('school.evTested');
    case 'errors':
      return tn('school.evErrors', e.n);
    case 'untested':
      return t('school.evUntested');
    case 'teacher':
      return t('school.evTeacher');
  }
}

/** What Amble found, for the teacher's gallery ("3 found in code", "6 s test play"). */
export function teacherEvidence(e: Evidence): string {
  switch (e.kind) {
    case 'drawn':
      return t('school.staff_evAuto');
    case 'justBones':
      return t('school.staff_evJustBones');
    case 'notTheirs':
      return t('school.staff_evNotTheirs');
    case 'drawings':
      return t('school.staff_evDrawings', { n: e.n });
    case 'found':
      return t('school.staff_evFound', { n: e.n });
    case 'winLose':
      return e.win && e.lose ? t('school.staff_evAuto') : e.win ? t('school.staff_evNoLose') : e.lose ? t('school.staff_evNoWin') : t('school.staff_evNeither');
    case 'captions':
      return e.missing ? t('school.staff_evCaptionsMissing', { n: e.missing }) : t('school.staff_evAuto');
    case 'clean':
      return t('school.staff_evTestPlay', { n: e.seconds });
    case 'errors':
      return tn('school.staff_evErrors', e.n);
    case 'untested':
      return t('school.staff_evUntested');
    case 'teacher':
      return t('school.staff_evTeacher');
  }
}

/** `SchoolApi.check`'s shape (§8.4): the student's evidence. */
export function toCheckResults(outcomes: readonly CheckOutcome[]): CheckResult[] {
  return outcomes.map((o) => ({ goal: o.goal.id, pass: o.pass === true, evidence: studentEvidence(o.evidence) }));
}
