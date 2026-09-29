/**
 * "How it was built" (§2.14, §5.6): what a world's Footsteps say about how it was made, for the teacher's
 * gallery and the student's honesty line at Hand in. Counts only; never stroke timing or anything sent.
 */
import { t } from '../i18n';
import type { ArtId, World } from '../model/types';

export interface Story {
  /** Work sessions (Footsteps more than 30 minutes apart start a new one). */
  sessions: number;
  /** Time across the sessions, in minutes (at least one per session). */
  minutes: number;
  /** Drawings in the world made by the student. */
  drawings: number;
  /** Changes the AI helper made (accepted asks and fixes). */
  aiChanges: number;
  /** Times the student changed the code by hand. */
  codeEdits: number;
  /** The student's own words to the AI helper, newest first. */
  requests: string[];
}

const SESSION_GAP_MS = 30 * 60 * 1000;

export function buildStory(world: World, madeBy: (id: ArtId) => string | null = () => null): Story {
  const times = world.steps.map((s) => s.at).sort((a, b) => a - b);
  let sessions = 0;
  let minutes = 0;
  let start = 0;
  let last = 0;
  for (const at of times) {
    if (sessions === 0 || at - last > SESSION_GAP_MS) {
      if (sessions) minutes += Math.max(1, Math.round((last - start) / 60000));
      sessions++;
      start = at;
    }
    last = at;
  }
  if (sessions) minutes += Math.max(1, Math.round((last - start) / 60000));

  const drawings = Object.values(world.cast).filter((slot) => slot.art && (madeBy(slot.art) ?? slot.madeBy ?? 'student') === 'student').length;
  const aiChanges = world.steps.filter((s) => s.by === 'ai' && (s.kind === 'ask' || s.kind === 'fix')).length;
  const codeEdits = world.steps.filter((s) => s.by === 'student' && s.kind === 'code').length;
  const requests = world.steps
    .filter((s) => s.by === 'ai' && s.request)
    .sort((a, b) => b.at - a.at)
    .map((s) => (s.request ?? '').trim())
    .filter(Boolean);
  return { sessions, minutes, drawings, aiChanges, codeEdits, requests };
}

/** "1 h 12 min", "45 min". */
export function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (!h) return t('school.durMin', { m });
  return m ? t('school.durHoursMin', { h, m }) : t('school.durHours', { h });
}
