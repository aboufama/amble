/**
 * Assignments (§2.14, §4.2): what a teacher asks for (title, instructions, starter, required drawings,
 * goals, AI mode, content level, locked lines, due text), the goal menu, the cast a starter or world offers,
 * and assignment files. Assignments carried in a class link must use a built-in starter.
 */
import { extractManifest, sourceFilesOf } from '../cores/ai';
import { t } from '../i18n';
import { uid } from '../model/ids';
import type { Assignment, AutoCheck, CastKey, CodeFile, Goal, Role, StarterId, World } from '../model/types';
import type { StarterCatalog } from '../starters/api';

/** A cast member as the assignment editor and the checks need it. */
export interface CastInfo {
  key: CastKey;
  name: string;
  role: Role;
  required: boolean;
}

const ROLES: readonly Role[] = ['hero', 'enemy', 'boss', 'npc', 'item', 'hazard', 'prop', 'terrain', 'projectile', 'enemyShot', 'decor', 'background'];

/** The cast a game declares in `static art`, read without running it. */
export function castFromCode(code: readonly CodeFile[]): CastInfo[] {
  let art: unknown;
  try {
    art = extractManifest(sourceFilesOf(code)).statics.art;
  } catch {
    return [];
  }
  if (!art || typeof art !== 'object') return [];
  const out: CastInfo[] = [];
  for (const [key, raw] of Object.entries(art as Record<string, unknown>)) {
    const spec = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    const role = ROLES.includes(spec.role as Role) ? (spec.role as Role) : 'prop';
    out.push({ key, name: typeof spec.name === 'string' && spec.name ? spec.name : key, role, required: spec.required === true });
  }
  return out;
}

const castCache = new Map<string, Promise<CastInfo[]>>();

/** A built-in starter's cast (the stub catalog and M8's both open a world copy, which is never stored). */
export function castOfStarter(catalog: StarterCatalog, id: StarterId): Promise<CastInfo[]> {
  let p = castCache.get(id);
  if (!p) {
    p = catalog
      .open(id, { withArt: false })
      .then(({ world }) => castFromCode(world.code))
      .catch(() => []);
    castCache.set(id, p);
  }
  return p;
}

// ------------------------------------------------------------------ goals

export type AutoGoalId = 'hero' | 'boss' | 'bossAttacks' | 'dials' | 'runsClean' | 'winLose' | 'captions';

export const AUTO_GOALS: readonly AutoGoalId[] = ['hero', 'boss', 'bossAttacks', 'dials', 'runsClean', 'winLose', 'captions'];

const heroOf = (cast: readonly CastInfo[]) => cast.find((c) => c.role === 'hero') ?? null;
const bossOf = (cast: readonly CastInfo[]) => cast.find((c) => c.role === 'boss') ?? null;

/** Whether a goal from the menu makes sense for this cast (boss goals need a boss). */
export function autoGoalAvailable(id: AutoGoalId, cast: readonly CastInfo[]): boolean {
  if (id === 'hero') return heroOf(cast) !== null;
  if (id === 'boss' || id === 'bossAttacks') return bossOf(cast) !== null;
  return true;
}

function checkFor(id: AutoGoalId, cast: readonly CastInfo[]): AutoCheck | null {
  switch (id) {
    case 'hero': {
      const hero = heroOf(cast);
      return hero ? { type: 'drawn', key: hero.key } : null;
    }
    case 'boss': {
      const boss = bossOf(cast);
      return boss ? { type: 'drawn', key: boss.key } : null;
    }
    case 'bossAttacks':
      return { type: 'boss-attacks', min: 2 };
    case 'dials':
      return { type: 'uses-dials', min: 1 };
    case 'runsClean':
      return { type: 'runs-clean' };
    case 'winLose':
      return { type: 'has-win-and-lose' };
    case 'captions':
      return { type: 'captions' };
  }
}

const MENU_LABELS: Record<AutoGoalId, 'staff_goalHero' | 'staff_goalBoss' | 'staff_goalBossAttacks' | 'staff_goalDials' | 'staff_goalRunsClean' | 'staff_goalWinLose' | 'staff_goalCaptions'> = {
  hero: 'staff_goalHero',
  boss: 'staff_goalBoss',
  bossAttacks: 'staff_goalBossAttacks',
  dials: 'staff_goalDials',
  runsClean: 'staff_goalRunsClean',
  winLose: 'staff_goalWinLose',
  captions: 'staff_goalCaptions',
};

/** The teacher's words for a goal in the menu ("Hero drawn by the student"). */
export function autoGoalLabel(id: AutoGoalId): string {
  return t(`school.${MENU_LABELS[id]}`);
}

export function makeAutoGoal(id: AutoGoalId, cast: readonly CastInfo[]): Goal | null {
  const check = checkFor(id, cast);
  return check ? { id: uid('g_'), label: autoGoalLabel(id), kind: 'auto', check } : null;
}

export function makeTeacherGoal(label: string): Goal {
  return { id: uid('g_'), label: label.slice(0, 120), kind: 'teacher' };
}

/** Which menu item an auto goal came from (null for teacher goals). */
export function menuIdOf(goal: Goal, cast: readonly CastInfo[]): AutoGoalId | null {
  if (goal.kind !== 'auto') return null;
  const c = goal.check;
  switch (c.type) {
    case 'drawn':
      return c.key === bossOf(cast)?.key ? 'boss' : 'hero';
    case 'boss-attacks':
      return 'bossAttacks';
    case 'uses-dials':
      return 'dials';
    case 'runs-clean':
      return 'runsClean';
    case 'has-win-and-lose':
      return 'winLose';
    case 'captions':
      return 'captions';
    default:
      return null;
  }
}

// ------------------------------------------------------------------ assignments

export function newAssignment(starter: StarterId | null = 'moon-king'): Assignment {
  return { id: uid('as_'), title: '', text: '', starter, require: [], goals: [], ai: 'on', level: null, due: '', locked: {} };
}

/** Only assignments on built-in starters travel in a class link (a custom world needs a file). */
export function fitsInLink(asg: Assignment): boolean {
  return asg.starter !== null;
}

/** A world carrying the assignment, ready to write as an assignment file (the student's copy starts from it). */
export function assignmentWorld(base: World, asg: Assignment, now = Date.now()): World {
  const code = base.code.map((f) => ({ ...f, locked: asg.locked[f.path] ?? f.locked }));
  const title = asg.title.trim() || base.title;
  return {
    ...base,
    title: title.slice(0, 40),
    code,
    assignment: asg,
    origin: { kind: 'assignment', assignmentId: asg.id, starter: asg.starter },
    handIn: { fileName: null, savedAt: null, method: null, turnedInAt: null },
    credits: { madeBy: '' },
    updatedAt: now,
  };
}

/** The file name for an assignment file ("Boss Battle Week (starter).amble"). */
export function assignmentFileName(asg: Assignment): string {
  const title = (asg.title.trim() || t('school.staff_asgUntitled')).replace(/[\\/:*?"<>|]+/g, ' ').trim();
  return `${title} (${t('school.staff_asgFileSuffix')}).amble`;
}
